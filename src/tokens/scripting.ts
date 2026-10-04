import { defineCapability } from "@core";
import type {
  CutsceneDescriptor,
  DialogueTreeDescriptor,
  DialogueNode,
  QuestDescriptor,
  QuestState,
  TriggerZoneConfig,
  Vector3Scripting,
} from "../contracts/scripting/types";

export interface ScriptingApi {
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

export const ScriptingToken = defineCapability<ScriptingApi>("game.scripting", "1.0.0");