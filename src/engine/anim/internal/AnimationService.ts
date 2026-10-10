import type { PluginContext } from "@core";
import { type AnimationApi } from "../../../tokens/anim";
import {
  type AnimationClipConfig,
  type AnimationClockSource,
  type AnimationParamValue,
  type AnimationStateInfo,
  type AnimationTransition,
  type PlayAnimationOptions,
  type SpriteAnimationFrame,
  type SpriteRegistrationOptions,
} from "../../../contracts/anim/types";
import { AnimationState } from "./AnimationState";
import { AnimationStateMachine } from "./AnimationStateMachine";
import { SkeletalAnimationDriver } from "./SkeletalAnimationDriver";
import { Sprite2DAnimationDriver, type SpriteMaterialLike } from "./Sprite2DAnimationDriver";
import { AnimationEventManager } from "./AnimationEventManager";
import type { AnimationClip, Object3D } from "three";

/**
 * Serviço de animação.
 *
 * Relógio único (G78): FSM, triggers, mixer 3D e sprites 2D avançam no MESMO
 * passo (`advance`), alimentado por `game.loop.tick` (padrão, determinístico)
 * ou `game.loop.render` (`setClockSource("render")`). A duração do estado vem
 * do clip real quando ele existe.
 */
export class AnimationService
  implements AnimationApi {
  private readonly fsms =
    new Map<
      string,
      AnimationStateMachine
    >();

  private readonly skeletalDriver =
    new SkeletalAnimationDriver();

  private readonly spriteDriver =
    new Sprite2DAnimationDriver();

  private readonly eventManager:
    AnimationEventManager;

  private clockSource:
    AnimationClockSource = "tick";

  private disposed =
    false;

  /** Delta do passo atual (evita closure por tick). */
  private stepDelta =
    0;

  private readonly advanceEntityBound = (
    fsm: AnimationStateMachine,
    entityId: string,
  ): void => {
    this.advanceEntity(
      entityId,
      fsm,
    );
  };

  public constructor(
    private readonly ctx:
      PluginContext,
  ) {
    this.eventManager =
      new AnimationEventManager(
        ctx,
      );
  }

  public registerState(
    entityId: string,
    config:
      AnimationClipConfig,
  ): boolean {
    if (
      !config ||
      typeof config.name !==
        "string" ||
      typeof config.id !==
        "string"
    ) {
      return false;
    }

    const fsm =
      this.getOrCreateStateMachine(
        entityId,
      );

    const state =
      new AnimationState(
        config.name,
        config.id,
        config.durationSeconds ??
          Number.NaN,
        config.timeScale ??
          1,
        config.loopMode ??
          "LoopRepeat",
        config.triggers ??
          [],
      );

    if (
      state.name.length ===
        0
    ) {
      return false;
    }

    this.syncStateDuration(
      entityId,
      state,
    );

    return fsm.addState(
      state,
    );
  }

  /**
   * Independente de ordem (G76): transições para estados ainda não
   * registrados ficam pendentes e valem quando os estados existirem.
   */
  public addTransition(
    entityId: string,
    transition:
      AnimationTransition,
  ): boolean {
    if (
      !transition ||
      typeof transition.fromState !==
        "string" ||
      typeof transition.toState !==
        "string"
    ) {
      return false;
    }

    const fsm =
      this.getOrCreateStateMachine(
        entityId,
      );

    return fsm.addTransitionDeferred(
      transition,
    );
  }

  public playAnimation(
    entityId: string,
    stateNameRaw: string,
    fadeDurationSeconds =
      0.2,
    options?:
      PlayAnimationOptions,
  ): boolean {
    const fsm =
      this.fsms.get(
        entityId,
      );

    if (
      !fsm ||
      typeof stateNameRaw !==
        "string" ||
      !fsm.hasState(
        stateNameRaw,
      )
    ) {
      return false;
    }

    const state =
      fsm.getState(
        stateNameRaw,
      );

    if (!state) {
      return false;
    }

    const stateName =
      state.name;

    const fade =
      Number.isFinite(
        fadeDurationSeconds,
      )
        ? Math.max(
            0,
            fadeDurationSeconds,
          )
        : 0;

    // O estado inicial ainda não tocou: toca agora (fade 0) e anuncia.
    const initialJustStarted =
      this.flushInitialState(
        entityId,
        fsm,
      ) ===
      stateName;

    const previousState =
      fsm.getCurrentStateName();

    const previousTarget =
      fsm.getTargetStateName();

    if (
      previousState ===
      stateName
    ) {
      /*
       * G74: pedir o estado atual de novo. Padrão: reinicia só se for
       * LoopOnce e já terminou; `restart: true` sempre reinicia.
       */
      const restart =
        !initialJustStarted &&
        (options?.restart ??
          fsm.isCurrentStateFinished());

      if (
        previousTarget !==
        null
      ) {
        // Cancela o crossfade em andamento e volta para este estado.
        fsm.startCrossFade(
          stateName,
          0,
        );

        this.playVisual(
          entityId,
          state,
          fade,
          restart,
        );
      }

      if (restart) {
        fsm.restartCurrentState();

        this.playVisual(
          entityId,
          state,
          0,
          true,
        );
      }

      return true;
    }

    if (
      previousTarget ===
        stateName &&
      options?.restart !==
        true
    ) {
      // Já está em crossfade para este estado.
      return true;
    }

    const started =
      fsm.startCrossFade(
        stateName,
        fade,
      );

    if (!started) {
      return false;
    }

    this.playVisual(
      entityId,
      state,
      fade,
      options?.restart ===
        true,
    );

    const currentState =
      fsm.getCurrentStateName();

    if (
      currentState &&
      previousState !==
        currentState
    ) {
      this.emitStateChanged(
        entityId,
        previousState,
        currentState,
      );
    }

    return true;
  }

  public crossFade(
    entityId: string,
    fromState: string,
    toState: string,
    durationSeconds: number,
  ): boolean {
    const fsm =
      this.fsms.get(
        entityId,
      );

    if (!fsm) {
      return false;
    }

    const currentState =
      fsm.getCurrentStateName();

    if (
      fromState !==
        "*" &&
      currentState !==
        (typeof fromState ===
          "string"
          ? fromState.trim()
          : fromState)
    ) {
      return false;
    }

    return this.playAnimation(
      entityId,
      toState,
      durationSeconds,
    );
  }

  public setParam(
    entityId: string,
    paramName: string,
    value:
      AnimationParamValue,
  ): void {
    const fsm =
      this.getOrCreateStateMachine(
        entityId,
      );

    fsm.setParam(
      paramName,
      value,
    );
  }

  public getParam(
    entityId: string,
    paramName: string,
  ): AnimationParamValue | undefined {
    return this.fsms
      .get(
        entityId,
      )
      ?.getParam(
        paramName,
      );
  }

  public register3DSkeleton(
    entityId: string,
    rootObject:
      Object3D,
    animations:
      ReadonlyArray<AnimationClip>,
  ): void {
    this.skeletalDriver.register(
      entityId,
      rootObject,
      animations,
    );

    const fsm =
      this.getOrCreateStateMachine(
        entityId,
      );

    /*
     * Cada AnimationClip vira automaticamente um estado (marcado como
     * automático). Um estado registrado explicitamente com registerState()
     * substitui o automático como estado inicial (G76).
     */
    for (
      let index = 0;
      index <
      animations.length;
      index += 1
    ) {
      const clip =
        animations[index];

      if (
        !clip ||
        fsm.hasState(
          clip.name,
        )
      ) {
        continue;
      }

      fsm.addState(
        new AnimationState(
          clip.name,
          clip.name,
          Math.max(
            0.001,
            clip.duration,
          ),
          1,
          "LoopRepeat",
          [],
          true,
        ),
      );
    }

    // Durações dos estados existentes passam a seguir os clips reais (G78).
    fsm.forEachState(
      (
        state,
      ): void => {
        this.syncStateDuration(
          entityId,
          state,
        );
      },
    );

    /*
     * Mixer novo: o estado visível (inicial ou já em andamento) começa a
     * tocar já, alinhado ao tempo da FSM.
     */
    const visualName =
      fsm.getVisualStateName();

    const visualState =
      visualName !== null
        ? fsm.getState(
            visualName,
          )
        : null;

    if (
      visualState &&
      !fsm.hasVisualStartPending()
    ) {
      this.playVisual(
        entityId,
        visualState,
        0,
        true,
      );

      this.skeletalDriver.setActionTime(
        entityId,
        visualState.clipId,
        fsm.getVisualElapsedSeconds(),
      );
    }
  }

  public register2DSprite(
    entityId: string,
    material: unknown,
    frames:
      ReadonlyArray<SpriteAnimationFrame>,
    options?:
      SpriteRegistrationOptions,
  ): unknown {
    return this.spriteDriver.register(
      entityId,
      material as
        SpriteMaterialLike,
      frames ??
        [],
      options,
    );
  }

  public register2DSpriteState(
    entityId: string,
    stateName: string,
    frames:
      ReadonlyArray<SpriteAnimationFrame>,
  ): boolean {
    if (
      !this.spriteDriver.has(
        entityId,
      ) ||
      typeof stateName !==
        "string" ||
      !Array.isArray(
        frames,
      )
    ) {
      return false;
    }

    this.spriteDriver.registerStateFrames(
      entityId,
      stateName.trim(),
      frames,
    );

    const state =
      this.fsms
        .get(
          entityId,
        )
        ?.getState(
          stateName,
        );

    if (state) {
      this.syncStateDuration(
        entityId,
        state,
      );
    }

    return true;
  }

  public unregisterEntity(
    entityId: string,
  ): void {
    this.fsms.delete(
      entityId,
    );

    this.skeletalDriver
      .unregister(
        entityId,
      );

    this.spriteDriver
      .unregister(
        entityId,
      );
  }

  /**
   * Estado lógico atual. Durante um crossfade continua sendo o estado de
   * ORIGEM até o fade terminar; use `getTargetState`/`getStateInfo` para o
   * estado pedido.
   */
  public getCurrentState(
    entityId: string,
  ): string | null {
    return (
      this.fsms.get(
        entityId,
      )
        ?.getCurrentStateName() ??
      null
    );
  }

  public getTargetState(
    entityId: string,
  ): string | null {
    return (
      this.fsms.get(
        entityId,
      )
        ?.getTargetStateName() ??
      null
    );
  }

  public getStateInfo(
    entityId: string,
  ): AnimationStateInfo | null {
    const fsm =
      this.fsms.get(
        entityId,
      );

    if (!fsm) {
      return null;
    }

    const current =
      fsm.getCurrentState();

    const target =
      fsm.getTargetStateName();

    return {
      currentState:
        current?.name ??
        null,

      targetState:
        target,

      requestedState:
        target ??
        current?.name ??
        null,

      normalizedTime:
        fsm.getCurrentNormalizedTime(),

      elapsedSeconds:
        fsm.getCurrentElapsedSeconds(),

      durationSeconds:
        current?.durationSeconds ??
        0,

      isCrossFading:
        fsm.isInCrossFade(),

      isFinished:
        fsm.isCurrentStateFinished(),
    };
  }

  public setClockSource(
    source:
      AnimationClockSource,
  ): void {
    if (
      source ===
        "tick" ||
      source ===
        "render"
    ) {
      this.clockSource =
        source;
    }
  }

  public getClockSource():
    AnimationClockSource {
    return this.clockSource;
  }

  /** Chamado em `game.loop.tick`: avança se o relógio for "tick". */
  public tick(
    deltaSeconds: number,
  ): void {
    if (
      this.clockSource ===
      "tick"
    ) {
      this.advance(
        deltaSeconds,
      );
    }
  }

  /** Chamado em `game.loop.render`: avança se o relógio for "render". */
  public render(
    deltaSeconds: number,
  ): void {
    if (
      this.clockSource ===
      "render"
    ) {
      this.advance(
        deltaSeconds,
      );
    }
  }

  /**
   * Passo único: FSM → triggers/fim de clip → mixer 3D → sprites 2D, todos
   * com o mesmo delta.
   */
  public advance(
    deltaSeconds: number,
  ): void {
    if (this.disposed) {
      return;
    }

    this.stepDelta =
      this.sanitizeDelta(
        deltaSeconds,
      );

    this.fsms.forEach(
      this.advanceEntityBound,
    );

    this.skeletalDriver.update(
      this.stepDelta,
    );

    this.spriteDriver.update(
      this.stepDelta,
    );
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed =
      true;

    this.fsms.clear();

    this.skeletalDriver.dispose();

    this.spriteDriver.dispose();

    this.eventManager.clear();
  }

  private advanceEntity(
    entityId: string,
    fsm:
      AnimationStateMachine,
  ): void {
    this.flushInitialState(
      entityId,
      fsm,
    );

    const previousCurrentState =
      fsm.getCurrentStateName();

    const previousTargetState =
      fsm.getTargetStateName();

    const result =
      fsm.update(
        this.stepDelta,
      );

    if (
      result.targetState &&
      result.targetState !==
        previousTargetState
    ) {
      const target =
        fsm.getState(
          result.targetState,
        );

      if (target) {
        this.playVisual(
          entityId,
          target,
          result.crossFadeDurationSeconds,
          false,
        );
      }
    }

    if (
      result.currentState &&
      result.currentState !==
        previousCurrentState
    ) {
      // Transição imediata (fade 0) dentro do update: ativa o clip.
      if (
        previousTargetState !==
        result.currentState
      ) {
        const current =
          fsm.getState(
            result.currentState,
          );

        if (current) {
          this.playVisual(
            entityId,
            current,
            0,
            true,
          );
        }
      }

      this.emitStateChanged(
        entityId,
        previousCurrentState,
        result.currentState,
      );
    }

    // Última janela do estado que saiu (triggers/fim de clip não se perdem).
    if (
      result.exitedState !==
      null
    ) {
      const exited =
        fsm.getState(
          result.exitedState,
        );

      if (exited) {
        this.processStateWindow(
          entityId,
          exited,
          result.exitedWindowStartCycles,
          result.exitedWindowEndCycles,
        );
      }
    }

    const state =
      fsm.getCurrentState();

    if (state) {
      this.processStateWindow(
        entityId,
        state,
        result.windowStartCycles,
        result.windowEndCycles,
      );
    }

    if (
      this.spriteDriver.has(
        entityId,
      )
    ) {
      const visualName =
        fsm.getVisualStateName();

      const visual =
        visualName !== null
          ? fsm.getState(
              visualName,
            )
          : null;

      if (visual) {
        this.spriteDriver.syncToState(
          entityId,
          visual.name,
          fsm.getVisualElapsedSeconds(),
          visual.loopMode,
        );
      }
    }
  }

  private processStateWindow(
    entityId: string,
    state: AnimationState,
    windowStart: number,
    windowEnd: number,
  ): void {
    if (
      state.triggers.length >
      0
    ) {
      this.eventManager.processWindow(
        entityId,
        state.name,
        state.loopMode,
        windowStart,
        windowEnd,
        state.triggers,
      );
    }

    this.eventManager.processClipEnd(
      entityId,
      state.name,
      state.clipId,
      state.loopMode,
      windowStart,
      windowEnd,
    );
  }

  /**
   * G76: o estado inicial (primeiro registrado) passa a tocar de verdade e
   * é anunciado com `state-changed` (fromState "none"). Retorna o estado
   * iniciado ou null.
   */
  private flushInitialState(
    entityId: string,
    fsm:
      AnimationStateMachine,
  ): string | null {
    if (
      !fsm.hasVisualStartPending()
    ) {
      return null;
    }

    const name =
      fsm.consumeVisualStart();

    const state =
      name !== null
        ? fsm.getState(
            name,
          )
        : null;

    if (!state) {
      return null;
    }

    this.playVisual(
      entityId,
      state,
      0,
      true,
    );

    this.emitStateChanged(
      entityId,
      null,
      state.name,
    );

    return state.name;
  }

  private syncStateDuration(
    entityId: string,
    state: AnimationState,
  ): void {
    const clipDuration =
      this.skeletalDriver.getClipDuration(
        entityId,
        state.clipId,
      ) ??
      this.spriteDriver.getStateCycleSeconds(
        entityId,
        state.name,
      );

    if (
      clipDuration !==
      null
    ) {
      state.setDurationSeconds(
        clipDuration,
      );
    }
  }

  private getOrCreateStateMachine(
    entityId: string,
  ): AnimationStateMachine {
    let fsm =
      this.fsms.get(
        entityId,
      );

    if (!fsm) {
      fsm =
        new AnimationStateMachine();

      this.fsms.set(
        entityId,
        fsm,
      );
    }

    return fsm;
  }

  private playVisual(
    entityId: string,
    state: AnimationState,
    fadeDurationSeconds:
      number,
    restart: boolean,
  ): void {
    this.skeletalDriver.play(
      entityId,
      state.clipId,
      fadeDurationSeconds,
      state.timeScale,
      state.loopMode,
      restart,
    );
  }

  private emitStateChanged(
    entityId: string,
    previousState:
      string | null,
    currentState: string,
  ): void {
    this.ctx.events.emit(
      "game.anim.state-changed",
      {
        entityId,

        fromState:
          previousState ??
          "none",

        toState:
          currentState,

        timestamp:
          Date.now(),
      },
    );
  }

  private sanitizeDelta(
    deltaSeconds: number,
  ): number {
    if (
      !Number.isFinite(
        deltaSeconds,
      ) ||
      deltaSeconds <= 0
    ) {
      return 0;
    }

    return Math.min(
      deltaSeconds,
      0.25,
    );
  }
}
