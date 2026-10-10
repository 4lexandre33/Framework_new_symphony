import type {
  ChunkDataMatrix,
  Vector3Chunk,
} from "../../../contracts/terrain/types";

import {
  DEFAULT_GENERATION_CONFIG,
  TerrainGenerator,
  normalizeTerrainSeed,
  type ResolvedGenerationConfig,
} from "./TerrainGenerator";

interface TerrainWorkerRequest {
  readonly jobId: number;
  readonly coord: Vector3Chunk;
  readonly seed: number;
  readonly config: ResolvedGenerationConfig;
}

interface TerrainWorkerResponse {
  readonly jobId: number;
  readonly chunk?: ChunkDataMatrix;
  readonly error?: string;
}

interface PendingTerrainJob {
  readonly jobId: number;
  readonly coord: Vector3Chunk;
  readonly seed: number;
  readonly config: ResolvedGenerationConfig;
  readonly resolve: (chunk: ChunkDataMatrix) => void;
  readonly reject: (reason?: unknown) => void;
}

interface WorkerSlot {
  worker: Worker;
  busy: boolean;
  jobId: number | null;
  timer: ReturnType<typeof setTimeout> | null;
  restarts: number;
}

export interface TerrainChunkWorkerPool {
  requestChunkGenerationAsync(
    coord: Vector3Chunk,
    seed: number,
    config?: ResolvedGenerationConfig,
  ): Promise<ChunkDataMatrix>;

  /** Cancela um job ainda na FILA (rejeita com `TerrainGenerationCancelledError`). */
  cancelChunkGeneration?(coord: Vector3Chunk, seed: number): boolean;

  clear(): void;
}

export class TerrainGenerationCancelledError extends Error {
  public constructor() {
    super("Geração de chunk cancelada.");
    this.name = "TerrainGenerationCancelledError";
  }
}

export type ProceduralWorkerFactory = () => Worker;

export interface ProceduralWorkerPoolOptions {
  /** Tempo máximo de um job no Worker antes de gerar localmente e reiniciar o Worker. Padrão 15000 ms. */
  readonly jobTimeoutMs?: number;
  /** Reinícios por slot antes de desistir dele (os jobs passam ao fallback local). Padrão 2. */
  readonly maxWorkerRestarts?: number;
}

const DEFAULT_MAX_WORKERS = 2;
const DEFAULT_JOB_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RESTARTS = 2;

function defaultWorkerFactory(): Worker {
  return new Worker(new URL("./terrain.worker.ts", import.meta.url), { type: "module" });
}

function cloneCoord(coord: Vector3Chunk): Vector3Chunk {
  return {
    x: Number.isFinite(coord.x) ? Math.trunc(coord.x) : 0,
    y: Number.isFinite(coord.y) ? Math.trunc(coord.y) : 0,
    z: Number.isFinite(coord.z) ? Math.trunc(coord.z) : 0,
  };
}

/**
 * Pool de Workers de geração (G58):
 * - fila cancelável (`cancelChunkGeneration`);
 * - timeout por job: gera localmente e reinicia o Worker travado;
 * - Worker que falha ao carregar (erro sem job) é reiniciado; sem Workers
 *   vivos, os jobs caem no gerador local (mesmo código).
 */
export class ProceduralWorkerPool implements TerrainChunkWorkerPool {
  private readonly maxWorkers: number;
  private readonly workerFactory: ProceduralWorkerFactory;
  private readonly jobTimeoutMs: number;
  private readonly maxWorkerRestarts: number;
  private readonly workerSlots: WorkerSlot[] = [];
  private readonly queuedJobs: PendingTerrainJob[] = [];
  private readonly pendingJobs = new Map<number, PendingTerrainJob>();
  private fallbackGenerator: TerrainGenerator | null = null;
  private nextJobId = 1;
  private disposed = false;
  private fallbacks = 0;
  private restarts = 0;
  private timeouts = 0;

  public constructor(
    maxWorkers = DEFAULT_MAX_WORKERS,
    workerFactory: ProceduralWorkerFactory = defaultWorkerFactory,
    options: ProceduralWorkerPoolOptions = {},
  ) {
    this.maxWorkers = Math.max(
      0,
      Math.floor(Number.isFinite(maxWorkers) ? maxWorkers : DEFAULT_MAX_WORKERS),
    );
    this.workerFactory = workerFactory;
    this.jobTimeoutMs =
      typeof options.jobTimeoutMs === "number" && options.jobTimeoutMs > 0
        ? options.jobTimeoutMs
        : DEFAULT_JOB_TIMEOUT_MS;
    this.maxWorkerRestarts =
      typeof options.maxWorkerRestarts === "number" && options.maxWorkerRestarts >= 0
        ? Math.floor(options.maxWorkerRestarts)
        : DEFAULT_MAX_RESTARTS;
    this.initializeWorkers();
  }

