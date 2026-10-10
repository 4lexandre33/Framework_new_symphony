# scripting — Cutscenes, Diálogos & Quests
capability: game.scripting@1.0.0 | category: functional | engine plugin id: game.scripting
dependsOn: game.loop
consumes: WorldToken
use (from src/projects/<jogo>/**):
  import { ScriptingToken } from "../../tokens/scripting";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/scripting.ts
```ts
interface ScriptingApi {
  registerCutscene(descriptor: CutsceneDescriptor): void;
  playCutscene(cutsceneId: string): boolean;
  pauseCutscene(): void;
  stopCutscene(): void;
  isCutscenePlaying(): boolean;
  registerDialogueTree(descriptor: DialogueTreeDescriptor): void;
  startDialogue(treeId: string, startNodeId?: string): DialogueNode | null;
  advanceDialogue(choiceIndex?: number): DialogueNode | null;
  getCurrentDialogueNode(): DialogueNode | null;
  registerQuest(descriptor: QuestDescriptor): void;
  startQuest(questId: string): boolean;
  advanceQuestProgress(questId: string, amount?: number): QuestState | null;
  getQuestState(questId: string): QuestState | null;
  registerTriggerZone(config: TriggerZoneConfig): void;
  unregisterTriggerZone(zoneId: string): boolean;
  checkEntityInZones(entityId: string, position: Vector3Scripting): void;
  update(deltaSeconds: number): void;
  clear(): void;
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
interface TimelineKeyframe {
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
  readonly conditionVariable?: string;
  readonly requiredValue?: unknown;
}
interface DialogueNode {
  readonly nodeId: string;
  readonly speakerName: string;
  readonly text: string;
  readonly audioClipUrl?: string;
  readonly animationState?: string;
  readonly choices?: ReadonlyArray<DialogueChoice>;
  readonly defaultNextNodeId?: string;
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
}
export type TriggerZoneShape = "box" | "sphere" | "cylinder";
interface TriggerZoneConfig {
  readonly zoneId: string;
  readonly shape: TriggerZoneShape;
  readonly position: Vector3Scripting;
  readonly dimensions: Vector3Scripting;
  readonly triggerOnce: boolean;
  readonly targetTags?: ReadonlyArray<string>;
}
interface CutsceneStartedPayload {
  readonly cutsceneId: string;
  readonly durationSeconds: number;
}
event CutsceneStartedEvent = "game.scripting.cutscene-started" payload CutsceneStartedPayload
interface CutsceneFinishedPayload {
  readonly cutsceneId: string;
}
event CutsceneFinishedEvent = "game.scripting.cutscene-finished" payload CutsceneFinishedPayload
interface DialogueNodeChangedPayload {
  readonly treeId: string;
  readonly currentNode: DialogueNode;
}
event DialogueNodeChangedEvent = "game.scripting.dialogue-changed" payload DialogueNodeChangedPayload
interface QuestStepUpdatedPayload {
  readonly questId: string;
  readonly questState: QuestState;
}
event QuestStepUpdatedEvent = "game.scripting.quest-updated" payload QuestStepUpdatedPayload
interface TriggerZoneEnteredPayload {
  readonly zoneId: string;
  readonly entityId: string;
  readonly position: Vector3Scripting;
}
event TriggerZoneEnteredEvent = "game.scripting.trigger-entered" payload TriggerZoneEnteredPayload
interface TriggerZoneExitedPayload {
  readonly zoneId: string;
  readonly entityId: string;
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
}
command StartQuestCommand = "game.scripting.start-quest" request StartQuestPayload
```
## notas verificadas (comportamento)
- A engine chama `update(dt)` no tick (avança a timeline de cutscene). Não chame `update` no jogo.
- Zonas de gatilho NÃO são verificadas sozinhas: chame `checkEntityInZones(entityId, pos)` no tick para cada entidade que importa; aí saem `game.scripting.trigger-entered/exited`.
- LACUNA: os keyframes de cutscene não executam nada nem emitem evento por keyframe; só `cutscene-started` e `cutscene-finished`. A câmera/áudio da cutscene é feita pelo jogo reagindo a esses dois eventos.
- Quests e diálogos funcionam em memória: `startQuest`, `advanceQuestProgress`, `startDialogue`/`advanceDialogue` (emitem `quest-updated` e `dialogue-changed`).
