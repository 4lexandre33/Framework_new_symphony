import type { Plugin, PluginContext } from "@core";
import { ScriptingToken } from "../../tokens/scripting";
import { WorldToken } from "../../tokens/world";
import { CameraToken } from "../../tokens/camera";
import { AudioToken } from "../../tokens/audio";
import { AnimationToken } from "../../tokens/anim";
import { UIToken } from "../../tokens/ui";
import { VfxToken } from "../../tokens/vfx";
import type { GameTickPayload } from "../../contracts/game-loop/types";
import { AdvanceDialogueCommand, CutsceneFinishedEvent, CutsceneKeyframeEvent, CutscenePausedEvent, CutsceneStartedEvent, DialogueEndedEvent, DialogueNodeChangedEvent, PlayCutsceneCommand, QuestCompletedEvent, QuestFailedEvent, QuestStepUpdatedEvent, StartQuestCommand, TriggerZoneEnteredEvent, TriggerZoneExitedEvent, type AdvanceDialoguePayload, type DialogueNode, type PlayCutscenePayload, type StartQuestPayload } from "../../contracts/scripting/types";
import { ScriptingService } from "../../engine/scripting/internal/ScriptingService";

export const scriptingManifest: Plugin["manifest"] = {
  id: "game.scripting",
  name: "Narrative, Cutscenes, Dialogues & Quests Plugin",
  version: "1.0.0",
  kind: "preloaded",
  authority: "game",
  dependsOn: [
    {
      id: "game.loop",
      range: "^1.0.0",
    },
  ],
  permissions: {
    capabilities: [
      ScriptingToken.id,
      WorldToken.id,
      CameraToken.id,
      AudioToken.id,
      AnimationToken.id,
      UIToken.id,
      VfxToken.id,
    ],
    events: [
      CutsceneStartedEvent.type,
      CutsceneFinishedEvent.type,
      CutsceneKeyframeEvent.type,
      CutscenePausedEvent.type,
      DialogueNodeChangedEvent.type,
      DialogueEndedEvent.type,
      QuestStepUpdatedEvent.type,
      QuestCompletedEvent.type,
      QuestFailedEvent.type,
      TriggerZoneEnteredEvent.type,
      TriggerZoneExitedEvent.type,
      "game.loop.tick",
      "game.world.entity-spawned",
      "game.world.entity-despawned",
    ],
  },
  capabilities: {
    provides: [
      {
        id: ScriptingToken.id,
        version: "1.0.0",
      },
    ],
    consumes: [
      {
        id: WorldToken.id,
        range: "^1.0.0",
        optional: false,
      },
      // Opcionais: trilhas de cutscene e falas/animação de diálogo (G10/G125).
      { id: CameraToken.id, range: "^1.0.0", optional: true },
      { id: AudioToken.id, range: "^1.0.0", optional: true },
      { id: AnimationToken.id, range: "^1.0.0", optional: true },
      { id: VfxToken.id, range: "^1.0.0", optional: true },
    ],
    conflicts: [],
  },
};

export function createScriptingPlugin(): Plugin {
  return {
    manifest: scriptingManifest,

    setup(ctx: PluginContext): void {
      const scriptingService = new ScriptingService(ctx);

      ctx.caps.provide(ScriptingToken, scriptingService);

      ctx.events.define(CutsceneStartedEvent);
      ctx.events.define(CutsceneFinishedEvent);
      ctx.events.define(DialogueNodeChangedEvent);
      ctx.events.define(QuestStepUpdatedEvent);
      ctx.events.define(TriggerZoneEnteredEvent);
      ctx.events.define(TriggerZoneExitedEvent);
      ctx.events.define(CutsceneKeyframeEvent);
      ctx.events.define(CutscenePausedEvent);
      ctx.events.define(DialogueEndedEvent);
      ctx.events.define(QuestCompletedEvent);
      ctx.events.define(QuestFailedEvent);

      ctx.commands.define(PlayCutsceneCommand);
      ctx.commands.define(AdvanceDialogueCommand);
      ctx.commands.define(StartQuestCommand);

      const unbindTick = ctx.events.on("game.loop.tick", (env): void => {
        const payload = env.payload as GameTickPayload;
        scriptingService.update(payload.deltaSeconds);
      });

      // Despawn no mundo: a entidade sai das zonas (G127); spawn com tags
      // que casam `targetTags` passa a ser verificado sozinho (G10).
      const unbindSpawned = ctx.events.on("game.world.entity-spawned", (env): void => {
        const payload = env.payload as { entityId?: unknown } | undefined;
        if (payload && typeof payload.entityId === "string") {
          scriptingService.handleWorldEntitySpawned(payload.entityId);
        }
      });

      const unbindDespawned = ctx.events.on("game.world.entity-despawned", (env): void => {
        const payload = env.payload as { entityId?: unknown } | undefined;
        if (payload && typeof payload.entityId === "string") {
          scriptingService.removeEntityFromZones(payload.entityId);
        }
      });

      // Comandos tolerantes a payload ausente/inválido (G129).
      const unbindPlayCutscene = ctx.commands.handle(
        PlayCutsceneCommand.type,
        (env): boolean => {
          const payload = env.payload as Partial<PlayCutscenePayload> | undefined;
          if (!payload || typeof payload.cutsceneId !== "string") return false;
          return scriptingService.playCutscene(payload.cutsceneId);
        },
      );

      const unbindAdvanceDialogue = ctx.commands.handle(
        AdvanceDialogueCommand.type,
        (env): DialogueNode | null => {
          const payload = env.payload as Partial<AdvanceDialoguePayload> | undefined;
          const choiceIndex = typeof payload?.choiceIndex === "number" ? payload.choiceIndex : undefined;
          return scriptingService.advanceDialogue(choiceIndex);
        },
      );

      const unbindStartQuest = ctx.commands.handle(
        StartQuestCommand.type,
        (env): boolean => {
          const payload = env.payload as Partial<StartQuestPayload> | undefined;
          if (!payload || typeof payload.questId !== "string") return false;
          return scriptingService.startQuest(
            payload.questId,
            payload.restart === true ? { restart: true } : undefined,
          );
        },
      );

      ctx.lifecycle.onDispose((): void => {
        unbindTick();
        unbindPlayCutscene();
        unbindAdvanceDialogue();
        unbindStartQuest();
        unbindSpawned();
        unbindDespawned();
        scriptingService.dispose();
      });

      ctx.lifecycle.ready();
    },
  };
}