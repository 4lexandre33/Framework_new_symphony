// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createProgressionSnapshot,
  createUnlockId,
  ExperiencePool,
  ExperiencePoolError,
  LevelProgression,
  ProgressionCurve,
  ProgressionCurveError,
  ProgressionSnapshotError,
  restoreProgressionSnapshot,
  UnlockSet,
  UnlockSetError,
} from "../src/domain/progression";

describe(
  "Etapa 57 — ProgressionCurve",
  () => {
    it(
      "resolve levels por thresholds cumulativos",
      () => {
        const curve =
          new ProgressionCurve([
            0,
            100,
            300,
            600,
          ]);

        expect(
          curve.maxLevel,
        ).toBe(4);

        expect(
          curve
            .getLevelForTotalExperience(
              0,
            ),
        ).toBe(1);

        expect(
          curve
            .getLevelForTotalExperience(
              99,
            ),
        ).toBe(1);

        expect(
          curve
            .getLevelForTotalExperience(
              100,
            ),
        ).toBe(2);

        expect(
          curve
            .getLevelForTotalExperience(
              599,
            ),
        ).toBe(3);

        expect(
          curve
            .getLevelForTotalExperience(
              600,
            ),
        ).toBe(4);

        expect(
          curve
            .getLevelForTotalExperience(
              999999,
            ),
        ).toBe(4);
      },
    );

    it(
      "calcula progresso dentro do nível sem armazenar level",
      () => {
        const curve =
          new ProgressionCurve([
            0,
            100,
            300,
          ]);

        expect(
          curve
            .getExperienceIntoLevel(
              150,
            ),
        ).toBe(50);

        expect(
          curve
            .getExperienceRequiredForNextLevel(
              150,
            ),
        ).toBe(200);

        expect(
          curve
            .getProgress01(
              150,
            ),
        ).toBe(0.25);

        expect(
          curve
            .getExperienceRequiredForNextLevel(
              300,
            ),
        ).toBeNull();

        expect(
          curve
            .getProgress01(
              300,
            ),
        ).toBe(1);
      },
    );

    it(
      "rejeita curva vazia, início diferente de zero e thresholds não crescentes",
      () => {
        expect(() =>
          new ProgressionCurve(
            [],
          ),
        ).toThrow(
          ProgressionCurveError,
        );

        expect(() =>
          new ProgressionCurve([
            10,
            20,
          ]),
        ).toThrow(
          ProgressionCurveError,
        );

        expect(() =>
          new ProgressionCurve([
            0,
            100,
            100,
          ]),
        ).toThrow(
          ProgressionCurveError,
        );
      },
    );

    it(
      "snapshot round-trip preserva curva",
      () => {
        const curve =
          new ProgressionCurve([
            0,
            50,
            125,
          ]);

        const snapshot =
          curve.toSnapshot();

        expect(
          ProgressionCurve
            .fromSnapshot(
              snapshot,
            )
            .toSnapshot(),
        ).toEqual(snapshot);
      },
    );
  },
);

describe(
  "Etapa 57 — ExperiencePool",
  () => {
    it(
      "acumula XP e preserva zero como no-op",
      () => {
        const pool =
          new ExperiencePool(
            10,
          );

        expect(
          pool.add(0),
        ).toBe(10);

        expect(
          pool.add(25),
        ).toBe(35);

        expect(
          pool.totalExperience,
        ).toBe(35);
      },
    );

    it(
      "rejeita valores inválidos e overflow sem mutação",
      () => {
        expect(() =>
          new ExperiencePool(
            -1,
          ),
        ).toThrow(
          ExperiencePoolError,
        );

        const pool =
          new ExperiencePool(
            Number.MAX_SAFE_INTEGER,
          );

        expect(() =>
          pool.add(1),
        ).toThrow(
          ExperiencePoolError,
        );

        expect(
          pool.totalExperience,
        ).toBe(
          Number.MAX_SAFE_INTEGER,
        );
      },
    );

    it(
      "snapshot round-trip preserva XP",
      () => {
        const pool =
          new ExperiencePool(
            1234,
          );

        const snapshot =
          pool.toSnapshot();

        expect(
          ExperiencePool
            .fromSnapshot(
              snapshot,
            )
            .toSnapshot(),
        ).toEqual(snapshot);
      },
    );
  },
);

