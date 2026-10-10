import { defineCapability } from "@core";
import type {
  CutsceneDescriptor,
  DialogueChoice,
  DialogueTreeDescriptor,
  DialogueNode,
  QuestDescriptor,
  QuestState,
  RegisterQuestOptions,
  StartDialogueOptions,
  StartQuestOptions,
  TrackEntityOptions,
  TriggerCheckOptions,
  TriggerZoneConfig,
  Vector3Scripting,
} from "../contracts/scripting/types";

export interface ScriptingApi {
  /* ── Cutscenes ── */
  registerCutscene(descriptor: CutsceneDescriptor): void;
  /**
   * Toca do começo. Keyframes executam via capabilities opcionais da trilha
   * (camera/audio/anim/vfx/diálogo) e emitem `cutscene-keyframe`. Uma
   * cutscene ativa termina antes com `cutscene-finished` reason "replaced".
   */
  playCutscene(cutsceneId: string): boolean;
  /** Pausa (emite `cutscene-paused`); `resumeCutscene` continua de onde parou. */
  pauseCutscene(): boolean;
  resumeCutscene(): boolean;
  /** `cutscene-finished` com reason "stopped". */
  stopCutscene(): void;
  /** `cutscene-finished` com reason "skipped"; opcionalmente executa os keyframes restantes. */
  skipCutscene(options?: { readonly runRemainingKeyframes?: boolean }): boolean;
  isCutscenePlaying(): boolean;
  isCutscenePaused(): boolean;
  getActiveCutsceneId(): string | null;
  getCutsceneElapsedSeconds(): number;

  /* ── Diálogos ── */
  /** Registra se a árvore for válida (retorna false e não registra se não for). */
  registerDialogueTree(descriptor: DialogueTreeDescriptor): boolean;
  /** Erros de validação da árvore (vazio = válida). */
  validateDialogueTree(descriptor: DialogueTreeDescriptor): string[];
  /**
   * Inicia um diálogo. Id inválido: null e o ativo continua. Com outro ativo:
   * `ifActive` "replace" (padrão, emite `dialogue-ended` "replaced"),
   * "queue" ou "reject".
   */
  startDialogue(treeId: string, startNodeId?: string, options?: StartDialogueOptions): DialogueNode | null;
  /** Enfileira (ou inicia já se não houver diálogo ativo). */
  queueDialogue(treeId: string, startNodeId?: string): boolean;
  /**
   * Avança. Escolha inexistente/bloqueada: fica no nó atual (retorna o
   * próprio nó). Retorna o nó atual após a chamada (null = sem diálogo).
   */
  advanceDialogue(choiceIndex?: number): DialogueNode | null;
  /** Encerra o diálogo (`dialogue-ended` reason "stopped"); o próximo da fila começa. */
  stopDialogue(): boolean;
  isDialogueActive(): boolean;
  getCurrentDialogueNode(): DialogueNode | null;
  /** Escolhas do nó atual liberadas pelas variáveis. */
  getAvailableChoices(): DialogueChoice[];
  /** Variáveis públicas usadas pelas condições das escolhas. `undefined` apaga. */
  setVariable(key: string, value: unknown): void;
  getVariable(key: string): unknown;

  /* ── Quests ── */
  /** Registra/atualiza; o estado existente é preservado (salvo `resetState`). */
  registerQuest(descriptor: QuestDescriptor, options?: RegisterQuestOptions): boolean;
  /** Idempotente: quest já iniciada retorna false (use `restart: true`/`restartQuest`). */
  startQuest(questId: string, options?: StartQuestOptions): boolean;
  restartQuest(questId: string): boolean;
  /** A sobra de progresso passa para as próximas etapas. */
  advanceQuestProgress(questId: string, amount?: number): QuestState | null;
  /** Conclui (emite `quest-completed` com as recompensas declaradas). */
  completeQuest(questId: string): QuestState | null;
  /** Falha (emite `quest-failed`). */
  failQuest(questId: string, reason?: string): QuestState | null;
  /** Avança quests cuja etapa atual tem `targetEntityId === entityId`. */
  reportQuestTarget(entityId: string, amount?: number): QuestState[];
  getQuestState(questId: string): QuestState | null;

  /* ── Zonas de gatilho ── */
  /** Re-registro emite `exited` de quem estava dentro. */
  registerTriggerZone(config: TriggerZoneConfig): boolean;
  /** Quem estava dentro recebe `exited` (reason "zone-removed"). */
  unregisterTriggerZone(zoneId: string): boolean;
  /** Verificação manual (continua disponível ao lado do rastreamento automático). */
  checkEntityInZones(entityId: string, position: Vector3Scripting, options?: TriggerCheckOptions): void;
  /**
   * Verifica a entidade sozinha a cada tick (posição/tags do `game.world`).
   * Entidades do mundo com tags que casam `targetTags` de alguma zona são
   * rastreadas automaticamente.
   */
  trackEntity(entityId: string, options?: TrackEntityOptions): void;
  untrackEntity(entityId: string): boolean;
  /** `exited` ("entity-removed") de todas as zonas; automático no despawn do world. */
  removeEntityFromZones(entityId: string): void;
  getEntitiesInZone(zoneId: string): string[];
  /** Remove todas as zonas emitindo `exited`. */
  clearTriggerZones(): void;

  update(deltaSeconds: number): void;
  /** Limpa tudo emitindo os encerramentos (cutscene/diálogo/zonas). */
  clear(): void;
}

export const ScriptingToken = defineCapability<ScriptingApi>("game.scripting", "1.0.0");
