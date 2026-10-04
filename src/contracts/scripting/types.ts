import { defineEvent, defineCommand } from "@core";

export interface Vector3Scripting {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type TrackType = "camera" | "audio" | "animation" | "vfx" | "dialogue" | "event";

export interface TimelineKeyframe {
  readonly timeSeconds: number;
  readonly actionType: string;
  readonly targetId: string;
  readonly payload: Record<string, unknown>;
}

export interface TimelineTrackDescriptor {
  readonly trackId: string;
  readonly trackType: TrackType;
  readonly keyframes: ReadonlyArray<TimelineKeyframe>;
}

export interface CutsceneDescriptor {
  readonly cutsceneId: string;
  readonly durationSeconds: number;
  readonly tracks: ReadonlyArray<TimelineTrackDescriptor>;
}

// ── ESTRUTURAS DE DIÁLOGO ───────────────────────────────────────────────────

export interface DialogueChoice {
  readonly choiceIndex: number;
  readonly text: string;
  readonly nextNodeId: string;
  readonly conditionVariable?: string;
  readonly requiredValue?: unknown;
}

export interface DialogueNode {
  readonly nodeId: string;
  readonly speakerName: string;
  readonly text: string;
  readonly audioClipUrl?: string;
  readonly animationState?: string;
  readonly choices?: ReadonlyArray<DialogueChoice>;
  readonly defaultNextNodeId?: string;
}

export interface DialogueTreeDescriptor {
  readonly treeId: string;
  readonly startNodeId: string;
  readonly nodes: ReadonlyArray<DialogueNode>;
}

// ── ESTRUTURAS DE QUESTS ────────────────────────────────────────────────────

export type QuestStatus = "not_started" | "active" | "completed" | "failed";

export interface QuestStep {
  readonly stepId: string;
  readonly description: string;
  readonly targetCount: number;
  readonly currentCount: number;
  readonly isCompleted: boolean;
  readonly targetEntityId?: string;
}

export interface QuestDescriptor {
  readonly questId: string;
  readonly title: string;
  readonly description: string;
  readonly steps: ReadonlyArray<QuestStep>;
  readonly rewardXp?: number;
  readonly rewardItems?: ReadonlyArray<string>;
}

export interface QuestState {
  readonly questId: string;
  readonly status: QuestStatus;
  readonly currentStepIndex: number;
  readonly steps: ReadonlyArray<QuestStep>;
  readonly updatedAtTimestamp: number;
}

// ── ESTRUTURAS DE TRIGGER ZONES ─────────────────────────────────────────────

export type TriggerZoneShape = "box" | "sphere" | "cylinder";

export interface TriggerZoneConfig {
  readonly zoneId: string;
  readonly shape: TriggerZoneShape;
  readonly position: Vector3Scripting;
  readonly dimensions: Vector3Scripting; // x=largura, y=altura, z=profundidade/raio
  readonly triggerOnce: boolean;
  readonly targetTags?: ReadonlyArray<string>;
}

// ── EVENTOS DE SCRIPTING ────────────────────────────────────────────────────

export interface CutsceneStartedPayload {
  readonly cutsceneId: string;
  readonly durationSeconds: number;
}

export const CutsceneStartedEvent = defineEvent<
  "game.scripting.cutscene-started",
  CutsceneStartedPayload
>("game.scripting.cutscene-started");

export interface CutsceneFinishedPayload {
  readonly cutsceneId: string;
}

export const CutsceneFinishedEvent = defineEvent<
  "game.scripting.cutscene-finished",
  CutsceneFinishedPayload
>("game.scripting.cutscene-finished");

export interface DialogueNodeChangedPayload {
  readonly treeId: string;
  readonly currentNode: DialogueNode;
}

export const DialogueNodeChangedEvent = defineEvent<
  "game.scripting.dialogue-changed",
  DialogueNodeChangedPayload
>("game.scripting.dialogue-changed");

export interface QuestStepUpdatedPayload {
  readonly questId: string;
  readonly questState: QuestState;
}

export const QuestStepUpdatedEvent = defineEvent<
  "game.scripting.quest-updated",
  QuestStepUpdatedPayload
>("game.scripting.quest-updated");

export interface TriggerZoneEnteredPayload {
  readonly zoneId: string;
  readonly entityId: string;
  readonly position: Vector3Scripting;
}

export const TriggerZoneEnteredEvent = defineEvent<
  "game.scripting.trigger-entered",
  TriggerZoneEnteredPayload
>("game.scripting.trigger-entered");

export interface TriggerZoneExitedPayload {
  readonly zoneId: string;
  readonly entityId: string;
}

export const TriggerZoneExitedEvent = defineEvent<
  "game.scripting.trigger-exited",
  TriggerZoneExitedPayload
>("game.scripting.trigger-exited");

// ── COMANDOS DE SCRIPTING ───────────────────────────────────────────────────

export interface PlayCutscenePayload {
  readonly cutsceneId: string;
}

export const PlayCutsceneCommand = defineCommand<
  "game.scripting.play-cutscene",
  PlayCutscenePayload
>("game.scripting.play-cutscene");

export interface AdvanceDialoguePayload {
  readonly choiceIndex?: number;
}

export const AdvanceDialogueCommand = defineCommand<
  "game.scripting.advance-dialogue",
  AdvanceDialoguePayload
>("game.scripting.advance-dialogue");

export interface StartQuestPayload {
  readonly questId: string;
}

export const StartQuestCommand = defineCommand<
  "game.scripting.start-quest",
  StartQuestPayload
>("game.scripting.start-quest");