import type {
  SectorCoord,
  Vector3Streaming,
} from "../../../contracts/streaming/types";

export interface StreamingJobRequest {
  readonly jobId: number;
  readonly cameraPosition: Vector3Streaming;
  readonly sectorCoords: ReadonlyArray<SectorCoord>;
  readonly maxDistance: number;
}

export interface StreamingJobResponse {
  readonly jobId: number;
  readonly visibleSectors: ReadonlyArray<SectorCoord>;
}

interface WorkerSlot {
  readonly worker: Worker;
  activeJobId: number | null;
}

interface PendingJob {
  readonly resolve: (visibleSectors: ReadonlyArray<SectorCoord>) => void;
  readonly cameraPosition: Vector3Streaming;
  readonly sectorCoords: ReadonlyArray<SectorCoord>;
  readonly maxDistance: number;
  readonly slot: WorkerSlot;
}

const DEFAULT_MAX_WORKERS = 2;
const SECTOR_SIZE_WORLD_UNITS = 50;

export class StreamingWorkerPool {
  private readonly workerLimit: number;
  private readonly workerSlots: WorkerSlot[] = [];
  private readonly pendingJobs = new Map<number, PendingJob>();
  private nextJobId = 1;
  private disposed = false;

  public constructor(maxWorkers = DEFAULT_MAX_WORKERS) {
    this.workerLimit = this.normalizeWorkerLimit(maxWorkers);
    this.initializeWorkers();
  }

  public processVisibilityAsync(
    cameraPosition: Vector3Streaming,
    sectorCoords: ReadonlyArray<SectorCoord>,
    maxDistance: number,
  ): Promise<ReadonlyArray<SectorCoord>> {
    const safeMaxDistance = this.normalizeDistance(maxDistance);

    if (sectorCoords.length === 0) {
      return Promise.resolve([]);
    }

    if (this.disposed || safeMaxDistance <= 0) {
      return Promise.resolve(
        this.fallbackVisibilityCheck(
          cameraPosition,
          sectorCoords,
          safeMaxDistance,
        ),
      );
    }

    const slot = this.findIdleWorker();

    if (!slot) {
      return Promise.resolve(
        this.fallbackVisibilityCheck(
          cameraPosition,
          sectorCoords,
          safeMaxDistance,
        ),
      );
    }

    const jobId = this.allocateJobId();
    slot.activeJobId = jobId;

    return new Promise<ReadonlyArray<SectorCoord>>((resolve) => {
      const pendingJob: PendingJob = {
        resolve,
        cameraPosition,
        sectorCoords,
        maxDistance: safeMaxDistance,
        slot,
      };

      this.pendingJobs.set(jobId, pendingJob);

      const request: StreamingJobRequest = {
        jobId,
        cameraPosition,
        sectorCoords,
        maxDistance: safeMaxDistance,
      };

      try {
        slot.worker.postMessage(request);
      } catch {
        this.finishJobWithFallback(jobId);
      }
    });
  }

  public get workerCount(): number {
    return this.workerSlots.length;
  }

  public get busyWorkerCount(): number {
    let count = 0;

    for (const slot of this.workerSlots) {
      if (slot.activeJobId !== null) {
        count += 1;
      }
    }

    return count;
  }

  public clear(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    for (const jobId of [...this.pendingJobs.keys()]) {
      this.finishJobWithFallback(jobId);
    }

    for (const slot of this.workerSlots) {
      slot.worker.terminate();
      slot.activeJobId = null;
    }

    this.workerSlots.length = 0;
    this.pendingJobs.clear();
  }

  private initializeWorkers(): void {
    if (
      this.workerLimit <= 0 ||
      typeof Worker === "undefined"
    ) {
      return;
    }

    for (let index = 0; index < this.workerLimit; index += 1) {
      try {
        const worker = new Worker(
          new URL("./streaming.worker.ts", import.meta.url),
          { type: "module" },
        );

        const slot: WorkerSlot = {
          worker,
          activeJobId: null,
        };

        worker.addEventListener(
          "message",
          (event: MessageEvent<StreamingJobResponse>): void => {
            this.handleWorkerMessage(slot, event.data);
          },
        );

        worker.addEventListener(
          "error",
          (): void => {
            this.handleWorkerFailure(slot);
          },
        );

        this.workerSlots.push(slot);
      } catch {
        break;
      }
    }
  }

  private handleWorkerMessage(
    slot: WorkerSlot,
    response: StreamingJobResponse,
  ): void {
    if (slot.activeJobId !== response.jobId) {
      return;
    }

    const pendingJob = this.pendingJobs.get(response.jobId);

    slot.activeJobId = null;

    if (!pendingJob) {
      return;
    }

    this.pendingJobs.delete(response.jobId);
    pendingJob.resolve(response.visibleSectors);
  }

  private handleWorkerFailure(slot: WorkerSlot): void {
    const jobId = slot.activeJobId;

    if (jobId !== null) {
      this.finishJobWithFallback(jobId);
    }
  }

  private finishJobWithFallback(jobId: number): void {
    const pendingJob = this.pendingJobs.get(jobId);

    if (!pendingJob) {
      return;
    }

    this.pendingJobs.delete(jobId);
    pendingJob.slot.activeJobId = null;

    pendingJob.resolve(
      this.fallbackVisibilityCheck(
        pendingJob.cameraPosition,
        pendingJob.sectorCoords,
        pendingJob.maxDistance,
      ),
    );
  }

  private findIdleWorker(): WorkerSlot | null {
    for (const slot of this.workerSlots) {
      if (slot.activeJobId === null) {
        return slot;
      }
    }

    return null;
  }

  private fallbackVisibilityCheck(
    cameraPosition: Vector3Streaming,
    sectorCoords: ReadonlyArray<SectorCoord>,
    maxDistance: number,
  ): ReadonlyArray<SectorCoord> {
    const maxDistanceSquared = maxDistance * maxDistance;
    const visibleSectors: SectorCoord[] = [];

    for (const sector of sectorCoords) {
      const centerX = sector.x * SECTOR_SIZE_WORLD_UNITS;
      const centerY = sector.y * SECTOR_SIZE_WORLD_UNITS;
      const centerZ = sector.z * SECTOR_SIZE_WORLD_UNITS;

      const dx = cameraPosition.x - centerX;
      const dy = cameraPosition.y - centerY;
      const dz = cameraPosition.z - centerZ;
      const distanceSquared = dx * dx + dy * dy + dz * dz;

      if (distanceSquared <= maxDistanceSquared) {
        visibleSectors.push(sector);
      }
    }

    return visibleSectors;
  }

  private allocateJobId(): number {
    const jobId = this.nextJobId;
    this.nextJobId += 1;

    if (this.nextJobId >= Number.MAX_SAFE_INTEGER) {
      this.nextJobId = 1;
    }

    return jobId;
  }

  private normalizeWorkerLimit(value: number): number {
    if (!Number.isFinite(value)) {
      return DEFAULT_MAX_WORKERS;
    }

    return Math.max(0, Math.floor(value));
  }

  private normalizeDistance(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.max(0, value);
  }
}