  public requestChunkGenerationAsync(
    coord: Vector3Chunk,
    seed: number,
    config: ResolvedGenerationConfig = DEFAULT_GENERATION_CONFIG,
  ): Promise<ChunkDataMatrix> {
    if (this.disposed) {
      return Promise.reject(new Error("ProceduralWorkerPool já foi encerrado."));
    }

    const coordSnapshot = cloneCoord(coord);
    const safeSeed = normalizeTerrainSeed(seed);

    if (this.workerSlots.length === 0) {
      try {
        return Promise.resolve(this.generateChunkFallback(coordSnapshot, safeSeed, config));
      } catch (error: unknown) {
        return Promise.reject(error);
      }
    }

    const jobId = this.allocateJobId();

    return new Promise<ChunkDataMatrix>((resolve, reject): void => {
      this.queuedJobs.push({ jobId, coord: coordSnapshot, seed: safeSeed, config, resolve, reject });
      this.pumpQueue();
    });
  }

  public cancelChunkGeneration(coord: Vector3Chunk, seed: number): boolean {
    const target = cloneCoord(coord);
    const safeSeed = normalizeTerrainSeed(seed);

    for (let index = 0; index < this.queuedJobs.length; index += 1) {
      const job = this.queuedJobs[index] as PendingTerrainJob;

      if (
        job.seed === safeSeed &&
        job.coord.x === target.x &&
        job.coord.y === target.y &&
        job.coord.z === target.z
      ) {
        this.queuedJobs.splice(index, 1);
        job.reject(new TerrainGenerationCancelledError());
        return true;
      }
    }

    return false;
  }

  public get activeWorkerCount(): number {
    let active = 0;

    for (const slot of this.workerSlots) {
      if (slot.busy) {
        active += 1;
      }
    }

    return active;
  }

  public get queuedJobCount(): number {
    return this.queuedJobs.length;
  }

  public get pendingJobCount(): number {
    return this.pendingJobs.size;
  }

  public get workerCount(): number {
    return this.workerSlots.length;
  }

  /** Jobs resolvidos pelo gerador local (erro/timeout/sem Worker). */
  public get fallbackCount(): number {
    return this.fallbacks;
  }

  public get restartCount(): number {
    return this.restarts;
  }

  public get timeoutCount(): number {
    return this.timeouts;
  }

  public clear(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    while (this.queuedJobs.length > 0) {
      this.queuedJobs.shift()?.reject(
        new Error("ProceduralWorkerPool foi limpo antes da execução do job (encerrado)."),
      );
    }

    for (const job of this.pendingJobs.values()) {
      job.reject(new Error("ProceduralWorkerPool foi encerrado durante a execução do job."));
    }

    this.pendingJobs.clear();

    for (const slot of this.workerSlots) {
      this.clearSlotTimer(slot);
      slot.worker.terminate();
      slot.busy = false;
      slot.jobId = null;
    }

    this.workerSlots.length = 0;
    this.fallbackGenerator = null;
  }

  private initializeWorkers(): void {
    for (let index = 0; index < this.maxWorkers; index += 1) {
      const worker = this.spawnWorker();

      if (worker === null) {
        break;
      }

      const slot: WorkerSlot = { worker, busy: false, jobId: null, timer: null, restarts: 0 };
      this.attachListeners(slot, worker);
      this.workerSlots.push(slot);
    }
  }

  private spawnWorker(): Worker | null {
    try {
      return this.workerFactory();
    } catch {
      return null;
    }
  }

  private attachListeners(slot: WorkerSlot, worker: Worker): void {
    worker.addEventListener("message", (event: MessageEvent<TerrainWorkerResponse>): void => {
      if (slot.worker === worker) {
        this.handleWorkerMessage(slot, event.data);
      }
    });

    worker.addEventListener("error", (event: ErrorEvent): void => {
      if (slot.worker === worker) {
        this.handleWorkerError(slot, event.message);
      }
    });

    worker.addEventListener("messageerror", (): void => {
      if (slot.worker === worker && slot.jobId !== null) {
        this.finishJobWithFallback(slot, slot.jobId);
      }
    });
  }

