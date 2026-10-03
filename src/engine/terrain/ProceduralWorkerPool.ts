import type {
  BiomeDescriptor,
  ChunkDataMatrix,
  Vector3Chunk,
} from "../../contracts/terrain/types";

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
    number | null;
}

export class ProceduralWorkerPool {
  private readonly maxWorkers:
    number;

  private readonly workerSlots:
    WorkerSlot[] = [];

  private readonly queuedJobs:
    PendingTerrainJob[] = [];

  private readonly pendingJobs =
    new Map<
      number,
      PendingTerrainJob
    >();

  private nextJobId =
    1;

  public constructor(
    maxWorkers = 2,
  ) {
    this.maxWorkers =
      Math.max(
        0,
        Math.floor(
          Number.isFinite(
            maxWorkers,
          )
            ? maxWorkers
            : 2,
        ),
      );

    this.initializeWorkers();
  }

  public requestChunkGenerationAsync(
    coord:
      Vector3Chunk,
    seed:
      number,
  ): Promise<ChunkDataMatrix> {
    if (
      this.workerSlots
        .length ===
      0
    ) {
      return Promise.resolve(
        this.generateChunkFallback(
          coord,
          seed,
        ),
      );
    }

    const jobId =
      this.nextJobId;

    this.nextJobId +=
      1;

    return new Promise<
      ChunkDataMatrix
    >(
      (
        resolve,
        reject,
      ): void => {
        this.queuedJobs.push({
          jobId,

          coord: {
            x:
              coord.x,

            y:
              coord.y,

            z:
              coord.z,
          },

          seed,

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
      let index = 0;
      index <
      this.workerSlots.length;
      index += 1
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

  public clear(): void {
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
      let index = 0;
      index <
      this.workerSlots.length;
      index += 1
    ) {
      this.workerSlots[
        index
      ]?.worker.terminate();
    }

    this.workerSlots.length =
      0;
  }

  private initializeWorkers():
    void {
    if (
      this.maxWorkers ===
        0 ||
      typeof Worker ===
        "undefined"
    ) {
      return;
    }

    for (
      let index = 0;
      index <
      this.maxWorkers;
      index += 1
    ) {
      try {
        const worker =
          new Worker(
            new URL(
              "./terrain.worker.ts",
              import.meta.url,
            ),
            {
              type:
                "module",
            },
          );

        const slot:
          WorkerSlot = {
            worker,

            busy:
              false,

            jobId:
              null,
          };

        worker.onmessage =
          (
            event:
              MessageEvent<TerrainWorkerResponse>,
          ): void => {
            this.handleWorkerMessage(
              slot,
              event.data,
            );
          };

        worker.onerror =
          (
            event:
              ErrorEvent,
          ): void => {
            this.handleWorkerError(
              slot,
              event,
            );
          };

        this.workerSlots.push(
          slot,
        );
      } catch {
        break;
      }
    }
  }

  private pumpQueue():
    void {
    for (
      let index = 0;
      index <
      this.workerSlots.length;
      index += 1
    ) {
      const slot =
        this.workerSlots[
          index
        ];

      if (
        !slot ||
        slot.busy
      ) {
        continue;
      }

      const job =
        this.queuedJobs.shift();

      if (!job) {
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

      slot.worker.postMessage(
        request,
      );
    }
  }

  private handleWorkerMessage(
    slot:
      WorkerSlot,
    response:
      TerrainWorkerResponse,
  ): void {
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

    if (job) {
      if (
        response.error
      ) {
        job.reject(
          new Error(
            response.error,
          ),
        );
      } else if (
        response.chunk
      ) {
        job.resolve(
          response.chunk,
        );
      } else {
        job.reject(
          new Error(
            "Worker de terreno respondeu sem ChunkDataMatrix.",
          ),
        );
      }
    }

    this.pumpQueue();
  }

  private handleWorkerError(
    slot:
      WorkerSlot,
    event:
      ErrorEvent,
  ): void {
    const jobId =
      slot.jobId;

    if (
      jobId !==
      null
    ) {
      const job =
        this.pendingJobs.get(
          jobId,
        );

      this.pendingJobs.delete(
        jobId,
      );

      job?.reject(
        new Error(
          event.message ||
            "Falha desconhecida no Worker de terreno.",
        ),
      );
    }

    slot.busy =
      false;

    slot.jobId =
      null;

    this.pumpQueue();
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
      let localX = 0;
      localX <
      sizeX;
      localX += 1
    ) {
      for (
        let localZ = 0;
        localZ <
        sizeZ;
        localZ += 1
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
          let localY = 0;
          localY <
          sizeY;
          localY += 1
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