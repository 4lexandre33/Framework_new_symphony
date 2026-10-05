import type {
  SectorCoord,
  Vector3Streaming,
} from "../../../contracts/streaming/types";

export interface StreamingJobRequest {
  readonly jobId:
    number;

  readonly cameraPosition:
    Vector3Streaming;

  readonly sectorCoords:
    ReadonlyArray<
      SectorCoord
    >;

  readonly maxDistance:
    number;
}

export interface StreamingJobResponse {
  readonly jobId:
    number;

  readonly visibleSectors:
    ReadonlyArray<
      SectorCoord
    >;
}

export type StreamingWorkerFactory =
  () => Worker;

interface WorkerSlot {
  readonly worker:
    Worker;

  activeJobId:
    number |
    null;
}

interface PendingJob {
  readonly resolve:
    (
      visibleSectors:
        ReadonlyArray<
          SectorCoord
        >,
    ) => void;

  readonly cameraPosition:
    Vector3Streaming;

  readonly sectorCoords:
    ReadonlyArray<
      SectorCoord
    >;

  readonly maxDistance:
    number;

  readonly slot:
    WorkerSlot;
}

const DEFAULT_MAX_WORKERS =
  2;

const SECTOR_SIZE_WORLD_UNITS =
  50;

const EMPTY_SECTORS:
  readonly SectorCoord[] =
    Object.freeze([]);

function defaultWorkerFactory():
  Worker {
  return new Worker(
    new URL(
      "./streaming.worker.ts",
      import.meta.url,
    ),
    {
      type:
        "module",
    },
  );
}

function finiteOrZero(
  value:
    number,
): number {
  return Number.isFinite(
    value,
  )
    ? value
    : 0;
}

function clonePosition(
  value:
    Vector3Streaming,
): Vector3Streaming {
  return {
    x:
      finiteOrZero(
        value.x,
      ),
    y:
      finiteOrZero(
        value.y,
      ),
    z:
      finiteOrZero(
        value.z,
      ),
  };
}

function cloneSectorCoords(
  source:
    ReadonlyArray<
      SectorCoord
    >,
): ReadonlyArray<
  SectorCoord
> {
  const copy:
    SectorCoord[] =
    new Array(
      source.length,
    );

  for (
    let index =
      0;
    index <
    source.length;
    index +=
      1
  ) {
    const value =
      source[
        index
      ];

    copy[
      index
    ] = {
      x:
        finiteOrZero(
          value?.x ??
          0,
        ),
      y:
        finiteOrZero(
          value?.y ??
          0,
        ),
      z:
        finiteOrZero(
          value?.z ??
          0,
        ),
    };
  }

  return copy;
}

export class StreamingWorkerPool {
  private readonly workerLimit:
    number;

  private readonly workerFactory:
    StreamingWorkerFactory;

  private readonly workerSlots:
    WorkerSlot[] =
      [];

  private readonly pendingJobs =
    new Map<
      number,
      PendingJob
    >();

  private nextJobId =
    1;

  private disposed =
    false;

  public constructor(
    maxWorkers =
      DEFAULT_MAX_WORKERS,
    workerFactory:
      StreamingWorkerFactory =
        defaultWorkerFactory,
  ) {
    this.workerLimit = this.normalizeWorkerLimit(maxWorkers);

    this.workerFactory =
      workerFactory;

    this.initializeWorkers();
  }

  public processVisibilityAsync(
    cameraPosition:
      Vector3Streaming,
    sectorCoords:
      ReadonlyArray<
        SectorCoord
      >,
    maxDistance:
      number,
  ): Promise<
    ReadonlyArray<
      SectorCoord
    >
  > {
    const safeMaxDistance =
      this.normalizeDistance(
        maxDistance,
      );

    if (
      sectorCoords.length ===
      0
    ) {
      return Promise.resolve(
        EMPTY_SECTORS,
      );
    }

    const cameraSnapshot =
      clonePosition(
        cameraPosition,
      );

    const sectorSnapshot =
      cloneSectorCoords(
        sectorCoords,
      );

    if (
      this.disposed ||
      safeMaxDistance <=
        0
    ) {
      return Promise.resolve(
        this.fallbackVisibilityCheck(
          cameraSnapshot,
          sectorSnapshot,
          safeMaxDistance,
        ),
      );
    }

    const slot =
      this.findIdleWorker();

    if (
      slot ===
      null
    ) {
      return Promise.resolve(
        this.fallbackVisibilityCheck(
          cameraSnapshot,
          sectorSnapshot,
          safeMaxDistance,
        ),
      );
    }

    const jobId =
      this.allocateJobId();

    slot.activeJobId =
      jobId;

    return new Promise<
      ReadonlyArray<
        SectorCoord
      >
    >(
      (
        resolve,
      ): void => {
        const pendingJob:
          PendingJob = {
            resolve,
            cameraPosition:
              cameraSnapshot,
            sectorCoords:
              sectorSnapshot,
            maxDistance:
              safeMaxDistance,
            slot,
          };

        this.pendingJobs.set(
          jobId,
          pendingJob,
        );

        const request:
          StreamingJobRequest = {
            jobId,
            cameraPosition:
              cameraSnapshot,
            sectorCoords:
              sectorSnapshot,
            maxDistance:
              safeMaxDistance,
          };

        try {
          slot.worker
            .postMessage(
              request,
            );
        } catch {
          this.finishJobWithFallback(
            jobId,
          );
        }
      },
    );
  }

  public get workerCount():
    number {
    return this.workerSlots
      .length;
  }

  public get busyWorkerCount():
    number {
    let count =
      0;

    for (
      const slot of
      this.workerSlots
    ) {
      if (
        slot.activeJobId !==
        null
      ) {
        count +=
          1;
      }
    }

    return count;
  }

