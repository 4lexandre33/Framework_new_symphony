import type {
  BiomeDescriptor,
  ChunkDataMatrix,
  Vector3Chunk,
} from "../../../contracts/terrain/types";

import {
  BiomeEvaluator,
} from "./BiomeEvaluator";

import {
  PerlinNoiseService,
} from "./PerlinNoiseService";

interface TerrainWorkerRequest {
  readonly jobId:
    number;

  readonly coord:
    Vector3Chunk;

  readonly seed:
    number;
}

interface TerrainWorkerResponse {
  readonly jobId:
    number;

  readonly chunk?:
    ChunkDataMatrix;

  readonly error?:
    string;
}

interface PendingTerrainJob {
  readonly jobId:
    number;

  readonly coord:
    Vector3Chunk;

  readonly seed:
    number;

  readonly resolve:
    (
      chunk:
        ChunkDataMatrix,
    ) => void;

  readonly reject:
    (
      reason?:
        unknown,
    ) => void;
}

interface WorkerSlot {
  readonly worker:
    Worker;

  busy:
    boolean;

  jobId:
    number |
    null;
}

export interface TerrainChunkWorkerPool {
  requestChunkGenerationAsync(
    coord:
      Vector3Chunk,
    seed:
      number,
  ): Promise<
    ChunkDataMatrix
  >;

  clear(): void;
}

export type ProceduralWorkerFactory =
  () => Worker;

const DEFAULT_MAX_WORKERS =
  2;

function defaultWorkerFactory():
  Worker {
  return new Worker(
    new URL(
      "./terrain.worker.ts",
      import.meta.url,
    ),
    {
      type:
        "module",
    },
  );
}

function cloneCoord(
  coord:
    Vector3Chunk,
): Vector3Chunk {
  return {
    x:
      Number.isFinite(
        coord.x,
      )
        ? Math.trunc(
            coord.x,
          )
        : 0,

    y:
      Number.isFinite(
        coord.y,
      )
        ? Math.trunc(
            coord.y,
          )
        : 0,

    z:
      Number.isFinite(
        coord.z,
      )
        ? Math.trunc(
            coord.z,
          )
        : 0,
  };
}

function normalizeSeed(
  seed:
    number,
): number {
  return Number.isFinite(
    seed,
  )
    ? Math.trunc(
        seed,
      )
    : 1337;
}