  private pumpQueue(): void {
    if (this.disposed) {
      return;
    }

    if (this.workerSlots.length === 0) {
      // Nenhum Worker vivo: esvazia a fila no gerador local.
      while (this.queuedJobs.length > 0) {
        const job = this.queuedJobs.shift() as PendingTerrainJob;
        this.resolveWithFallback(job);
      }

      return;
    }

    for (const slot of this.workerSlots) {
      if (slot.busy) {
        continue;
      }

      const job = this.queuedJobs.shift();

      if (job === undefined) {
        return;
      }

      slot.busy = true;
      slot.jobId = job.jobId;
      this.pendingJobs.set(job.jobId, job);
      const request: TerrainWorkerRequest = {
        jobId: job.jobId,
        coord: job.coord,
        seed: job.seed,
        config: job.config,
      };

      try {
        slot.worker.postMessage(request);
        slot.timer = setTimeout((): void => {
          this.handleJobTimeout(slot, job.jobId);
        }, this.jobTimeoutMs);
      } catch {
        this.finishJobWithFallback(slot, job.jobId);
      }
    }
  }

  private handleWorkerMessage(slot: WorkerSlot, response: TerrainWorkerResponse): void {
    if (this.disposed || slot.jobId !== response.jobId) {
      return;
    }

    this.clearSlotTimer(slot);
    const job = this.pendingJobs.get(response.jobId);
    this.pendingJobs.delete(response.jobId);
    slot.busy = false;
    slot.jobId = null;

    if (job !== undefined) {
      if (response.chunk !== undefined && response.error === undefined) {
        job.resolve(response.chunk);
      } else {
        this.resolveWithFallback(job);
      }
    }

    this.pumpQueue();
  }

  /** Erro do Worker (inclusive falha ao carregar o módulo, sem job): reinicia o slot. */
  private handleWorkerError(slot: WorkerSlot, _message: string): void {
    if (this.disposed) {
      return;
    }

    const jobId = slot.jobId;
    this.replaceWorker(slot);

    if (jobId !== null) {
      this.finishJobWithFallback(slot, jobId);
      return;
    }

    this.pumpQueue();
  }

  private handleJobTimeout(slot: WorkerSlot, jobId: number): void {
    slot.timer = null;

    if (this.disposed || slot.jobId !== jobId) {
      return;
    }

    this.timeouts += 1;
    this.replaceWorker(slot);
    this.finishJobWithFallback(slot, jobId);
  }

  private replaceWorker(slot: WorkerSlot): void {
    this.clearSlotTimer(slot);
    slot.worker.terminate();

    if (slot.restarts >= this.maxWorkerRestarts) {
      this.removeSlot(slot);
      return;
    }

    const worker = this.spawnWorker();

    if (worker === null) {
      this.removeSlot(slot);
      return;
    }

    slot.restarts += 1;
    this.restarts += 1;
    slot.worker = worker;
    this.attachListeners(slot, worker);
  }

  private removeSlot(slot: WorkerSlot): void {
    const index = this.workerSlots.indexOf(slot);

    if (index >= 0) {
      this.workerSlots.splice(index, 1);
    }
  }

  private finishJobWithFallback(slot: WorkerSlot, jobId: number): void {
    this.clearSlotTimer(slot);
    const job = this.pendingJobs.get(jobId);
    this.pendingJobs.delete(jobId);
    slot.busy = false;
    slot.jobId = null;

    if (job !== undefined) {
      this.resolveWithFallback(job);
    }

    this.pumpQueue();
  }

  private resolveWithFallback(job: PendingTerrainJob): void {
    try {
      job.resolve(this.generateChunkFallback(job.coord, job.seed, job.config));
    } catch (error: unknown) {
      job.reject(error);
    }
  }

  private clearSlotTimer(slot: WorkerSlot): void {
    if (slot.timer !== null) {
      clearTimeout(slot.timer);
      slot.timer = null;
    }
  }

  private allocateJobId(): number {
    for (let attempts = 0; attempts < Number.MAX_SAFE_INTEGER; attempts += 1) {
      const jobId = this.nextJobId;
      this.nextJobId += 1;

      if (this.nextJobId >= Number.MAX_SAFE_INTEGER) {
        this.nextJobId = 1;
      }

      if (!this.pendingJobs.has(jobId)) {
        return jobId;
      }
    }

    throw new Error("ProceduralWorkerPool esgotou IDs de job disponíveis.");
  }

  private generateChunkFallback(
    coord: Vector3Chunk,
    seed: number,
    config: ResolvedGenerationConfig,
  ): ChunkDataMatrix {
    this.fallbacks += 1;

    if (this.fallbackGenerator === null) {
      this.fallbackGenerator = new TerrainGenerator(seed, config);
    } else {
      if (this.fallbackGenerator.getSeed() !== seed) {
        this.fallbackGenerator.reseed(seed);
      }

      this.fallbackGenerator.setConfig(config);
    }

    return this.fallbackGenerator.generateChunk(coord);
  }
}
