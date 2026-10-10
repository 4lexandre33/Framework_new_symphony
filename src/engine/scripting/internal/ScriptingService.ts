import type {
  CapabilityToken,
  PluginContext,
} from "@core";

import type {
  ScriptingApi,
} from "../../../tokens/scripting";

import { WorldToken, type WorldApi } from "../../../tokens/world";
import { CameraToken, type CameraApi } from "../../../tokens/camera";
import { AudioToken, type AudioApi } from "../../../tokens/audio";
import { AnimationToken, type AnimationApi } from "../../../tokens/anim";
import { VfxToken, type VfxApi } from "../../../tokens/vfx";

import type { AudioChannelType } from "../../../contracts/audio/types";

import {
  CutsceneFinishedEvent,
  CutsceneKeyframeEvent,
  CutscenePausedEvent,
  CutsceneStartedEvent,
  DialogueEndedEvent,
  DialogueNodeChangedEvent,
  QuestCompletedEvent,
  QuestFailedEvent,
  QuestStepUpdatedEvent,
  TriggerZoneEnteredEvent,
  TriggerZoneExitedEvent,
  type CutsceneDescriptor,
  type CutsceneEndReason,
  type DialogueChoice,
  type DialogueNode,
  type DialogueTreeDescriptor,
  type QuestDescriptor,
  type QuestState,
  type RegisterQuestOptions,
  type StartDialogueOptions,
  type StartQuestOptions,
  type TrackEntityOptions,
  type TrackType,
  type TriggerCheckOptions,
  type TriggerZoneConfig,
  type Vector3Scripting,
} from "../../../contracts/scripting/types";

import {
  CutsceneTimeline,
  type TimelineEventCallback,
} from "./CutsceneTimeline";

import {
  DialogueTreeParser,
  validateDialogueTree,
} from "./DialogueTreeParser";

import {
  QuestManager,
} from "./QuestManager";

import {
  TriggerZoneManager,
  type TriggerZoneCallback,
} from "./TriggerZoneManager";

/** Capabilities opcionais usadas pelo scripting (todas podem faltar). */
export interface ScriptingDependencies {
  readonly world?: WorldApi;
  readonly camera?: CameraApi;
  readonly audio?: AudioApi;
  readonly anim?: AnimationApi;
  readonly vfx?: VfxApi;
}

interface TrackedEntity {
  /** Tags fixas (trackEntity) ou null = ler do game.world a cada tick. */
  tags: ReadonlyArray<string> | null;
  /** Rastreada automaticamente por casar `targetTags` de uma zona. */
  readonly automatic: boolean;
}

