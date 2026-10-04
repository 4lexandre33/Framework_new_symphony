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
  createModId,
  createSaveSlotId,
} from "../src/domain/ports";

import type {
  ClockPort,
  DomainSaveGamePort,
  DomainSaveGameRecord,
  DomainSaveState,
  ModDescriptor,
  ModdingPort,
  ModdingPortError,
  SaveGamePortError,
  SaveGameSummary,
  SaveSlotId,
} from "../src/domain/ports";

import {
  createSnapshotBundle,
  createSnapshotSlotId,
  createSnapshotTypeId,
} from "../src/domain/snapshots";

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

class MemoryDomainSaveGamePort
  implements DomainSaveGamePort {
  private readonly records =
    new Map<
      SaveSlotId,
      DomainSaveGameRecord
    >();

  public async listSlots() {
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
        label:
          record.label,
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
      Object.freeze(
        summaries,
      ),
    );
  }

  public async load(
    slotId: SaveSlotId,
  ) {
    return domainOk(
      this.records.get(
        slotId,
      ) ??
      null,
    );
  }

  public async save(
    slotId: SaveSlotId,
    snapshot:
      import(
        "../src/domain/ports"
      ).DomainSaveSnapshot,
    label:
      string | null =
        null,
  ) {
    const record:
      DomainSaveGameRecord =
      Object.freeze({
        slotId,
        snapshot,
        updatedAtEpochMs:
          snapshot
            .createdAtEpochMs,
        label,
      });

    this.records.set(
      slotId,
      record,
    );

    return domainOk(
      record,
    );
  }

  public async delete(
    slotId: SaveSlotId,
  ) {
    return domainOk(
      this.records.delete(
        slotId,
      ),
    );
  }
}

class MemoryModdingPort
  implements ModdingPort {
  private readonly mods =
    new Map<
      string,
      ModDescriptor
    >();

  public constructor() {
    const id =
      createModId(
        "mod.example",
      );

    this.mods.set(
      id,
      Object.freeze({
        id,
        name:
          "Example Mod",
        version: "1.0.0",
        enabled: false,
        origin: "local",
      }),
    );
  }

  public async listInstalled() {
    return domainOk(
      Object.freeze(
        [...this.mods.values()],
      ),
    );
  }

  public async refresh() {
    return this.listInstalled();
  }

  public async setEnabled(
    modId:
      import(
        "../src/domain/ports"
      ).ModId,
    enabled: boolean,
  ) {
    const current =
      this.mods.get(
        modId,
      );

    if (
      current === undefined
    ) {
      const error:
        ModdingPortError =
        Object.freeze({
          code: "not-found",
          message:
            "Mod inexistente.",
          recoverable: true,
        });

      return domainErr(
        error,
      );
    }

    const next:
      ModDescriptor =
      Object.freeze({
        ...current,
        enabled,
      });

    this.mods.set(
      modId,
      next,
    );

    return domainOk(next);
  }
}

describe(
  "Etapa 65 — Ports Review",
  () => {
    it(
      "ClockPort permanece mínimo e separado de SimulationTick",
      () => {
        const clock:
          ClockPort =
          new FixedClock(
            1_700_000_000_000,
          );

        expect(
          clock.nowEpochMs(),
        ).toBe(
          1_700_000_000_000,
        );
      },
    );

    it(
      "DomainSaveGamePort especializa SaveGamePort para SnapshotBundle",
      async () => {
        const port =
          new MemoryDomainSaveGamePort();

        const state:
          DomainSaveState =
          createSnapshotBundle([
            {
              slotId:
                createSnapshotSlotId(
                  "world.state",
                ),
              typeId:
                createSnapshotTypeId(
                  "runtime.test",
                ),
              schemaVersion: 1,
              state: {
                value: 42,
              },
            },
          ]);

        const snapshot =
          createVersionedSnapshot(
            3,
            1_700_000_000_000,
            state,
          );

        const slotId =
          createSaveSlotId(
            "slot-main",
          );

        const saved =
          await port.save(
            slotId,
            snapshot,
            "Main",
          );

        expect(saved.ok).toBe(
          true,
        );

        const loaded =
          await port.load(
            slotId,
          );

        expect(loaded.ok).toBe(
          true,
        );

        if (!loaded.ok) {
          throw new Error(
            "Load deveria passar.",
          );
        }

        expect(
          loaded.value
            ?.snapshot.state,
        ).toEqual(state);

        const listed =
          await port.listSlots();

        expect(listed.ok).toBe(
          true,
        );

        if (!listed.ok) {
          throw new Error(
            "List deveria passar.",
          );
        }

        expect(
          listed.value,
        ).toEqual([
          {
            slotId:
              "slot-main",
            schemaVersion: 3,
            createdAtEpochMs:
              1_700_000_000_000,
            updatedAtEpochMs:
              1_700_000_000_000,
            label: "Main",
          },
        ]);
      },
    );

    it(
      "ModdingPort permanece abstrato e expressa falhas via DomainResult",
      async () => {
        const port:
          ModdingPort =
          new MemoryModdingPort();

        const enabled =
          await port.setEnabled(
            createModId(
              "mod.example",
            ),
            true,
          );

        expect(enabled).toEqual({
          ok: true,
          value: {
            id: "mod.example",
            name: "Example Mod",
            version: "1.0.0",
            enabled: true,
            origin: "local",
          },
        });

        const missing =
          await port.setEnabled(
            createModId(
              "mod.missing",
            ),
            true,
          );

        expect(missing).toEqual({
          ok: false,
          error: {
            code: "not-found",
            message:
              "Mod inexistente.",
            recoverable: true,
          },
        });
      },
    );

    it(
      "SaveGamePortError continua infraestrutura-abstrato",
      () => {
        const error:
          SaveGamePortError =
          Object.freeze({
            code:
              "quota-exceeded",
            message:
              "Sem capacidade.",
            recoverable: true,
          });

        expect(error).toEqual({
          code:
            "quota-exceeded",
          message:
            "Sem capacidade.",
          recoverable: true,
        });
      },
    );
  },
);
