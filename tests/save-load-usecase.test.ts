// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createVersionedSnapshot,
} from "../src/domain/entities";

import {
  domainErr,
  domainOk,
} from "../src/domain/evaluation";

import {
  createSaveSlotId,
} from "../src/domain/ports";

import type {
  VersionedSnapshot,
} from "../src/domain/entities";

import type {
  ClockPort,
  SaveGamePort,
  SaveGamePortError,
  SaveGameRecord,
  SaveGameSummary,
  SaveSlotId,
} from "../src/domain/ports";

import {
  SaveLoadUseCase,
  SaveLoadUseCaseConfigurationError,
} from "../src/services/usecases";

interface TestState {
  readonly checkpoint:
    string;
  readonly score:
    number;
}

class FixedClock
  implements ClockPort {
  public constructor(
    private readonly value:
      number,
  ) {}

  public nowEpochMs():
    number {
    return this.value;
  }
}

class MemorySaveGamePort
  implements
    SaveGamePort<TestState> {
  private readonly records =
    new Map<
      SaveSlotId,
      SaveGameRecord<TestState>
    >();

  public failure:
    SaveGamePortError | null =
      null;

  public returnedSlotOverride:
    SaveSlotId | null =
      null;

  public async listSlots():
    Promise<
      ReturnType<
        SaveGamePort<TestState>[
          "listSlots"
        ]
      > extends Promise<infer T>
        ? T
        : never
    > {
    if (
      this.failure !== null
    ) {
      return domainErr(
        this.failure,
      );
    }

    const summaries:
      SaveGameSummary[] = [];

    for (
      const record of
      this.records.values()
    ) {
      summaries.push({
        slotId:
          record.slotId,
        schemaVersion:
          record.snapshot
            .schemaVersion,
        createdAtEpochMs:
          record.snapshot
            .createdAtEpochMs,
        updatedAtEpochMs:
          record.updatedAtEpochMs,
        label: record.label,
      });
    }

    summaries.sort(
      (left, right) =>
        left.slotId <
        right.slotId
          ? -1
          : left.slotId >
              right.slotId
            ? 1
            : 0,
    );

    return domainOk(
      summaries,
    );
  }

  public async load(
    slotId: SaveSlotId,
  ) {
    if (
      this.failure !== null
    ) {
      return domainErr(
        this.failure,
      );
    }

    const record =
      this.records.get(
        slotId,
      ) ?? null;

    if (
      record === null
    ) {
      return domainOk(null);
    }

    if (
      this.returnedSlotOverride ===
      null
    ) {
      return domainOk(record);
    }

    return domainOk({
      ...record,
      slotId:
        this.returnedSlotOverride,
    });
  }

  public async save(
    slotId: SaveSlotId,
    snapshot:
      VersionedSnapshot<TestState>,
    label:
      string | null = null,
  ) {
    if (
      this.failure !== null
    ) {
      return domainErr(
        this.failure,
      );
    }

    const storedSlotId =
      this.returnedSlotOverride ??
      slotId;

    const record:
      SaveGameRecord<TestState> = {
        slotId:
          storedSlotId,
        snapshot,
        updatedAtEpochMs:
          snapshot
            .createdAtEpochMs,
        label,
      };

    this.records.set(
      slotId,
      record,
    );

    return domainOk(record);
  }

  public async delete(
    slotId: SaveSlotId,
  ) {
    if (
      this.failure !== null
    ) {
      return domainErr(
        this.failure,
      );
    }

    return domainOk(
      this.records.delete(
        slotId,
      ),
    );
  }

  public seed(
    slotId: SaveSlotId,
    record:
      SaveGameRecord<TestState>,
  ): void {
    this.records.set(
      slotId,
      record,
    );
  }
}

function createUseCase(
  port:
    MemorySaveGamePort,
  schemaVersion = 3,
): SaveLoadUseCase<TestState> {
  return new SaveLoadUseCase({
    saveGamePort: port,
    clock:
      new FixedClock(
        1_700_000_000_123,
      ),
    schemaVersion,
  });
}