describe(
  "Etapa 57 — LevelProgression",
  () => {
    function curve() {
      return new ProgressionCurve([
        0,
        100,
        300,
        600,
        1000,
      ]);
    }

    it(
      "deriva level exclusivamente do XP total",
      () => {
        const progression =
          new LevelProgression(
            curve(),
            350,
          );

        expect(
          progression.currentLevel,
        ).toBe(3);

        expect(
          progression
            .experienceIntoLevel,
        ).toBe(50);

        expect(
          progression
            .experienceRequiredForNextLevel,
        ).toBe(300);

        expect(
          progression.levelProgress01,
        ).toBeCloseTo(
          1 / 6,
        );
      },
    );

    it(
      "addExperience reporta múltiplos level-ups sem side effects",
      () => {
        const progression =
          new LevelProgression(
            curve(),
            90,
          );

        const change =
          progression
            .addExperience(
              520,
            );

        expect(change).toEqual({
          previousLevel: 1,
          currentLevel: 4,
          levelsGained: 3,
          previousTotalExperience:
            90,
          currentTotalExperience:
            610,
        });

        expect(
          progression.currentLevel,
        ).toBe(4);
      },
    );

    it(
      "XP acima do último threshold permanece no maxLevel",
      () => {
        const progression =
          new LevelProgression(
            curve(),
            5_000,
          );

        expect(
          progression.currentLevel,
        ).toBe(5);

        expect(
          progression.atMaxLevel,
        ).toBe(true);

        expect(
          progression
            .experienceRequiredForNextLevel,
        ).toBeNull();

        expect(
          progression.levelProgress01,
        ).toBe(1);
      },
    );

    it(
      "snapshot restaura XP e deriva novamente o level pela curve",
      () => {
        const source =
          new LevelProgression(
            curve(),
            600,
          );

        const restored =
          LevelProgression
            .fromSnapshot(
              curve(),
              source.toSnapshot(),
            );

        expect(
          restored.totalExperience,
        ).toBe(600);

        expect(
          restored.currentLevel,
        ).toBe(4);
      },
    );
  },
);

describe(
  "Etapa 57 — UnlockSet",
  () => {
    it(
      "unlock é idempotente e lock é explícito",
      () => {
        const unlocks =
          new UnlockSet();

        const id =
          createUnlockId(
            "unlock.recipe.sword",
          );

        expect(
          unlocks.unlock(id),
        ).toBe(true);

        expect(
          unlocks.unlock(id),
        ).toBe(false);

        expect(
          unlocks.has(id),
        ).toBe(true);

        expect(
          unlocks.lock(id),
        ).toBe(true);

        expect(
          unlocks.has(id),
        ).toBe(false);
      },
    );

    it(
      "snapshot ordena IDs e round-trip preserva set",
      () => {
        const unlocks =
          new UnlockSet([
            createUnlockId(
              "unlock.zeta",
            ),
            createUnlockId(
              "unlock.alpha",
            ),
          ]);

        const snapshot =
          unlocks.toSnapshot();

        expect(
          snapshot.unlockIds,
        ).toEqual([
          "unlock.alpha",
          "unlock.zeta",
        ]);

        expect(
          UnlockSet
            .fromSnapshot(
              snapshot,
            )
            .toSnapshot(),
        ).toEqual(snapshot);
      },
    );

    it(
      "restore rejeita unlock duplicado",
      () => {
        expect(() =>
          UnlockSet
            .fromSnapshot({
              unlockIds: [
                "unlock.a",
                "unlock.a",
              ],
            }),
        ).toThrow(
          UnlockSetError,
        );
      },
    );
  },
);

describe(
  "Etapa 57 — ProgressionSnapshot",
  () => {
    it(
      "agrega apenas estado mutável e restaura usando curve externa",
      () => {
        const curve =
          new ProgressionCurve([
            0,
            100,
            250,
          ]);

        const levelProgression =
          new LevelProgression(
            curve,
            175,
          );

        const unlocks =
          new UnlockSet([
            createUnlockId(
              "unlock.feature.map",
            ),
          ]);

        const snapshot =
          createProgressionSnapshot(
            levelProgression,
            unlocks,
          );

        expect(
          "curve" in snapshot,
        ).toBe(false);

        const restored =
          restoreProgressionSnapshot(
            curve,
            snapshot,
          );

        expect(
          restored
            .levelProgression
            .currentLevel,
        ).toBe(2);

        expect(
          restored
            .levelProgression
            .totalExperience,
        ).toBe(175);

        expect(
          restored.unlocks.has(
            createUnlockId(
              "unlock.feature.map",
            ),
          ),
        ).toBe(true);
      },
    );

    it(
      "rejeita schema incompatível",
      () => {
        const curve =
          new ProgressionCurve([
            0,
          ]);

        const snapshot = {
          schemaVersion: 999,
          levelProgression: {
            totalExperience: 0,
          },
          unlocks: {
            unlockIds: [],
          },
        };

        expect(() =>
          restoreProgressionSnapshot(
            curve,
            snapshot as never,
          ),
        ).toThrow(
          ProgressionSnapshotError,
        );
      },
    );
  },
);
