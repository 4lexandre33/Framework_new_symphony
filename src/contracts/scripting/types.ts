import { defineEvent, defineCommand } from "@core";

export interface Vector3Scripting {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type TrackType = "camera" | "audio" | "animation" | "vfx" | "dialogue" | "event";

/**
 * Keyframe de cutscene. Ao atingir `timeSeconds` a engine emite
 * `game.scripting.cutscene-keyframe` e, se a capability da trilha estiver
 * presente, executa a ação conhecida (`handled: true` no evento):
 *
 * - camera: `set-active` (targetId = câmera, payload.blendDurationSeconds),
 *   `shake` (payload.amount), `look-at` (payload.position | null),
 *   `follow` (payload.position), `set-priority` (payload.priority);
 * - audio: `play` (targetId ou payload.url; payload.channel/volume/loop),
 *   `music` (crossfade; payload.durationSeconds), `stop-music`,
 *   `stop-channel` (targetId = canal); loops tocados pela cutscene param no fim;
 * - animation: `play` (targetId = entidade, payload.state, payload.fadeSeconds,
 *   payload.restart), `set-param` (payload.param, payload.value);
 * - vfx: `preset` (targetId = presetId, payload.position, payload.instanceId),
 *   `bloom` (payload.strength, payload.durationSeconds),
 *   `stop-emitter` (targetId);
 * - dialogue: `start` (targetId = treeId, payload.startNodeId),
 *   `advance` (payload.choiceIndex), `stop`;
 * - event: só o evento (o jogo reage).
 */
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
  /**
   * Variável pública (`setVariable`) que libera a escolha. Com
   * `requiredValue` a comparação é estrita (===); sem ele, basta a
   * variável ser truthy.
   */
  readonly conditionVariable?: string;
  readonly requiredValue?: unknown;
}

export interface DialogueNode {
  readonly nodeId: string;
  readonly speakerName: string;
  readonly text: string;
  /** Tocado no canal "voice" via `game.audio` quando presente. */
  readonly audioClipUrl?: string;
  /** Estado tocado em `speakerEntityId` via `game.anim` quando presente. */
  readonly animationState?: string;
  /** Entidade do falante (alvo de `animationState`). */
  readonly speakerEntityId?: string;
  readonly choices?: ReadonlyArray<DialogueChoice>;
  readonly defaultNextNodeId?: string;
}

/** O que fazer se já existe um diálogo ativo ao chamar `startDialogue`. */
export type DialogueStartMode = "replace" | "queue" | "reject";

export interface StartDialogueOptions {
  /** Padrão "replace" (o ativo termina com `dialogue-ended` reason "replaced"). */
  readonly ifActive?: DialogueStartMode;
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
  /** Motivo informado em `failQuest`. */
  readonly failureReason?: string;
}

export interface StartQuestOptions {
  /** true reinicia uma quest ativa/concluída/falhada (zera o progresso). */
  readonly restart?: boolean;
}

export interface RegisterQuestOptions {
  /** true descarta o estado existente da quest (padrão: preserva). */
  readonly resetState?: boolean;
}

// ── ESTRUTURAS DE TRIGGER ZONES ─────────────────────────────────────────────

export type TriggerZoneShape = "box" | "sphere" | "cylinder";

