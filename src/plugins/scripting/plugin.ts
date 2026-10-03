import type { Plugin, PluginContext } from "../../core/contracts/plugin-context";
import { ScriptingToken, type ScriptingApi } from "../../tokens/scripting";
import { WorldToken } from "../../tokens/world";
import { CameraToken } from "../../tokens/camera";
import { AudioToken } from "../../tokens/audio";
import { AnimationToken } from "../../tokens/anim";
import { UIToken } from "../../tokens/ui";
import type { GameTickPayload } from "../../contracts/game-loop/types";
import {
  AdvanceDialogueCommand,
  CutsceneFinishedEvent,
  CutsceneStartedEvent,
  DialogueNodeChangedEvent,
  PlayCutsceneCommand,
  QuestStepUpdatedEvent,
  StartQuestCommand,
  TriggerZoneEnteredEvent,
  TriggerZoneExitedEvent,
  type AdvanceDialoguePayload,
  type CutsceneDescriptor,
  type DialogueNode,
  type DialogueTreeDescriptor,
  type PlayCutscenePayload,
  type QuestDescriptor,
  type QuestState,
  type StartQuestPayload,
  type TriggerZoneConfig,
  type Vector3Scripting,
} from "../../contracts/scripting/types";
import { CutsceneTimeline } from "../../engine/scripting/CutsceneTimeline";
import { DialogueTreeParser } from "../../engine/scripting/DialogueTreeParser";
import { QuestManager } from "../../engine/scripting/QuestManager";
import { TriggerZoneManager } from "../../engine/scripting/TriggerZoneManager";

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
      },
    ],
  },
};

export class ScriptingService implements ScriptingApi {
  private readonly timeline = new CutsceneTimeline();
  private readonly dialogueParser = new DialogueTreeParser();
  private readonly questManager = new QuestManager();
  private readonly triggerManager = new TriggerZoneManager();

  public constructor(private readonly ctx: PluginContext) {}

  public registerCutscene(descriptor: CutsceneDescriptor): void {
    this.timeline.registerCutscene(descriptor);
  }

  public playCutscene(cutsceneId: string): boolean {
    const started = this.timeline.play(cutsceneId);
    if (!started) return false;

    this.ctx.events.emit(CutsceneStartedEvent.type, {
      cutsceneId,
      durationSeconds: this.timeline.currentDurationSeconds ?? 0,
    });

    return true;
  }

  public pauseCutscene(): void {
    this.timeline.pause();
  }

  public stopCutscene(): void {
    const cutsceneId = this.timeline.currentCutsceneId;
    this.timeline.stop();

    if (cutsceneId) {
      this.ctx.events.emit(CutsceneFinishedEvent.type, { cutsceneId });
    }
  }

  public isCutscenePlaying(): boolean {
    return this.timeline.playing;
  }

  public registerDialogueTree(descriptor: DialogueTreeDescriptor): void {
    this.dialogueParser.registerTree(descriptor);
  }

  public startDialogue(treeId: string, startNodeId?: string): DialogueNode | null {
    const node = this.dialogueParser.startDialogue(treeId, startNodeId);

    if (node) {
      this.ctx.events.emit(DialogueNodeChangedEvent.type, {
        treeId,
        currentNode: node,
      });
    }

    return node;
  }

  public advanceDialogue(choiceIndex?: number): DialogueNode | null {
    const node = this.dialogueParser.advanceDialogue(choiceIndex);
    const treeId = this.dialogueParser.currentTreeId;

    if (node && treeId) {
      this.ctx.events.emit(DialogueNodeChangedEvent.type, {
        treeId,
        currentNode: node,
      });
    }

    return node;
  }

  public getCurrentDialogueNode(): DialogueNode | null {
    return this.dialogueParser.getCurrentNode();
  }

  public registerQuest(descriptor: QuestDescriptor): void {
    this.questManager.registerQuest(descriptor);
  }

  public startQuest(questId: string): boolean {
    const started = this.questManager.startQuest(questId);
    if (!started) return false;

    const state = this.questManager.getQuestState(questId);
    if (state) {
      this.ctx.events.emit(QuestStepUpdatedEvent.type, {
        questId,
        questState: state,
      });
    }

    return true;
  }

  public advanceQuestProgress(questId: string, amount = 1): QuestState | null {
    const state = this.questManager.advanceQuestProgress(questId, amount);

    if (state) {
      this.ctx.events.emit(QuestStepUpdatedEvent.type, {
        questId,
        questState: state,
      });
    }

    return state;
  }

  public getQuestState(questId: string): QuestState | null {
    return this.questManager.getQuestState(questId);
  }

  public registerTriggerZone(config: TriggerZoneConfig): void {
    this.triggerManager.registerZone(config);
  }

  public unregisterTriggerZone(zoneId: string): boolean {
    return this.triggerManager.unregisterZone(zoneId);
  }

  public checkEntityInZones(entityId: string, position: Vector3Scripting): void {
    this.triggerManager.checkEntityInZones(
      entityId,
      position,
      (type, zoneId, triggeredEntityId, triggeredPosition): void => {
        if (type === "enter") {
          this.ctx.events.emit(TriggerZoneEnteredEvent.type, {
            zoneId,
            entityId: triggeredEntityId,
            position: triggeredPosition,
          });
          return;
        }

        this.ctx.events.emit(TriggerZoneExitedEvent.type, {
          zoneId,
          entityId: triggeredEntityId,
        });
      },
    );
  }

  public update(deltaSeconds: number): void {
    const finishedCutsceneId = this.timeline.update(
      deltaSeconds,
      (actionType, targetId, payload): void => {
        console.debug(
          `[CutsceneTimeline] Action '${actionType}' triggered for '${targetId}'`,
          payload,
        );
      },
    );

    if (finishedCutsceneId) {
      this.ctx.events.emit(CutsceneFinishedEvent.type, {
        cutsceneId: finishedCutsceneId,
      });
    }
  }

  public clear(): void {
    this.timeline.clear();
    this.dialogueParser.clear();
    this.questManager.clear();
    this.triggerManager.clear();
  }
}

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