describe(
  "Etapa 44.5 — SaveLoadUseCase",
  () => {
    it(
      "salva snapshot versionado usando ClockPort",
      async () => {
        const port =
          new MemorySaveGamePort();

        const useCase =
          createUseCase(port);

        const slotId =
          createSaveSlotId(
            "slot.main",
          );

        const state:
          TestState = {
            checkpoint:
              "forest",
            score: 42,
          };

        const result =
          await useCase.save(
            slotId,
            state,
            "Main Save",
          );

        expect(result.ok).toBe(
          true,
        );

        if (!result.ok) {
          return;
        }

        expect(
          result.value,
        ).toEqual({
          slotId: "slot.main",
          snapshot: {
            schemaVersion: 3,
            createdAtEpochMs:
              1_700_000_000_123,
            state,
          },
          updatedAtEpochMs:
            1_700_000_000_123,
          label: "Main Save",
        });
      },
    );

    it(
      "carrega save compatível",
      async () => {
        const port =
          new MemorySaveGamePort();

        const useCase =
          createUseCase(port);

        const slotId =
          createSaveSlotId(
            "slot.compatible",
          );

        const state:
          TestState = {
            checkpoint:
              "cave",
            score: 90,
          };

        await useCase.save(
          slotId,
          state,
        );

        const result =
          await useCase.load(
            slotId,
          );

        expect(result.ok).toBe(
          true,
        );

        if (result.ok) {
          expect(
            result.value
              .snapshot.state,
          ).toBe(state);

          expect(
            result.value
              .snapshot
              .schemaVersion,
          ).toBe(3);
        }
      },
    );

    it(
      "diferencia slot inexistente de falha do port",
      async () => {
        const port =
          new MemorySaveGamePort();

        const useCase =
          createUseCase(port);

        const missing =
          await useCase.load(
            createSaveSlotId(
              "slot.missing",
            ),
          );

        expect(missing).toEqual({
          ok: false,
          error: {
            code:
              "slot-not-found",
            slotId:
              "slot.missing",
          },
        });

        port.failure = {
          code: "unavailable",
          message:
            "storage offline",
          recoverable: true,
        };

        const failed =
          await useCase.load(
            createSaveSlotId(
              "slot.any",
            ),
          );

        expect(failed).toEqual({
          ok: false,
          error: {
            code: "port-error",
            operation: "load",
            cause:
              port.failure,
          },
        });
      },
    );

    it(
      "rejeita schema incompatível sem tocar em infraestrutura concreta",
      async () => {
        const port =
          new MemorySaveGamePort();

        const slotId =
          createSaveSlotId(
            "slot.old",
          );

        port.seed(
          slotId,
          {
            slotId,
            snapshot:
              createVersionedSnapshot(
                2,
                100,
                {
                  checkpoint:
                    "old",
                  score: 1,
                },
              ),
            updatedAtEpochMs:
              100,
            label: null,
          },
        );

        const result =
          await createUseCase(
            port,
            3,
          ).load(slotId);

        expect(result).toEqual({
          ok: false,
          error: {
            code:
              "unsupported-schema",
            slotId:
              "slot.old",
            expectedSchemaVersion:
              3,
            actualSchemaVersion:
              2,
          },
        });
      },
    );

    it(
      "lista slots através do port",
      async () => {
        const port =
          new MemorySaveGamePort();

        const useCase =
          createUseCase(port);

        await useCase.save(
          createSaveSlotId(
            "slot.b",
          ),
          {
            checkpoint: "b",
            score: 2,
          },
        );

        await useCase.save(
          createSaveSlotId(
            "slot.a",
          ),
          {
            checkpoint: "a",
            score: 1,
          },
        );

        const result =
          await useCase
            .listSlots();

        expect(result.ok).toBe(
          true,
        );

        if (result.ok) {
          expect(
            result.value.map(
              (summary) =>
                summary.slotId,
            ),
          ).toEqual([
            "slot.a",
            "slot.b",
          ]);
        }
      },
    );

    it(
      "delete retorna slot-not-found quando o port informa ausência",
      async () => {
        const port =
          new MemorySaveGamePort();

        const useCase =
          createUseCase(port);

        const slotId =
          createSaveSlotId(
            "slot.delete",
          );

        const missing =
          await useCase.delete(
            slotId,
          );

        expect(missing).toEqual({
          ok: false,
          error: {
            code:
              "slot-not-found",
            slotId,
          },
        });

        await useCase.save(
          slotId,
          {
            checkpoint:
              "delete",
            score: 0,
          },
        );

        const deleted =
          await useCase.delete(
            slotId,
          );

        expect(deleted).toEqual({
          ok: true,
          value: true,
        });
      },
    );

    it(
      "rejeita resposta de port pertencente a outro slot",
      async () => {
        const port =
          new MemorySaveGamePort();

        const useCase =
          createUseCase(port);

        port.returnedSlotOverride =
          createSaveSlotId(
            "slot.wrong",
          );

        const result =
          await useCase.save(
            createSaveSlotId(
              "slot.expected",
            ),
            {
              checkpoint:
                "invalid-adapter",
              score: 0,
            },
          );

        expect(result).toEqual({
          ok: false,
          error: {
            code:
              "invalid-port-response",
            operation: "save",
            expectedSlotId:
              "slot.expected",
            actualSlotId:
              "slot.wrong",
          },
        });
      },
    );

    it(
      "rejeita schemaVersion inválido na composição",
      () => {
        const port =
          new MemorySaveGamePort();

        expect(() =>
          new SaveLoadUseCase({
            saveGamePort: port,
            clock:
              new FixedClock(1),
            schemaVersion: 0,
          }),
        ).toThrow(
          SaveLoadUseCaseConfigurationError,
        );
      },
    );
  },
);