const AUDIO_CHANNELS: ReadonlyArray<AudioChannelType> = ["master", "bgm", "sfx", "voice", "ui"];

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

  private readonly boundDeps: {
    world?: WorldApi;
    camera?: CameraApi;
    audio?: AudioApi;
    anim?: AnimationApi;
    vfx?: VfxApi;
  } = {};

  private readonly trackedEntities =
    new Map<string, TrackedEntity>();

  /** Loops de áudio iniciados pela cutscene (param quando ela termina). */
  private readonly cutsceneSoundHandles: number[] = [];

  private voiceHandle = 0;

  /** World resolvido para o passo de rastreamento do tick atual. */
  private tickWorld: WorldApi | undefined = undefined;

  private readonly onTimelineKeyframe:
    TimelineEventCallback =
      (
        actionType,
        targetId,
        payload,
        trackId,
        trackType,
        timeSeconds,
      ): void => {
        const handled =
          this.dispatchKeyframe(
            trackType,
            actionType,
            targetId,
            payload,
          );

        this.safeEmit(
          CutsceneKeyframeEvent.type,
          {
            cutsceneId:
              this.timeline.currentCutsceneId ??
              "",
            trackId,
            trackType,
            timeSeconds,
            actionType,
            targetId,
            payload,
            handled,
          },
        );
      };

  private readonly onTriggerZoneEvent:
    TriggerZoneCallback =
      (
        type,
        zoneId,
        entityId,
        position,
        exitReason,
      ): void => {
        if (
          type ===
          "enter"
        ) {
          // Cópia: a posição recebida pode ser um vetor reutilizado (G122).
          this.safeEmit(
            TriggerZoneEnteredEvent.type,
            {
              zoneId,
              entityId,
              position: {
                x: position.x,
                y: position.y,
                z: position.z,
              },
            },
          );

          return;
        }

        this.safeEmit(
          TriggerZoneExitedEvent.type,
          {
            zoneId,
            entityId,
            reason:
              exitReason ??
              "left",
          },
        );
      };

  private readonly checkTrackedEntityBound = (
    tracked: TrackedEntity,
    entityId: string,
  ): void => {
    this.checkTrackedEntity(
      entityId,
      tracked,
    );
  };

  public constructor(
    private readonly ctx:
      PluginContext,
  ) {}

  /**
   * Injeta capabilities opcionais (o plugin resolve via `ctx.caps.get`;
   * testes podem injetar mocks). Sem injeção, o serviço tenta `ctx.caps.get`.
   */
  public bindDependencies(
    deps: ScriptingDependencies,
  ): void {
    this.boundDeps.world = deps.world;
    this.boundDeps.camera = deps.camera;
    this.boundDeps.audio = deps.audio;
    this.boundDeps.anim = deps.anim;
    this.boundDeps.vfx = deps.vfx;
  }

  /* ───────────────────────────── CUTSCENES ───────────────────────────── */

  public registerCutscene(
    descriptor: CutsceneDescriptor,
  ): void {
    if (
      !descriptor ||
      typeof descriptor.cutsceneId !==
        "string"
    ) {
      return;
    }

    this.timeline.registerCutscene(
      descriptor,
    );
  }

  /**
   * Toca do começo. Uma cutscene ativa (tocando ou pausada) termina antes
   * com `cutscene-finished` reason "replaced" (G128).
   */
  public playCutscene(
    cutsceneId: string,
  ): boolean {
    if (
      !this.timeline.hasCutscene(
        cutsceneId,
      )
    ) {
      return false;
    }

    this.endActiveCutscene(
      "replaced",
    );

    const started =
      this.timeline.play(
        cutsceneId,
      );

    if (!started) {
      return false;
    }

    this.safeEmit(
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

  public pauseCutscene(): boolean {
    const cutsceneId =
      this.timeline.currentCutsceneId;

    if (
      !cutsceneId ||
      !this.timeline.pause()
    ) {
      return false;
    }

    this.safeEmit(
      CutscenePausedEvent.type,
      {
        cutsceneId,
        elapsedSeconds:
          this.timeline.elapsedSeconds,
        paused: true,
      },
    );

    return true;
  }

  /** Retoma a cutscene pausada de onde parou (G128). */
  public resumeCutscene(): boolean {
    const cutsceneId =
      this.timeline.currentCutsceneId;

    if (
      !cutsceneId ||
      !this.timeline.resume()
    ) {
      return false;
    }

    this.safeEmit(
      CutscenePausedEvent.type,
      {
        cutsceneId,
        elapsedSeconds:
          this.timeline.elapsedSeconds,
        paused: false,
      },
    );

    return true;
  }

  /** Para a cutscene: `cutscene-finished` com reason "stopped". */
  public stopCutscene(): void {
    this.endActiveCutscene(
      "stopped",
    );
  }

  /**
   * Pula a cutscene: `cutscene-finished` reason "skipped". Com
   * `runRemainingKeyframes` executa (na hora) os keyframes que faltavam.
   */
  public skipCutscene(
    options?: { readonly runRemainingKeyframes?: boolean },
  ): boolean {
    const cutsceneId =
      this.timeline.currentCutsceneId;

    if (!cutsceneId) {
      return false;
    }

    this.timeline.skipToEnd(
      options?.runRemainingKeyframes === true
        ? this.onTimelineKeyframe
        : undefined,
    );

    this.emitCutsceneFinished(
      cutsceneId,
      "skipped",
      this.timeline.lastElapsedSeconds,
    );

    return true;
  }

  public isCutscenePlaying():
    boolean {
    return this.timeline.playing;
  }

  public isCutscenePaused():
    boolean {
    return this.timeline.paused;
  }

  public getActiveCutsceneId():
    string | null {
    return this.timeline.currentCutsceneId;
  }

  public getCutsceneElapsedSeconds():
    number {
    return this.timeline.currentCutsceneId
      ? this.timeline.elapsedSeconds
      : 0;
  }

  /* ───────────────────────────── DIÁLOGOS ────────────────────────────── */

  /**
   * Registra a árvore se for válida (G124). Inválida: retorna false, nada
   * é registrado; os erros vêm de `validateDialogueTree`.
   */
  public registerDialogueTree(
    descriptor: DialogueTreeDescriptor,
  ): boolean {
    const ok =
      this.dialogueParser
        .registerTree(
          descriptor,
        );

    if (!ok) {
      console.warn(
        `[Scripting] árvore de diálogo inválida "${String(descriptor?.treeId)}":`,
        this.dialogueParser.getLastValidationErrors(),
      );
    }

    return ok;
  }

  public validateDialogueTree(
    descriptor: DialogueTreeDescriptor,
  ): string[] {
    return validateDialogueTree(
      descriptor,
    );
  }

  /**
   * Inicia um diálogo. Id/nó inválido: null e o diálogo ativo continua.
   * Com outro ativo: `ifActive` "replace" (padrão; o anterior emite
   * `dialogue-ended` reason "replaced"), "queue" (enfileira, retorna null)
   * ou "reject" (retorna null).
   */
  public startDialogue(
    treeId: string,
    startNodeId?: string,
    options?: StartDialogueOptions,
  ): DialogueNode | null {
    const mode =
      options?.ifActive ??
      "replace";

    if (
      this.dialogueParser.isActive() &&
      mode !==
        "replace"
    ) {
      if (
        mode ===
        "queue"
      ) {
        this.dialogueParser.enqueue(
          treeId,
          startNodeId,
        );
      }

      return null;
    }

    const node =
      this.dialogueParser
        .startDialogue(
          treeId,
          startNodeId,
        );

    if (!node) {
      return null;
    }

    this.flushDialogueEnds(
      false,
    );

    this.onDialogueNodeEntered(
      treeId,
      node,
    );

    return node;
  }

  /**
   * Enfileira (ou inicia já, se não houver diálogo ativo). false se a árvore
   * não existe.
   */
  public queueDialogue(
    treeId: string,
    startNodeId?: string,
  ): boolean {
    if (
      !this.dialogueParser.isActive()
    ) {
      return this.startDialogue(
        treeId,
        startNodeId,
      ) !== null;
    }

    return this.dialogueParser.enqueue(
      treeId,
      startNodeId,
    );
  }

  /**
   * Avança. Escolha inexistente/bloqueada: o diálogo FICA no nó atual (o
   * retorno é o próprio nó, sem evento). Retorna o nó atual após a chamada
   * (null = nenhum diálogo ativo; se um diálogo terminou e havia fila, o
   * próximo começa e seu nó inicial é retornado).
   */
  public advanceDialogue(
    choiceIndex?: number,
  ): DialogueNode | null {
    const previous =
      this.dialogueParser.getCurrentNode();

    const treeId =
      this.dialogueParser
        .currentTreeId;

    const node =
      this.dialogueParser
        .advanceDialogue(
          choiceIndex,
        );

    if (
      node &&
      treeId &&
      node !== previous
    ) {
      this.onDialogueNodeEntered(
        treeId,
        node,
      );
    }

    if (!node) {
      return this.flushDialogueEnds(
        true,
      );
    }

    return node;
  }

  /** Encerra o diálogo ativo (`dialogue-ended` reason "stopped"). */
  public stopDialogue(): boolean {
    const stopped =
      this.dialogueParser.stop();

    if (stopped) {
      this.flushDialogueEnds(
        true,
      );
    }

    return stopped;
  }

  public isDialogueActive():
    boolean {
    return this.dialogueParser.isActive();
  }

  public getCurrentDialogueNode():
    DialogueNode | null {
    return this.dialogueParser
      .getCurrentNode();
  }

  /** Escolhas do nó atual liberadas pelas variáveis. */
  public getAvailableChoices():
    DialogueChoice[] {
    return this.dialogueParser.getAvailableChoices();
  }

  /** Variável pública usada por `conditionVariable` das escolhas (G123). */
  public setVariable(
    key: string,
    value: unknown,
  ): void {
    if (typeof key !== "string" || key.length === 0) return;
    this.dialogueParser.setVariable(
      key,
      value,
    );
  }

  public getVariable(
    key: string,
  ): unknown {
    return this.dialogueParser.getVariable(
      key,
    );
  }

  /* ─────────────────────────────── QUESTS ────────────────────────────── */

  /**
   * Registra/atualiza a quest. O estado existente é preservado (G126);
   * `resetState: true` o descarta.
   */
  public registerQuest(
    descriptor: QuestDescriptor,
    options?: RegisterQuestOptions,
  ): boolean {
    return this.questManager
      .registerQuest(
        descriptor,
        options,
      );
  }

  /**
   * Idempotente (G126): quest já ativa/concluída/falhada retorna false sem
   * reiniciar; `restart: true` reinicia.
   */
  public startQuest(
    questId: string,
    options?: StartQuestOptions,
  ): boolean {
    const started =
      this.questManager
        .startQuest(
          questId,
          options,
        );

    if (!started) {
      return false;
    }

    this.emitQuestChange();

    return true;
  }

  public restartQuest(
    questId: string,
  ): boolean {
    return this.startQuest(
      questId,
      { restart: true },
    );
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

    this.emitQuestChange();

    return state;
  }

  public completeQuest(
    questId: string,
  ): QuestState | null {
    const state =
      this.questManager.completeQuest(
        questId,
      );

    this.emitQuestChange();

    return state;
  }

  public failQuest(
    questId: string,
    reason?: string,
  ): QuestState | null {
    const state =
      this.questManager.failQuest(
        questId,
        reason,
      );

    this.emitQuestChange(
      reason,
    );

    return state;
  }

  /**
   * Avança as quests ativas cuja etapa atual tem `targetEntityId` igual a
   * `entityId` (G125). Retorna os estados atualizados.
   */
  public reportQuestTarget(
    entityId: string,
    amount = 1,
  ): QuestState[] {
    const updated: QuestState[] = [];

    for (
      const questId of
      this.questManager.findActiveQuestsTargeting(
        entityId,
      )
    ) {
      const state =
        this.advanceQuestProgress(
          questId,
          amount,
        );

      if (state) {
        updated.push(
          state,
        );
      }
    }

    return updated;
  }

  public getQuestState(
    questId: string,
  ): QuestState | null {
    return this.questManager
      .getQuestState(
        questId,
      );
  }

  /* ─────────────────────────── TRIGGER ZONES ─────────────────────────── */

  /**
   * Registra (ou re-registra) a zona. Re-registro emite `exited` de quem
   * estava dentro. Zonas com `targetTags` passam a verificar sozinhas as
   * entidades do `game.world` com essas tags (G10/G125).
   */
  public registerTriggerZone(
    config: TriggerZoneConfig,
  ): boolean {
    const ok =
      this.triggerManager
        .registerZone(
          config,
          this.onTriggerZoneEvent,
        );

    if (
      ok &&
      config.targetTags &&
      config.targetTags.length > 0
    ) {
      this.scanWorldForTaggedEntities();
    }

    return ok;
  }

  /** Remove a zona; quem estava dentro recebe `exited` ("zone-removed"). */
  public unregisterTriggerZone(
    zoneId: string,
  ): boolean {
    return this.triggerManager
      .unregisterZone(
        zoneId,
        this.onTriggerZoneEvent,
      );
  }

  /** Verificação manual (continua disponível). */
  public checkEntityInZones(
    entityId: string,
    position: Vector3Scripting,
    options?: TriggerCheckOptions,
  ): void {
    this.triggerManager
      .checkEntityInZones(
        entityId,
        position,
        this.onTriggerZoneEvent,
        options?.tags ??
          this.trackedEntities.get(
            entityId,
          )?.tags ??
          this.readWorldTags(
            entityId,
          ),
        options?.sweep,
      );
  }

  /**
   * Passa a verificar a entidade sozinha a cada tick, lendo a posição do
   * `game.world` (G10). Sem `game.world`, use `checkEntityInZones`.
   */
  public trackEntity(
    entityId: string,
    options?: TrackEntityOptions,
  ): void {
    if (typeof entityId !== "string" || entityId.length === 0) return;

    this.trackedEntities.set(
      entityId,
      {
        tags:
          options?.tags
            ? options.tags.slice()
            : null,
        automatic: false,
      },
    );
  }

  public untrackEntity(
    entityId: string,
  ): boolean {
    return this.trackedEntities.delete(
      entityId,
    );
  }

  /**
   * Entidade destruída/removida: `exited` ("entity-removed") de todas as
   * zonas e para de rastreá-la (G127). Chamado sozinho em
   * `game.world.entity-despawned`.
   */
  public removeEntityFromZones(
    entityId: string,
  ): void {
    this.trackedEntities.delete(
      entityId,
    );

    this.triggerManager.removeEntity(
      entityId,
      this.onTriggerZoneEvent,
    );
  }

  public getEntitiesInZone(
    zoneId: string,
  ): string[] {
    return this.triggerManager.getEntitiesInZone(
      zoneId,
    );
  }

  /** Remove todas as zonas emitindo `exited` ("zone-removed"). */
  public clearTriggerZones(): void {
    this.triggerManager.clear(
      this.onTriggerZoneEvent,
    );
  }

  /** `game.world.entity-spawned`: rastreia se casar `targetTags` de alguma zona. */
  public handleWorldEntitySpawned(
    entityId: string,
  ): void {
    if (
      this.trackedEntities.has(
        entityId,
      )
    ) {
      return;
    }

    const tags =
      this.readWorldTags(
        entityId,
      );

    if (
      this.triggerManager.anyZoneTargetsTags(
        tags,
      )
    ) {
      this.trackedEntities.set(
        entityId,
        {
          tags: null,
          automatic: true,
        },
      );
    }
  }

  /* ─────────────────────────────── TICK ──────────────────────────────── */

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
        "completed",
        this.timeline.lastElapsedSeconds,
      );
    }

    if (
      this.trackedEntities.size >
      0
    ) {
      this.tickWorld =
        this.resolveWorld();

      this.trackedEntities.forEach(
        this.checkTrackedEntityBound,
      );

      this.tickWorld =
        undefined;
    }
  }

  /**
   * Limpa tudo EMITINDO os encerramentos (cutscene "stopped", diálogo
   * "stopped", `exited` das zonas). Para teardown silencioso use `dispose`.
   */
  public clear(): void {
    this.endActiveCutscene(
      "stopped",
    );

    if (
      this.dialogueParser.stop()
    ) {
      this.flushDialogueEnds(
        false,
      );
    }

    this.triggerManager.clear(
      this.onTriggerZoneEvent,
    );

    this.dispose();
  }

  /** Teardown silencioso (sem eventos). */
  public dispose(): void {
    this.stopCutsceneSounds();
    this.stopVoice();
    this.trackedEntities.clear();
    this.timeline.clear();
    this.dialogueParser.clear();
    this.questManager.clear();
    this.triggerManager.clear();
  }

  /* ───────────────────────────── INTERNOS ────────────────────────────── */

  private checkTrackedEntity(
    entityId: string,
    tracked: TrackedEntity,
  ): void {
    const world =
      this.tickWorld;

    if (!world) {
      return;
    }

    const state =
      world.getEntityState(
        entityId,
      );

    if (!state) {
      // Entidade sumiu do mundo: sai das zonas (G127).
      this.removeEntityFromZones(
        entityId,
      );

      return;
    }

    this.triggerManager.checkEntityInZones(
      entityId,
      state.position,
      this.onTriggerZoneEvent,
      tracked.tags ??
        state.tags,
    );
  }

  private scanWorldForTaggedEntities(): void {
    const world =
      this.resolveWorld();

    if (!world) {
      return;
    }

    let entities: ReadonlyArray<{ entityId: string; tags: ReadonlyArray<string> }>;

    try {
      entities =
        world.getAllEntities();
    } catch {
      return;
    }

    for (const entity of entities) {
      if (
        !this.trackedEntities.has(
          entity.entityId,
        ) &&
        this.triggerManager.anyZoneTargetsTags(
          entity.tags,
        )
      ) {
        this.trackedEntities.set(
          entity.entityId,
          {
            tags: null,
            automatic: true,
          },
        );
      }
    }
  }

  private readWorldTags(
    entityId: string,
  ): ReadonlyArray<string> | null {
    const world =
      this.resolveWorld();

    if (!world) {
      return null;
    }

    try {
      return world.getEntityState(
        entityId,
      )?.tags ?? null;
    } catch {
      return null;
    }
  }

  private endActiveCutscene(
    reason: CutsceneEndReason,
  ): void {
    const cutsceneId =
      this.timeline
        .currentCutsceneId;

    if (!cutsceneId) {
      return;
    }

    this.timeline.stop();

    this.emitCutsceneFinished(
      cutsceneId,
      reason,
      this.timeline.lastElapsedSeconds,
    );
  }

  private emitCutsceneFinished(
    cutsceneId: string,
    reason: CutsceneEndReason,
    elapsedSeconds: number,
  ): void {
    this.stopCutsceneSounds();

    /*
     * A alocação do payload acontece somente no evento terminal da
     * cutscene, nunca no caminho comum de cada tick. Não reutilizamos
     * payload mutável porque EventBusApi.emit() enfileira a referência.
     */
    this.safeEmit(
      CutsceneFinishedEvent.type,
      {
        cutsceneId,
        reason,
        elapsedSeconds,
      },
    );
  }

  /**
   * Executa o keyframe pela capability da trilha. Retorna true se a ação
   * foi reconhecida e a capability existe.
   */
  private dispatchKeyframe(
    trackType: TrackType,
    actionType: string,
    targetId: string,
    payload: Record<string, unknown>,
  ): boolean {
    try {
      switch (trackType) {
        case "camera":
          return this.dispatchCamera(actionType, targetId, payload);
        case "audio":
          return this.dispatchAudio(actionType, targetId, payload);
        case "animation":
          return this.dispatchAnimation(actionType, targetId, payload);
        case "vfx":
          return this.dispatchVfx(actionType, targetId, payload);
        case "dialogue":
          return this.dispatchDialogue(actionType, targetId, payload);
        default:
          return false;
      }
    } catch (error) {
      console.error(
        `[Scripting] keyframe ${trackType}/${actionType} falhou:`,
        error,
      );
      return false;
    }
  }

  private dispatchCamera(
    actionType: string,
    targetId: string,
    payload: Record<string, unknown>,
  ): boolean {
    const camera = this.resolve(CameraToken, "camera");
    if (!camera) return false;

    switch (actionType) {
      case "set-active":
        camera.setActiveCamera(targetId, num(payload.blendDurationSeconds));
        return true;
      case "shake":
      case "trauma":
        camera.addTrauma(num(payload.amount) ?? 0.5);
        return true;
      case "look-at":
        camera.setLookAtTarget(targetId, vec(payload.position));
        return true;
      case "follow": {
        const position = vec(payload.position);
        if (!position) return false;
        camera.setFollowTarget(targetId, position);
        return true;
      }
      case "set-priority": {
        const priority = num(payload.priority);
        if (priority === undefined) return false;
        camera.setCameraPriority(targetId, priority);
        return true;
      }
      default:
        return false;
    }
  }

  private dispatchAudio(
    actionType: string,
    targetId: string,
    payload: Record<string, unknown>,
  ): boolean {
    const audio = this.resolve(AudioToken, "audio");
    if (!audio) return false;

    const url = str(payload.url) ?? targetId;

    switch (actionType) {
      case "play": {
        const loop = payload.loop === true;
        const handle = audio.playSound(url, channel(payload.channel) ?? "sfx", num(payload.volume), loop);
        if (loop && handle) this.cutsceneSoundHandles.push(handle);
        return true;
      }
      case "music":
        void audio.crossfadeMusic(url, { durationSeconds: num(payload.durationSeconds) ?? 1 }).catch(() => undefined);
        return true;
      case "stop-music":
        void audio.stopMusic(num(payload.fadeSeconds)).catch(() => undefined);
        return true;
      case "stop-channel": {
        const target = channel(targetId) ?? channel(payload.channel);
        if (!target) return false;
        audio.stopChannel(target, num(payload.fadeSeconds));
        return true;
      }
      default:
        return false;
    }
  }

  private dispatchAnimation(
    actionType: string,
    targetId: string,
    payload: Record<string, unknown>,
  ): boolean {
    const anim = this.resolve(AnimationToken, "anim");
    if (!anim) return false;

    switch (actionType) {
      case "play": {
        const state = str(payload.state);
        if (!state) return false;
        return anim.playAnimation(
          targetId,
          state,
          num(payload.fadeSeconds),
          payload.restart === true ? { restart: true } : undefined,
        );
      }
      case "set-param": {
        const param = str(payload.param);
        const value = payload.value;
        if (!param || (typeof value !== "number" && typeof value !== "string" && typeof value !== "boolean")) return false;
        anim.setParam(targetId, param, value);
        return true;
      }
      default:
        return false;
    }
  }

  private dispatchVfx(
    actionType: string,
    targetId: string,
    payload: Record<string, unknown>,
  ): boolean {
    const vfx = this.resolve(VfxToken, "vfx");
    if (!vfx) return false;

    switch (actionType) {
      case "preset": {
        const position = vec(payload.position);
        const instanceId = str(payload.instanceId);
        return vfx.triggerVFXPresetById(targetId, {
          ...(position ? { position } : {}),
          ...(instanceId ? { instanceId } : {}),
        }) !== null;
      }
      case "bloom":
        vfx.pulseBloom(num(payload.strength) ?? 1, num(payload.durationSeconds) ?? 0.3);
        return true;
      case "stop-emitter":
        vfx.stopParticleEmitter(targetId);
        return true;
      default:
        return false;
    }
  }

  private dispatchDialogue(
    actionType: string,
    targetId: string,
    payload: Record<string, unknown>,
  ): boolean {
    switch (actionType) {
      case "start":
        return this.startDialogue(targetId, str(payload.startNodeId)) !== null;
      case "advance":
        this.advanceDialogue(num(payload.choiceIndex));
        return true;
      case "stop":
        return this.stopDialogue();
      default:
        return false;
    }
  }

  /** Nó novo: evento + falas (áudio) e animação do falante (G125). */
  private onDialogueNodeEntered(
    treeId: string,
    node: DialogueNode,
  ): void {
    this.safeEmit(
      DialogueNodeChangedEvent.type,
      {
        treeId,
        currentNode:
          node,
      },
    );

    this.stopVoice();

    if (node.audioClipUrl) {
      const audio = this.resolve(AudioToken, "audio");
      if (audio) {
        try {
          this.voiceHandle = audio.playSound(node.audioClipUrl, "voice");
        } catch (error) {
          console.error("[Scripting] falha ao tocar a fala do diálogo:", error);
        }
      }
    }

    if (node.animationState && node.speakerEntityId) {
      const anim = this.resolve(AnimationToken, "anim");
      if (anim) {
        try {
          anim.playAnimation(node.speakerEntityId, node.animationState);
        } catch (error) {
          console.error("[Scripting] falha ao animar o falante:", error);
        }
      }
    }
  }

  /**
   * Emite `dialogue-ended` dos diálogos encerrados. Com `startQueued`, o
   * próximo da fila começa. Retorna o nó atual depois disso.
   */
  private flushDialogueEnds(
    startQueued: boolean,
  ): DialogueNode | null {
    const ended =
      this.dialogueParser.drainEnded();

    if (ended.length > 0 && !this.dialogueParser.isActive()) {
      this.stopVoice();
    }

    for (const end of ended) {
      this.safeEmit(
        DialogueEndedEvent.type,
        {
          treeId: end.treeId,
          lastNodeId: end.lastNodeId,
          reason: end.reason,
        },
      );
    }

    if (startQueued && !this.dialogueParser.isActive()) {
      const next = this.dialogueParser.startNextQueued();
      const treeId = this.dialogueParser.currentTreeId;
      if (next && treeId) {
        this.onDialogueNodeEntered(treeId, next);
      }
    }

    return this.dialogueParser.getCurrentNode();
  }

  private emitQuestChange(
    failureReason?: string,
  ): void {
    const change =
      this.questManager.consumeLastChange();

    if (!change) {
      return;
    }

    const state =
      change.state;

    this.safeEmit(
      QuestStepUpdatedEvent.type,
      {
        questId: state.questId,
        questState: state,
      },
    );

    if (change.completedNow) {
      const descriptor =
        this.questManager.getDescriptor(
          state.questId,
        );

      this.safeEmit(
        QuestCompletedEvent.type,
        {
          questId: state.questId,
          questState: state,
          ...(descriptor?.rewardXp !== undefined ? { rewardXp: descriptor.rewardXp } : {}),
          ...(descriptor?.rewardItems !== undefined ? { rewardItems: descriptor.rewardItems.slice() } : {}),
        },
      );
    }

    if (change.failedNow) {
      this.safeEmit(
        QuestFailedEvent.type,
        {
          questId: state.questId,
          questState: state,
          ...(failureReason !== undefined ? { reason: failureReason } : {}),
        },
      );
    }
  }

  private stopCutsceneSounds(): void {
    if (this.cutsceneSoundHandles.length === 0) return;
    const audio = this.resolve(AudioToken, "audio");
    for (const handle of this.cutsceneSoundHandles) {
      try {
        audio?.stopSound(handle, 0.2);
      } catch {
        // som já liberado
      }
    }
    this.cutsceneSoundHandles.length = 0;
  }

  private stopVoice(): void {
    if (this.voiceHandle === 0) return;
    const handle = this.voiceHandle;
    this.voiceHandle = 0;
    try {
      this.resolve(AudioToken, "audio")?.stopSound(handle, 0.1);
    } catch {
      // som já liberado
    }
  }

  private resolveWorld(): WorldApi | undefined {
    return this.resolve(WorldToken, "world");
  }

  private resolve<T>(
    token: CapabilityToken<T>,
    key: keyof ScriptingDependencies,
  ): T | undefined {
    const bound = this.boundDeps[key] as T | undefined;
    if (bound !== undefined) return bound;

    try {
      return this.ctx.caps?.get?.(token);
    } catch {
      return undefined;
    }
  }

  /** Emit que nunca derruba o fluxo (ex.: barramento já descartado no teardown). */
  private safeEmit(
    type: string,
    payload: unknown,
  ): void {
    try {
      this.ctx.events.emit(
        type,
        payload,
      );
    } catch (error) {
      console.error(
        `[Scripting] falha ao emitir ${type}:`,
        error,
      );
    }
  }
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function vec(value: unknown): Vector3Scripting | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Vector3Scripting>;
  const x = num(candidate.x);
  const y = num(candidate.y);
  const z = num(candidate.z);
  return x === undefined || y === undefined || z === undefined ? null : { x, y, z };
}

function channel(value: unknown): AudioChannelType | undefined {
  return typeof value === "string" && (AUDIO_CHANNELS as ReadonlyArray<string>).includes(value)
    ? (value as AudioChannelType)
    : undefined;
}
