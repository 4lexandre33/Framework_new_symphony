# scripting — Cutscenes, Diálogos & Quests
capability: game.scripting@1.0.0 | category: functional | engine plugin id: game.scripting
dependsOn: game.loop
consumes: WorldToken, CameraToken, AudioToken, AnimationToken, VfxToken
use (from src/projects/<jogo>/**):
  import { ScriptingToken } from "../../tokens/scripting";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/scripting.ts
```ts
interface ScriptingApi {
  registerCutscene(descriptor: CutsceneDescriptor): void;
  playCutscene(cutsceneId: string): boolean; // Toca do começo.
  pauseCutscene(): boolean; // Pausa (emite `cutscene-paused`); `resumeCutscene` continua de onde parou.
  resumeCutscene(): boolean;
  stopCutscene(): void; // `cutscene-finished` com reason "stopped".
  skipCutscene(options?: { readonly runRemainingKeyframes?: boolean }): boolean; // `cutscene-finished` com reason "skipped"; opcionalmente executa os keyframes restantes.
  isCutscenePlaying(): boolean;
  isCutscenePaused(): boolean;
  getActiveCutsceneId(): string | null;
  getCutsceneElapsedSeconds(): number;
  registerDialogueTree(descriptor: DialogueTreeDescriptor): boolean; // Registra se a árvore for válida (retorna false e não registra se não for).
  validateDialogueTree(descriptor: DialogueTreeDescriptor): string[]; // Erros de validação da árvore (vazio = válida).
  startDialogue(treeId: string, startNodeId?: string, options?: StartDialogueOptions): DialogueNode | null; // Inicia um diálogo.
  queueDialogue(treeId: string, startNodeId?: string): boolean; // Enfileira (ou inicia já se não houver diálogo ativo).
  advanceDialogue(choiceIndex?: number): DialogueNode | null; // Avança.
  stopDialogue(): boolean; // Encerra o diálogo (`dialogue-ended` reason "stopped"); o próximo da fila começa.
  isDialogueActive(): boolean;
  getCurrentDialogueNode(): DialogueNode | null;
  getAvailableChoices(): DialogueChoice[]; // Escolhas do nó atual liberadas pelas variáveis.
  setVariable(key: string, value: unknown): void; // Variáveis públicas usadas pelas condições das escolhas.
  getVariable(key: string): unknown;
  registerQuest(descriptor: QuestDescriptor, options?: RegisterQuestOptions): boolean; // Registra/atualiza; o estado existente é preservado (salvo `resetState`).
  startQuest(questId: string, options?: StartQuestOptions): boolean; // Idempotente: quest já iniciada retorna false (use `restart: true`/`restartQuest`).
  restartQuest(questId: string): boolean;
  advanceQuestProgress(questId: string, amount?: number): QuestState | null; // A sobra de progresso passa para as próximas etapas.
  completeQuest(questId: string): QuestState | null; // Conclui (emite `quest-completed` com as recompensas declaradas).
  failQuest(questId: string, reason?: string): QuestState | null; // Falha (emite `quest-failed`).
  reportQuestTarget(entityId: string, amount?: number): QuestState[]; // Avança quests cuja etapa atual tem `targetEntityId === entityId`.
  getQuestState(questId: string): QuestState | null;
  registerTriggerZone(config: TriggerZoneConfig): boolean; // Re-registro emite `exited` de quem estava dentro.
  unregisterTriggerZone(zoneId: string): boolean; // Quem estava dentro recebe `exited` (reason "zone-removed").
  checkEntityInZones(entityId: string, position: Vector3Scripting, options?: TriggerCheckOptions): void; // Verificação manual (continua disponível ao lado do rastreamento automático).
  trackEntity(entityId: string, options?: TrackEntityOptions): void; // Verifica a entidade sozinha a cada tick (posição/tags do `game.world`).
  untrackEntity(entityId: string): boolean;
  removeEntityFromZones(entityId: string): void; // `exited` ("entity-removed") de todas as zonas; automático no despawn do world.
  getEntitiesInZone(zoneId: string): string[];
  clearTriggerZones(): void; // Remove todas as zonas emitindo `exited`.
  update(deltaSeconds: number): void;
  clear(): void; // Limpa tudo emitindo os encerramentos (cutscene/diálogo/zonas).
}
capability ScriptingToken = "game.scripting"@1.0.0 api ScriptingApi
```
## contract src/contracts/scripting/types.ts
```ts
interface Vector3Scripting {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
export type TrackType = "camera" | "audio" | "animation" | "vfx" | "dialogue" | "event";
interface TimelineKeyframe { // Keyframe de cutscene.
  readonly timeSeconds: number;
  readonly actionType: string;
  readonly targetId: string;
  readonly payload: Record<string, unknown>;
}
interface TimelineTrackDescriptor {
  readonly trackId: string;
  readonly trackType: TrackType;
  readonly keyframes: ReadonlyArray<TimelineKeyframe>;
}
interface CutsceneDescriptor {
  readonly cutsceneId: string;
  readonly durationSeconds: number;
  readonly tracks: ReadonlyArray<TimelineTrackDescriptor>;
}
interface DialogueChoice {
  readonly choiceIndex: number;
  readonly text: string;
  readonly nextNodeId: string;
  readonly conditionVariable?: string; // Variável pública (`setVariable`) que libera a escolha.
  readonly requiredValue?: unknown;
}
interface DialogueNode {
  readonly nodeId: string;
  readonly speakerName: string;
  readonly text: string;
  readonly audioClipUrl?: string; // Tocado no canal "voice" via `game.audio` quando presente.
  readonly animationState?: string; // Estado tocado em `speakerEntityId` via `game.anim` quando presente.
  readonly speakerEntityId?: string; // Entidade do falante (alvo de `animationState`).
  readonly choices?: ReadonlyArray<DialogueChoice>;
  readonly defaultNextNodeId?: string;
}
export type DialogueStartMode = "replace" | "queue" | "reject"; // O que fazer se já existe um diálogo ativo ao chamar `startDialogue`.
interface StartDialogueOptions {
  readonly ifActive?: DialogueStartMode; // Padrão "replace" (o ativo termina com `dialogue-ended` reason "replaced").
}
interface DialogueTreeDescriptor {
  readonly treeId: string;
  readonly startNodeId: string;
  readonly nodes: ReadonlyArray<DialogueNode>;
}
export type QuestStatus = "not_started" | "active" | "completed" | "failed";
interface QuestStep {
  readonly stepId: string;
  readonly description: string;
  readonly targetCount: number;
  readonly currentCount: number;
  readonly isCompleted: boolean;
  readonly targetEntityId?: string;
}
interface QuestDescriptor {
  readonly questId: string;
  readonly title: string;
  readonly description: string;
  readonly steps: ReadonlyArray<QuestStep>;
  readonly rewardXp?: number;
  readonly rewardItems?: ReadonlyArray<string>;
}
interface QuestState {
  readonly questId: string;
  readonly status: QuestStatus;
  readonly currentStepIndex: number;
  readonly steps: ReadonlyArray<QuestStep>;
  readonly updatedAtTimestamp: number;
  readonly failureReason?: string; // Motivo informado em `failQuest`.
}
interface StartQuestOptions {
  readonly restart?: boolean; // true reinicia uma quest ativa/concluída/falhada (zera o progresso).
}
interface RegisterQuestOptions {
  readonly resetState?: boolean; // true descarta o estado existente da quest (padrão: preserva).
}
export type TriggerZoneShape = "box" | "sphere" | "cylinder";
interface QuaternionScripting {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}
interface TriggerZoneConfig {
  readonly zoneId: string;
  readonly shape: TriggerZoneShape;
  readonly position: Vector3Scripting; // Centro da zona (box/sphere) ou centro do cilindro (meia altura acima e abaixo).
  readonly dimensions: Vector3Scripting; // box: x=largura, y=altura, z=profundidade (tamanho total).
  readonly radius?: number; // Raio de sphere/cylinder (preferível a `dimensions.z`).
  readonly height?: number; // Altura total do cylinder (preferível a `dimensions.y`).
  readonly rotation?: QuaternionScripting; // Rotação (quaternion) da box/cylinder.
  readonly triggerOnce: boolean; // true = dispara `trigger-entered` uma única vez.
  readonly triggerOnceScope?: "entity" | "zone";
  readonly targetTags?: ReadonlyArray<string>; // Só entidades com ao menos uma destas tags disparam a zona.
  readonly sweep?: boolean; // Verificação contínua (padrão true): uma entidade rápida que atravessa a zona entre dois ticks gera `entered` …
}
interface TriggerCheckOptions {
  readonly tags?: ReadonlyArray<string>; // Tags da entidade (para `targetTags`).
  readonly sweep?: boolean; // false = teleporte (sem varredura desde a posição anterior).
}
interface TrackEntityOptions {
  readonly tags?: ReadonlyArray<string>; // Tags fixas; sem isto as tags vêm do `game.world`.
}
interface CutsceneStartedPayload {
  readonly cutsceneId: string;
  readonly durationSeconds: number;
}
event CutsceneStartedEvent = "game.scripting.cutscene-started" payload CutsceneStartedPayload
export type CutsceneEndReason = "completed" | "stopped" | "skipped" | "replaced";
interface CutsceneFinishedPayload {
  readonly cutsceneId: string;
  readonly reason?: CutsceneEndReason; // "completed" = chegou ao fim; "stopped"/"skipped"/"replaced" = interrompida.
  readonly elapsedSeconds?: number;
}
event CutsceneFinishedEvent = "game.scripting.cutscene-finished" payload CutsceneFinishedPayload
interface CutsceneKeyframePayload {
  readonly cutsceneId: string;
  readonly trackId: string;
  readonly trackType: TrackType;
  readonly timeSeconds: number;
  readonly actionType: string;
  readonly targetId: string;
  readonly payload: Record<string, unknown>;
  readonly handled: boolean; // true se a engine executou a ação via capability da trilha.
}
event CutsceneKeyframeEvent = "game.scripting.cutscene-keyframe" payload CutsceneKeyframePayload
interface CutscenePausedPayload {
  readonly cutsceneId: string;
  readonly elapsedSeconds: number;
  readonly paused: boolean;
}
event CutscenePausedEvent = "game.scripting.cutscene-paused" payload CutscenePausedPayload // Emitido em pauseCutscene (paused true) e resumeCutscene (paused false).
interface DialogueNodeChangedPayload {
  readonly treeId: string;
  readonly currentNode: DialogueNode;
}
event DialogueNodeChangedEvent = "game.scripting.dialogue-changed" payload DialogueNodeChangedPayload
export type DialogueEndReason = "completed" | "stopped" | "replaced" | "error";
interface DialogueEndedPayload {
  readonly treeId: string;
  readonly lastNodeId: string | null;
  readonly reason: DialogueEndReason;
}
event DialogueEndedEvent = "game.scripting.dialogue-ended" payload DialogueEndedPayload
interface QuestStepUpdatedPayload {
  readonly questId: string;
  readonly questState: QuestState;
}
event QuestStepUpdatedEvent = "game.scripting.quest-updated" payload QuestStepUpdatedPayload
interface QuestCompletedPayload {
  readonly questId: string;
  readonly questState: QuestState;
  readonly rewardXp?: number; // Recompensas declaradas na quest, entregues ao jogo (a engine não aplica regras de progressão/economia).
  readonly rewardItems?: ReadonlyArray<string>;
}
event QuestCompletedEvent = "game.scripting.quest-completed" payload QuestCompletedPayload
interface QuestFailedPayload {
  readonly questId: string;
  readonly questState: QuestState;
  readonly reason?: string;
}
event QuestFailedEvent = "game.scripting.quest-failed" payload QuestFailedPayload
interface TriggerZoneEnteredPayload {
  readonly zoneId: string;
  readonly entityId: string;
  readonly position: Vector3Scripting;
}
event TriggerZoneEnteredEvent = "game.scripting.trigger-entered" payload TriggerZoneEnteredPayload
interface TriggerZoneExitedPayload {
  readonly zoneId: string;
  readonly entityId: string;
  readonly reason?: "left" | "zone-removed" | "entity-removed"; // "left" = saiu; "zone-removed" = zona removida/re-registrada/limpa; "entity-removed" = entidade destruída/remo…
}
event TriggerZoneExitedEvent = "game.scripting.trigger-exited" payload TriggerZoneExitedPayload
interface PlayCutscenePayload {
  readonly cutsceneId: string;
}
command PlayCutsceneCommand = "game.scripting.play-cutscene" request PlayCutscenePayload
interface AdvanceDialoguePayload {
  readonly choiceIndex?: number;
}
command AdvanceDialogueCommand = "game.scripting.advance-dialogue" request AdvanceDialoguePayload
interface StartQuestPayload {
  readonly questId: string;
  readonly restart?: boolean;
}
command StartQuestCommand = "game.scripting.start-quest" request StartQuestPayload
```
## notas verificadas (comportamento)
- A engine chama `update(dt)` no tick (cutscenes e zonas rastreadas). Não chame `update`.
- Cutscene: `registerCutscene` + `playCutscene` (do começo). Keyframes EXECUTAM ações das trilhas quando a capability existe (camera `set-active`/`shake`/`look-at`/`follow`; audio `play`/`music`/`stop-music`; animation `play`/`set-param`; vfx `preset`/`bloom`; dialogue `start`/`advance`) e sempre emitem `game.scripting.cutscene-keyframe` (`handled`). Trilha `event` = só evento para o jogo. `pause/resume/stop/skipCutscene`; `cutscene-finished` traz `reason` (completed/stopped/skipped/replaced).
- Zonas: `registerTriggerZone({ zoneId, shape, position, dimensions, radius?, height?, rotation?, triggerOnce, triggerOnceScope?, targetTags?, sweep? })`. Verificação automática para entidades do world com tags que casam `targetTags` ou rastreadas com `trackEntity`; manual com `checkEntityInZones(id, pos)` (posição no tick). Exits saem ao sair, ao remover a zona e ao remover a entidade (`removeEntityFromZones`; automático no despawn do world). Varredura amostrada (GAPS G129).
- Diálogos: `registerDialogueTree` valida (false se inválida; `validateDialogueTree` lista erros). `startDialogue(tree, node?, { ifActive: "replace" | "queue" | "reject" })`, `queueDialogue`, `advanceDialogue(i)` só aceita escolhas liberadas (`getAvailableChoices`; condições por `setVariable`). `dialogue-ended` com `reason`. `audioClipUrl`/`animationState` do nó tocam via audio/anim.
- Quests: `registerQuest` preserva estado (salvo `resetState`); `startQuest` é idempotente (`restart`/`restartQuest` reinicia); `advanceQuestProgress` passa a sobra adiante; `completeQuest`/`failQuest`; `reportQuestTarget(entityId)`. Eventos `quest-updated`, `quest-completed` (recompensas declaradas; aplicar é do jogo), `quest-failed`.
- `clear()` encerra tudo emitindo os eventos de fim.
