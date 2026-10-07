import type {
  PluginContext,
} from "@core";

import type {
  ScriptingApi,
} from "../../../tokens/scripting";

import {
  CutsceneFinishedEvent,
  CutsceneStartedEvent,
  DialogueNodeChangedEvent,
  QuestStepUpdatedEvent,
  TriggerZoneEnteredEvent,
  TriggerZoneExitedEvent,
  type CutsceneDescriptor,
  type DialogueNode,
  type DialogueTreeDescriptor,
  type QuestDescriptor,
  type QuestState,
  type TriggerZoneConfig,
  type Vector3Scripting,
} from "../../../contracts/scripting/types";

import {
  CutsceneTimeline,
  type TimelineEventCallback,
} from "./CutsceneTimeline";

import {
  DialogueTreeParser,
} from "./DialogueTreeParser";

import {
  QuestManager,
} from "./QuestManager";

import {
  TriggerZoneManager,
  type TriggerZoneCallback,
} from "./TriggerZoneManager";

export class ScriptingService
  implements ScriptingApi {
  private readonly timeline =
    new CutsceneTimeline();

  private readonly dialogueParser =
    new DialogueTreeParser();

  private readonly questManager =
    new QuestManager();

  private readonly triggerManager =
    new TriggerZoneManager();

  private readonly onTimelineKeyframe:
    TimelineEventCallback =
      (
        actionType,
        targetId,
        payload,
      ): void => {
        console.debug(
          `[CutsceneTimeline] Action '${actionType}' triggered for '${targetId}'`,
          payload,
        );
      };

  private readonly onTriggerZoneEvent:
    TriggerZoneCallback =
      (
        type,
        zoneId,
        entityId,
        position,
      ): void => {
        if (
          type ===
          "enter"
        ) {
          this.ctx.events.emit(
            TriggerZoneEnteredEvent.type,
            {
              zoneId,
              entityId,
              position,
            },
          );

          return;
        }

        this.ctx.events.emit(
          TriggerZoneExitedEvent.type,
          {
            zoneId,
            entityId,
          },
        );
      };

  public constructor(
    private readonly ctx:
      PluginContext,
  ) {}

  public registerCutscene(
    descriptor: CutsceneDescriptor,
  ): void {
    this.timeline.registerCutscene(
      descriptor,
    );
  }

  public playCutscene(
    cutsceneId: string,
  ): boolean {
    const started =
      this.timeline.play(
        cutsceneId,
      );

    if (!started) {
      return false;
    }

    this.ctx.events.emit(
      CutsceneStartedEvent.type,
      {
        cutsceneId,

        durationSeconds:
          this.timeline
            .currentDurationSeconds ??
          0,
      },
    );

    return true;
  }

  public pauseCutscene(): void {
    this.timeline.pause();
  }

  public stopCutscene(): void {
    const cutsceneId =
      this.timeline
        .currentCutsceneId;

    this.timeline.stop();

    if (cutsceneId) {
      this.ctx.events.emit(
        CutsceneFinishedEvent.type,
        {
          cutsceneId,
        },
      );
    }
  }

  public isCutscenePlaying():
    boolean {
    return this.timeline.playing;
  }

  public registerDialogueTree(
    descriptor: DialogueTreeDescriptor,
  ): void {
    this.dialogueParser
      .registerTree(
        descriptor,
      );
  }

  public startDialogue(
    treeId: string,
    startNodeId?: string,
  ): DialogueNode | null {
    const node =
      this.dialogueParser
        .startDialogue(
          treeId,
          startNodeId,
        );

    if (node) {
      this.ctx.events.emit(
        DialogueNodeChangedEvent.type,
        {
          treeId,
          currentNode:
            node,
        },
      );
    }

    return node;
  }

  public advanceDialogue(
    choiceIndex?: number,
  ): DialogueNode | null {
    const node =
      this.dialogueParser
        .advanceDialogue(
          choiceIndex,
        );

    const treeId =
      this.dialogueParser
        .currentTreeId;

    if (
      node &&
      treeId
    ) {
      this.ctx.events.emit(
        DialogueNodeChangedEvent.type,
        {
          treeId,
          currentNode:
            node,
        },
      );
    }

    return node;
  }

  public getCurrentDialogueNode():
    DialogueNode | null {
    return this.dialogueParser
      .getCurrentNode();
  }

  public registerQuest(
    descriptor: QuestDescriptor,
  ): void {
    this.questManager
      .registerQuest(
        descriptor,
      );
  }

  public startQuest(
    questId: string,
  ): boolean {
    const started =
      this.questManager
        .startQuest(
          questId,
        );

    if (!started) {
      return false;
    }

    const state =
      this.questManager
        .getQuestState(
          questId,
        );

    if (state) {
      this.ctx.events.emit(
        QuestStepUpdatedEvent.type,
        {
          questId,
          questState:
            state,
        },
      );
    }

    return true;
  }

  public advanceQuestProgress(
    questId: string,
    amount = 1,
  ): QuestState | null {
    const state =
      this.questManager
        .advanceQuestProgress(
          questId,
          amount,
        );

    if (state) {
      this.ctx.events.emit(
        QuestStepUpdatedEvent.type,
        {
          questId,
          questState:
            state,
        },
      );
    }

    return state;
  }

  public getQuestState(
    questId: string,
  ): QuestState | null {
    return this.questManager
      .getQuestState(
        questId,
      );
  }

  public registerTriggerZone(
    config: TriggerZoneConfig,
  ): void {
    this.triggerManager
      .registerZone(
        config,
      );
  }

  public unregisterTriggerZone(
    zoneId: string,
  ): boolean {
    return this.triggerManager
      .unregisterZone(
        zoneId,
      );
  }

  public checkEntityInZones(
    entityId: string,
    position: Vector3Scripting,
  ): void {
    this.triggerManager
      .checkEntityInZones(
        entityId,
        position,
        this.onTriggerZoneEvent,
      );
  }

  public update(
    deltaSeconds: number,
  ): void {
    const finishedCutsceneId =
      this.timeline.update(
        deltaSeconds,
        this.onTimelineKeyframe,
      );

    if (finishedCutsceneId) {
      this.emitCutsceneFinished(
        finishedCutsceneId,
      );
    }
  }

  public clear(): void {
    this.timeline.clear();
    this.dialogueParser.clear();
    this.questManager.clear();
    this.triggerManager.clear();
  }

  private emitCutsceneFinished(
    cutsceneId: string,
  ): void {
    /*
     * A alocação do payload acontece somente no evento terminal da
     * cutscene, nunca no caminho comum de cada tick. Não reutilizamos
     * payload mutável porque EventBusApi.emit() enfileira a referência.
     */
    this.ctx.events.emit(
      CutsceneFinishedEvent.type,
      {
        cutsceneId,
      },
    );
  }
}