export interface QuaternionScripting {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface TriggerZoneConfig {
  readonly zoneId: string;
  readonly shape: TriggerZoneShape;
  /** Centro da zona (box/sphere) ou centro do cilindro (meia altura acima e abaixo). */
  readonly position: Vector3Scripting;
  /**
   * box: x=largura, y=altura, z=profundidade (tamanho total).
   * sphere/cylinder (compatibilidade): z=raio e y=altura do cilindro quando
   * `radius`/`height` não são informados.
   */
  readonly dimensions: Vector3Scripting;
  /** Raio de sphere/cylinder (preferível a `dimensions.z`). */
  readonly radius?: number;
  /** Altura total do cylinder (preferível a `dimensions.y`). */
  readonly height?: number;
  /** Rotação (quaternion) da box/cylinder. */
  readonly rotation?: QuaternionScripting;
  /**
   * true = dispara `trigger-entered` uma única vez. Escopo em
   * `triggerOnceScope` (padrão "entity": uma vez POR ENTIDADE; "zone": a
   * primeira entidade consome a zona). `exited` continua sendo emitido.
   */
  readonly triggerOnce: boolean;
  readonly triggerOnceScope?: "entity" | "zone";
  /**
   * Só entidades com ao menos uma destas tags disparam a zona. Entidades do
   * `game.world` com tags correspondentes são verificadas automaticamente a
   * cada tick.
   */
  readonly targetTags?: ReadonlyArray<string>;
  /**
   * Verificação contínua (padrão true): uma entidade rápida que atravessa a
   * zona entre dois ticks gera `entered` + `exited`.
   */
  readonly sweep?: boolean;
}

export interface TriggerCheckOptions {
  /** Tags da entidade (para `targetTags`). Sem isto, usa as do trackEntity/world. */
  readonly tags?: ReadonlyArray<string>;
  /** false = teleporte (sem varredura desde a posição anterior). */
  readonly sweep?: boolean;
}

export interface TrackEntityOptions {
  /** Tags fixas; sem isto as tags vêm do `game.world`. */
  readonly tags?: ReadonlyArray<string>;
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

export type CutsceneEndReason = "completed" | "stopped" | "skipped" | "replaced";

export interface CutsceneFinishedPayload {
  readonly cutsceneId: string;
  /** "completed" = chegou ao fim; "stopped"/"skipped"/"replaced" = interrompida. */
  readonly reason?: CutsceneEndReason;
  readonly elapsedSeconds?: number;
}

export const CutsceneFinishedEvent = defineEvent<
  "game.scripting.cutscene-finished",
  CutsceneFinishedPayload
>("game.scripting.cutscene-finished");

export interface CutsceneKeyframePayload {
  readonly cutsceneId: string;
  readonly trackId: string;
  readonly trackType: TrackType;
  readonly timeSeconds: number;
  readonly actionType: string;
  readonly targetId: string;
  readonly payload: Record<string, unknown>;
  /** true se a engine executou a ação via capability da trilha. */
  readonly handled: boolean;
}

export const CutsceneKeyframeEvent = defineEvent<
  "game.scripting.cutscene-keyframe",
  CutsceneKeyframePayload
>("game.scripting.cutscene-keyframe");

export interface CutscenePausedPayload {
  readonly cutsceneId: string;
  readonly elapsedSeconds: number;
  readonly paused: boolean;
}

/** Emitido em pauseCutscene (paused true) e resumeCutscene (paused false). */
export const CutscenePausedEvent = defineEvent<
  "game.scripting.cutscene-paused",
  CutscenePausedPayload
>("game.scripting.cutscene-paused");

export interface DialogueNodeChangedPayload {
  readonly treeId: string;
  readonly currentNode: DialogueNode;
}

export const DialogueNodeChangedEvent = defineEvent<
  "game.scripting.dialogue-changed",
  DialogueNodeChangedPayload
>("game.scripting.dialogue-changed");

export type DialogueEndReason = "completed" | "stopped" | "replaced" | "error";

export interface DialogueEndedPayload {
  readonly treeId: string;
  readonly lastNodeId: string | null;
  readonly reason: DialogueEndReason;
}

export const DialogueEndedEvent = defineEvent<
  "game.scripting.dialogue-ended",
  DialogueEndedPayload
>("game.scripting.dialogue-ended");

export interface QuestStepUpdatedPayload {
  readonly questId: string;
  readonly questState: QuestState;
}

export const QuestStepUpdatedEvent = defineEvent<
  "game.scripting.quest-updated",
  QuestStepUpdatedPayload
>("game.scripting.quest-updated");

export interface QuestCompletedPayload {
  readonly questId: string;
  readonly questState: QuestState;
  /**
   * Recompensas declaradas na quest, entregues ao jogo (a engine não aplica
   * regras de progressão/economia).
   */
  readonly rewardXp?: number;
  readonly rewardItems?: ReadonlyArray<string>;
}

export const QuestCompletedEvent = defineEvent<
  "game.scripting.quest-completed",
  QuestCompletedPayload
>("game.scripting.quest-completed");

export interface QuestFailedPayload {
  readonly questId: string;
  readonly questState: QuestState;
  readonly reason?: string;
}

export const QuestFailedEvent = defineEvent<
  "game.scripting.quest-failed",
  QuestFailedPayload
>("game.scripting.quest-failed");

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
  /**
   * "left" = saiu; "zone-removed" = zona removida/re-registrada/limpa;
   * "entity-removed" = entidade destruída/removida.
   */
  readonly reason?: "left" | "zone-removed" | "entity-removed";
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
  readonly restart?: boolean;
}

export const StartQuestCommand = defineCommand<
  "game.scripting.start-quest",
  StartQuestPayload
>("game.scripting.start-quest");