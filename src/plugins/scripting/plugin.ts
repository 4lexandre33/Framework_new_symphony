import type { Plugin, PluginContext } from "@core";
import { ScriptingToken } from "../../tokens/scripting";
import { WorldToken } from "../../tokens/world";
import { CameraToken } from "../../tokens/camera";
import { AudioToken } from "../../tokens/audio";
import { AnimationToken } from "../../tokens/anim";
import { UIToken } from "../../tokens/ui";
import type { GameTickPayload } from "../../contracts/game-loop/types";
import { AdvanceDialogueCommand, CutsceneFinishedEvent, CutsceneStartedEvent, DialogueNodeChangedEvent, PlayCutsceneCommand, QuestStepUpdatedEvent, StartQuestCommand, TriggerZoneEnteredEvent, TriggerZoneExitedEvent, type AdvanceDialoguePayload, type DialogueNode, type PlayCutscenePayload, type StartQuestPayload } from "../../contracts/scripting/types";
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
    ],
    events: [
      CutsceneStartedEvent.type,
      CutsceneFinishedEvent.type,
      DialogueNodeChangedEvent.type,
      QuestStepUpdatedEvent.type,
      TriggerZoneEnteredEvent.type,
      TriggerZoneExitedEvent.type,
      "game.loop.tick",
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

      ctx.commands.define(PlayCutsceneCommand);
      ctx.commands.define(AdvanceDialogueCommand);
      ctx.commands.define(StartQuestCommand);

      const unbindTick = ctx.events.on("game.loop.tick", (env): void => {
        const payload = env.payload as GameTickPayload;
        scriptingService.update(payload.deltaSeconds);
      });

      const unbindPlayCutscene = ctx.commands.handle(
        PlayCutsceneCommand.type,
        (env): boolean => {
          const payload = env.payload as PlayCutscenePayload;
          return scriptingService.playCutscene(payload.cutsceneId);
        },
      );

      const unbindAdvanceDialogue = ctx.commands.handle(
        AdvanceDialogueCommand.type,
        (env): DialogueNode | null => {
          const payload = env.payload as AdvanceDialoguePayload;
          return scriptingService.advanceDialogue(payload.choiceIndex);
        },
      );

      const unbindStartQuest = ctx.commands.handle(
        StartQuestCommand.type,
        (env): boolean => {
          const payload = env.payload as StartQuestPayload;
          return scriptingService.startQuest(payload.questId);
        },
      );

      ctx.lifecycle.onDispose((): void => {
        unbindTick();
        unbindPlayCutscene();
        unbindAdvanceDialogue();
        unbindStartQuest();
        scriptingService.clear();
      });

      ctx.lifecycle.ready();
    },
  };
}