  public get pendingJobCount():
    number {
    return this.pendingJobs
      .size;
  }

  public clear(): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.disposed =
      true;

    const pendingIds =
      Array.from(
        this.pendingJobs.keys(),
      );

    for (
      const jobId of
      pendingIds
    ) {
      this.finishJobWithFallback(
        jobId,
      );
    }

    for (
      const slot of
      this.workerSlots
    ) {
      slot.worker
        .terminate();

      slot.activeJobId =
        null;
    }

    this.workerSlots.length =
      0;

    this.pendingJobs.clear();
  }

  private initializeWorkers(): void {
    if (
      this.workerLimit <=
        0
    ) {
      return;
    }

    for (
      let index =
        0;
      index <
      this.workerLimit;
      index +=
        1
    ) {
      try {
        const worker =
          this.workerFactory();

        const slot:
          WorkerSlot = {
            worker,
            activeJobId:
              null,
          };

        worker.addEventListener(
          "message",
          (
            event:
              MessageEvent<
                StreamingJobResponse
              >,
          ): void => {
            this.handleWorkerMessage(
              slot,
              event.data,
            );
          },
        );

        worker.addEventListener(
          "error",
          (): void => {
            this.handleWorkerFailure(
              slot,
            );
          },
        );

        worker.addEventListener(
          "messageerror",
          (): void => {
            this.handleWorkerFailure(
              slot,
            );
          },
        );

        this.workerSlots.push(
          slot,
        );
      } catch {
        break;
      }
    }
  }

  private handleWorkerMessage(
    slot:
      WorkerSlot,
    response:
      StreamingJobResponse,
  ): void {
    if (
      this.disposed ||
      slot.activeJobId !==
        response.jobId
    ) {
      return;
    }

    const pendingJob =
      this.pendingJobs.get(
        response.jobId,
      );

    slot.activeJobId =
      null;

    if (
      pendingJob ===
      undefined
    ) {
      return;
    }

    this.pendingJobs.delete(
      response.jobId,
    );

    const visibleSectors =
      Array.isArray(
        response.visibleSectors,
      )
        ? response.visibleSectors
        : this.fallbackVisibilityCheck(
            pendingJob.cameraPosition,
            pendingJob.sectorCoords,
            pendingJob.maxDistance,
          );

    pendingJob.resolve(
      visibleSectors,
    );
  }

  private handleWorkerFailure(
    slot:
      WorkerSlot,
  ): void {
    const jobId =
      slot.activeJobId;

    if (
      jobId !==
      null
    ) {
      this.finishJobWithFallback(
        jobId,
      );
    }
  }

  private finishJobWithFallback(
    jobId:
      number,
  ): void {
    const pendingJob =
      this.pendingJobs.get(
        jobId,
      );

    if (
      pendingJob ===
      undefined
    ) {
      return;
    }

    this.pendingJobs.delete(
      jobId,
    );

    pendingJob.slot
      .activeJobId =
      null;

    pendingJob.resolve(
      this.fallbackVisibilityCheck(
        pendingJob.cameraPosition,
        pendingJob.sectorCoords,
        pendingJob.maxDistance,
      ),
    );
  }

  private findIdleWorker():
    WorkerSlot |
    null {
    for (
      const slot of
      this.workerSlots
    ) {
      if (
        slot.activeJobId ===
        null
      ) {
        return slot;
      }
    }

    return null;
  }

  private fallbackVisibilityCheck(
    cameraPosition:
      Vector3Streaming,
    sectorCoords:
      ReadonlyArray<
        SectorCoord
      >,
    maxDistance:
      number,
  ): ReadonlyArray<
    SectorCoord
  > {
    const maxDistanceSquared =
      maxDistance *
      maxDistance;

    const visibleSectors:
      SectorCoord[] =
      [];

    for (
      const sector of
      sectorCoords
    ) {
      const centerX =
        sector.x *
        SECTOR_SIZE_WORLD_UNITS;

      const centerY =
        sector.y *
        SECTOR_SIZE_WORLD_UNITS;

      const centerZ =
        sector.z *
        SECTOR_SIZE_WORLD_UNITS;

      const dx =
        cameraPosition.x -
        centerX;

      const dy =
        cameraPosition.y -
        centerY;

      const dz =
        cameraPosition.z -
        centerZ;

      const distanceSquared =
        dx *
          dx +
        dy *
          dy +
        dz *
          dz;

      if (
        distanceSquared <=
        maxDistanceSquared
      ) {
        visibleSectors.push(
          sector,
        );
      }
    }

    return visibleSectors;
  }

  private allocateJobId():
    number {
    for (
      let attempts =
        0;
      attempts <
      Number.MAX_SAFE_INTEGER;
      attempts +=
        1
    ) {
      const jobId =
        this.nextJobId;

      this.nextJobId +=
        1;

      if (
        this.nextJobId >=
        Number.MAX_SAFE_INTEGER
      ) {
        this.nextJobId =
          1;
      }

      if (
        !this.pendingJobs.has(
          jobId,
        )
      ) {
        return jobId;
      }
    }

    throw new Error(
      "StreamingWorkerPool esgotou IDs de job disponíveis.",
    );
  }

  private normalizeWorkerLimit(
    value:
      number,
  ): number {
    if (
      !Number.isFinite(
        value,
      )
    ) {
      return DEFAULT_MAX_WORKERS;
    }

    return Math.max(
      0,
      Math.floor(
        value,
      ),
    );
  }

  private normalizeDistance(
    value:
      number,
  ): number {
    if (
      !Number.isFinite(
        value,
      )
    ) {
      return 0;
    }

    return Math.max(
      0,
      value,
    );
  }
}
