import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  PluginContext,
} from "@core";

import {
  ScriptingService,
} from "../src/engine/scripting/internal/ScriptingService";

import {
  TriggerZoneManager,
} from "../src/engine/scripting/internal/TriggerZoneManager";

function createScriptingContext(
  emitted:
    Array<{
      type: string;
      payload: unknown;
    }>,
): PluginContext {
  return {
    events: {
      emit(
        type: string,
        payload: unknown,
      ): void {
        emitted.push({
          type,
          payload,
        });
      },
    },
  } as unknown as
    PluginContext;
}

describe(
  "Layer 1 Stage 81 — Scripting technical lifecycle",
  (): void => {
    it(
      "clear encerra estado técnico e o serviço pode ser reutilizado após restart lógico",
      (): void => {
        const emitted:
          Array<{
            type: string;
            payload: unknown;
          }> = [];

        const service =
          new ScriptingService(
            createScriptingContext(
              emitted,
            ),
          );

        service.registerCutscene({
          cutsceneId:
            "first",
          durationSeconds:
            1,
          tracks:
            [],
        });

        service.registerQuest({
          questId:
            "technical-quest",
          title:
            "Technical",
          description:
            "Projection only",
          steps: [
            {
              stepId:
                "step",
              description:
                "Signal",
              targetCount:
                1,
              currentCount:
                0,
              isCompleted:
                false,
            },
          ],
          rewardXp:
            999,
          rewardItems: [
            "domain-owned-reward",
          ],
        });

        service.registerTriggerZone({
          zoneId:
            "zone-a",
          shape:
            "sphere",
          position: {
            x: 0,
            y: 0,
            z: 0,
          },
          dimensions: {
            x: 0,
            y: 0,
            z: 2,
          },
          triggerOnce:
            true,
        });

        expect(
          service.playCutscene(
            "first",
          ),
        ).toBe(
          true,
        );

        expect(
          service.startQuest(
            "technical-quest",
          ),
        ).toBe(
          true,
        );

        service.checkEntityInZones(
          "entity-a",
          {
            x: 0,
            y: 0,
            z: 0,
          },
        );

        service.clear();

        expect(
          service.isCutscenePlaying(),
        ).toBe(
          false,
        );

        expect(
          service.getQuestState(
            "technical-quest",
          ),
        ).toBeNull();

        service.registerCutscene({
          cutsceneId:
            "second",
          durationSeconds:
            0.1,
          tracks:
            [],
        });

        expect(
          service.playCutscene(
            "second",
          ),
        ).toBe(
          true,
        );

        service.update(
          1,
        );

        expect(
          service.isCutscenePlaying(),
        ).toBe(
          false,
        );

        expect(
          emitted.some(
            (entry) =>
              entry.type ===
              "game.scripting.cutscene-finished",
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "QuestManager técnico não executa rewards de Domain ao concluir quest",
      (): void => {
        const emitted:
          Array<{
            type: string;
            payload: unknown;
          }> = [];

        const service =
          new ScriptingService(
            createScriptingContext(
              emitted,
            ),
          );

        service.registerQuest({
          questId:
            "projection",
          title:
            "Projection",
          description:
            "No authoritative reward execution",
          steps: [
            {
              stepId:
                "one",
              description:
                "Complete",
              targetCount:
                1,
              currentCount:
                0,
              isCompleted:
                false,
            },
          ],
          rewardXp:
            500,
          rewardItems: [
            "item-domain",
          ],
        });

        service.startQuest(
          "projection",
        );

        const state =
          service.advanceQuestProgress(
            "projection",
            1,
          );

        expect(
          state?.status,
        ).toBe(
          "completed",
        );

        expect(
          emitted.filter(
            (entry) =>
              entry.type ===
              "game.scripting.quest-updated",
          ).length,
        ).toBe(
          2,
        );

        expect(
          emitted.some(
            (entry) =>
              /reward|inventory|xp/iu.test(
                entry.type,
              ),
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "TriggerZoneManager limpa triggerOnce e volta reutilizável após clear",
      (): void => {
        const manager =
          new TriggerZoneManager();

        let enterCount =
          0;

        const callback =
          (
            type:
              "enter" | "exit",
          ): void => {
            if (
              type ===
              "enter"
            ) {
              enterCount +=
                1;
            }
          };

        const config = {
          zoneId:
            "once",
          shape:
            "box" as const,
          position: {
            x: 0,
            y: 0,
            z: 0,
          },
          dimensions: {
            x: 2,
            y: 2,
            z: 2,
          },
          triggerOnce:
            true,
        };

        manager.registerZone(
          config,
        );

        manager.checkEntityInZones(
          "entity",
          {
            x: 0,
            y: 0,
            z: 0,
          },
          callback,
        );

        manager.checkEntityInZones(
          "entity-2",
          {
            x: 0,
            y: 0,
            z: 0,
          },
          callback,
        );

        expect(
          enterCount,
        ).toBe(
          1,
        );

        manager.clear();
        manager.registerZone(
          config,
        );

        manager.checkEntityInZones(
          "entity-3",
          {
            x: 0,
            y: 0,
            z: 0,
          },
          callback,
        );

        expect(
          enterCount,
        ).toBe(
          2,
        );
      },
    );
  },
);