export class ProceduralWorkerPool
  implements TerrainChunkWorkerPool {
  private readonly maxWorkers:
    number;

  private readonly workerFactory:
    ProceduralWorkerFactory;

  private readonly workerSlots:
    WorkerSlot[] =
      [];

  private readonly queuedJobs:
    PendingTerrainJob[] =
      [];

  private readonly pendingJobs =
    new Map<
      number,
      PendingTerrainJob
    >();

  private nextJobId =
    1;

  private disposed =
    false;

  public constructor(
    maxWorkers =
      DEFAULT_MAX_WORKERS,
    workerFactory:
      ProceduralWorkerFactory =
        defaultWorkerFactory,
  ) {
    this.maxWorkers =
      Math.max(
        0,
        Math.floor(
          Number.isFinite(
            maxWorkers,
          )
            ? maxWorkers
            : DEFAULT_MAX_WORKERS,
        ),
      );

    this.workerFactory =
      workerFactory;

    this.initializeWorkers();
  }

  public requestChunkGenerationAsync(
    coord:
      Vector3Chunk,
    seed:
      number,
  ): Promise<
    ChunkDataMatrix
  > {
    if (
      this.disposed
    ) {
      return Promise.reject(
        new Error(
          "ProceduralWorkerPool já foi encerrado.",
        ),
      );
    }

    const coordSnapshot =
      cloneCoord(
        coord,
      );

    const safeSeed =
      normalizeSeed(
        seed,
      );

    if (
      this.workerSlots
        .length ===
      0
    ) {
      return Promise.resolve(
        this.generateChunkFallback(
          coordSnapshot,
          safeSeed,
        ),
      );
    }

    const jobId =
      this.allocateJobId();

    return new Promise<
      ChunkDataMatrix
    >(
      (
        resolve,
        reject,
      ): void => {
        this.queuedJobs.push({
          jobId,
          coord:
            coordSnapshot,
          seed:
            safeSeed,
          resolve,
          reject,
        });

        this.pumpQueue();
      },
    );
  }

  public get activeWorkerCount():
    number {
    let active =
      0;

    for (
      let index =
        0;
      index <
      this.workerSlots.length;
      index +=
        1
    ) {
      if (
        this.workerSlots[
          index
        ]?.busy
      ) {
        active +=
          1;
      }
    }

    return active;
  }

  public get queuedJobCount():
    number {
    return this.queuedJobs
      .length;
  }

  public get pendingJobCount():
    number {
    return this.pendingJobs
      .size;
  }

  public get workerCount():
    number {
    return this.workerSlots
      .length;
  }

  public clear(): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.disposed =
      true;

    while (
      this.queuedJobs.length >
      0
    ) {
      const job =
        this.queuedJobs.shift();

      job?.reject(
        new Error(
          "ProceduralWorkerPool foi limpo antes da execução do job.",
        ),
      );
    }

    for (
      const job of
      this.pendingJobs.values()
    ) {
      job.reject(
        new Error(
          "ProceduralWorkerPool foi encerrado durante a execução do job.",
        ),
      );
    }

    this.pendingJobs.clear();

    for (
      let index =
        0;
      index <
      this.workerSlots.length;
      index +=
        1
    ) {
      const slot =
        this.workerSlots[
          index
        ];

      if (
        slot ===
        undefined
      ) {
        continue;
      }

      slot.worker
        .terminate();

      slot.busy =
        false;

      slot.jobId =
        null;
    }

    this.workerSlots.length =
      0;
  }

  private initializeWorkers(): void {
    if (
      this.maxWorkers ===
        0
    ) {
      return;
    }

    for (
      let index =
        0;
      index <
      this.maxWorkers;
      index +=
        1
    ) {
      try {
        const worker =
          this.workerFactory();

        const slot:
          WorkerSlot = {
            worker,
            busy:
              false,
            jobId:
              null,
          };

        worker.addEventListener(
          "message",
          (
            event:
              MessageEvent<
                TerrainWorkerResponse
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
          (
            event:
              ErrorEvent,
          ): void => {
            this.handleWorkerError(
              slot,
              event.message,
            );
          },
        );

        worker.addEventListener(
          "messageerror",
          (): void => {
            this.handleWorkerError(
              slot,
              "Falha ao desserializar resposta do Worker de terreno.",
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

  private pumpQueue(): void {
    if (
      this.disposed
    ) {
      return;
    }

    for (
      let index =
        0;
      index <
      this.workerSlots.length;
      index +=
        1
    ) {
      const slot =
        this.workerSlots[
          index
        ];

      if (
        slot ===
          undefined ||
        slot.busy
      ) {
        continue;
      }

      const job =
        this.queuedJobs.shift();

      if (
        job ===
        undefined
      ) {
        return;
      }

      slot.busy =
        true;

      slot.jobId =
        job.jobId;

      this.pendingJobs.set(
        job.jobId,
        job,
      );

      const request:
        TerrainWorkerRequest = {
          jobId:
            job.jobId,
          coord:
            job.coord,
          seed:
            job.seed,
        };

      try {
        slot.worker
          .postMessage(
            request,
          );
      } catch {
        this.finishJobWithFallback(
          slot,
          job.jobId,
        );
      }
    }
  }

  private handleWorkerMessage(
    slot:
      WorkerSlot,
    response:
      TerrainWorkerResponse,
  ): void {
    if (
      this.disposed ||
      slot.jobId !==
        response.jobId
    ) {
      return;
    }

    const job =
      this.pendingJobs.get(
        response.jobId,
      );

    this.pendingJobs.delete(
      response.jobId,
    );

    slot.busy =
      false;

    slot.jobId =
      null;

    if (
      job !==
      undefined
    ) {
      if (
        response.chunk !==
          undefined &&
        response.error ===
          undefined
      ) {
        job.resolve(
          response.chunk,
        );
      } else {
        job.resolve(
          this.generateChunkFallback(
            job.coord,
            job.seed,
          ),
        );
      }
    }

    this.pumpQueue();
  }

  private handleWorkerError(
    slot:
      WorkerSlot,
    _message:
      string,
  ): void {
    const jobId =
      slot.jobId;

    if (
      jobId ===
      null
    ) {
      return;
    }

    this.finishJobWithFallback(
      slot,
      jobId,
    );
  }

  private finishJobWithFallback(
    slot:
      WorkerSlot,
    jobId:
      number,
  ): void {
    const job =
      this.pendingJobs.get(
        jobId,
      );

    this.pendingJobs.delete(
      jobId,
    );

    slot.busy =
      false;

    slot.jobId =
      null;

    if (
      job !==
      undefined
    ) {
      job.resolve(
        this.generateChunkFallback(
          job.coord,
          job.seed,
        ),
      );
    }

    this.pumpQueue();
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
      "ProceduralWorkerPool esgotou IDs de job disponíveis.",
    );
  }

  private generateChunkFallback(
    coord:
      Vector3Chunk,
    seed:
      number,
  ): ChunkDataMatrix {
    const sizeX =
      16;

    const sizeY =
      128;

    const sizeZ =
      16;

    const blocks =
      new Uint8Array(
        sizeX *
        sizeY *
        sizeZ,
      );

    const noise =
      new PerlinNoiseService(
        seed,
      );

    const biomeEvaluator =
      new BiomeEvaluator(
        seed,
      );

    const worldOffsetX =
      coord.x *
      sizeX;

    const worldOffsetY =
      coord.y *
      sizeY;

    const worldOffsetZ =
      coord.z *
      sizeZ;

    for (
      let localX =
        0;
      localX <
      sizeX;
      localX +=
        1
    ) {
      for (
        let localZ =
          0;
        localZ <
        sizeZ;
        localZ +=
          1
      ) {
        const worldX =
          worldOffsetX +
          localX;

        const worldZ =
          worldOffsetZ +
          localZ;

        const biome:
          BiomeDescriptor =
            biomeEvaluator
              .evaluateBiome({
                x:
                  worldX,
                y:
                  0,
                z:
                  worldZ,
              });

        const heightNoise =
          Math.min(
            1,
            Math.max(
              0,
              (
                noise
                  .fractalNoise2D(
                    worldX *
                      0.01,
                    worldZ *
                      0.01,
                    4,
                    0.5,
                    2,
                  ) +
                1
              ) *
                0.5,
            ),
          );

        const terrainHeight =
          Math.floor(
            biome.minHeight +
            heightNoise *
              (
                biome.maxHeight -
                biome.minHeight
              ),
          );

        for (
          let localY =
            0;
          localY <
          sizeY;
          localY +=
            1
        ) {
          const worldY =
            worldOffsetY +
            localY;

          const blockIndex =
            localX +
            sizeX *
              (
                localZ +
                sizeZ *
                  localY
              );

          if (
            worldY ===
            terrainHeight
          ) {
            blocks[
              blockIndex
            ] =
              biome.surfaceBlockId;
          } else if (
            worldY <
              terrainHeight &&
            worldY >=
              terrainHeight -
                3
          ) {
            blocks[
              blockIndex
            ] =
              biome.subSurfaceBlockId;
          } else if (
            worldY <
            terrainHeight -
              3
          ) {
            blocks[
              blockIndex
            ] =
              2;
          }
        }
      }
    }

    return {
      coord: {
        x:
          coord.x,
        y:
          coord.y,
        z:
          coord.z,
      },
      sizeX,
      sizeY,
      sizeZ,
      blocks,
    };
  }
}
