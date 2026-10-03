import type {
  Plugin,
  PluginContext,
} from "../../core/contracts/plugin-context";

import {
  AnimationToken,
  type AnimationApi,
} from "../../tokens/anim";

import {
  AnimationStateChangedEvent,
  AnimationTriggeredEvent,
  PlayAnimationCommand,
  CrossFadeCommand,
  SetAnimParamCommand,
  type AnimationClipConfig,
  type AnimationParamValue,
  type AnimationTransition,
  type CrossFadeRequest,
  type PlayAnimationRequest,
  type SetAnimParamRequest,
  type SpriteAnimationFrame,
} from "../../contracts/anim/types";

import type {
  GameRenderPayload,
  GameTickPayload,
} from "../../contracts/game-loop/types";

import {
  AnimationState,
} from "../../engine/anim/AnimationState";

import {
  AnimationStateMachine,
} from "../../engine/anim/AnimationStateMachine";

import {
  SkeletalAnimationDriver,
} from "../../engine/anim/SkeletalAnimationDriver";

import {
  Sprite2DAnimationDriver,
  type SpriteMaterialLike,
} from "../../engine/anim/Sprite2DAnimationDriver";

import {
  AnimationEventManager,
} from "../../engine/anim/AnimationEventManager";

import type {
  AnimationClip,
  Object3D,
} from "three";

export const animManifest:
  Plugin["manifest"] = {
    id:
      "game.anim",

    name:
      "Animation Pipeline & State Machine Plugin",

    version:
      "1.0.0",

    kind:
      "preloaded",

    authority:
      "game",

    dependsOn: [
      {
        id:
          "game.loop",

        range:
          "^1.0.0",
      },
    ],

    permissions: {
      capabilities: [
        AnimationToken.id,
      ],

      events: [
        "game.anim.state-changed",
        "game.anim.event-triggered",
      ],
    },

    capabilities: {
      provides: [
        {
          id:
            AnimationToken.id,

          version:
            "1.0.0",
        },
      ],
    },
  };

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
    const fsm =
      this.getOrCreateStateMachine(
        entityId,
      );

    return fsm.addState(
      new AnimationState(
        config.name,
        config.id,
        config.durationSeconds,
        config.timeScale ??
          1,
        config.loopMode ??
          "LoopRepeat",
        config.triggers ??
          [],
      ),
    );
  }

  public addTransition(
    entityId: string,
    transition:
      AnimationTransition,
  ): boolean {
    const fsm =
      this.getOrCreateStateMachine(
        entityId,
      );

    return fsm.addTransition(
      transition,
    );
  }

  public playAnimation(
    entityId: string,
    stateName: string,
    fadeDurationSeconds =
      0.2,
  ): boolean {
    const fsm =
      this.fsms.get(
        entityId,
      );

    if (
      !fsm ||
      !fsm.hasState(
        stateName,
      )
    ) {
      return false;
    }

    const previousState =
      fsm.getCurrentStateName();

    const started =
      fsm.startCrossFade(
        stateName,
        fadeDurationSeconds,
      );

    if (!started) {
      return false;
    }

    this.playSkeletalState(
      entityId,
      fsm,
      stateName,
      fadeDurationSeconds,
    );

    /*
     * Fade zero troca a FSM imediatamente.
     */
    const currentState =
      fsm.getCurrentStateName();

    if (
      currentState &&
      previousState !==
        currentState
    ) {
      this.eventManager
        .resetEntityTriggers(
          entityId,
        );

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
        fromState
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

    /*
     * Cada AnimationClip do GLTF vira automaticamente
     * um estado da FSM com o mesmo nome.
     *
     * O jogo ainda pode registrar um estado lógico
     * diferente depois usando registerState().
     */
    for (
      let index = 0;
      index <
      animations.length;
      index += 1
    ) {
      const clip =
        animations[index];

      if (!clip) {
        continue;
      }

      const fsm =
        this.getOrCreateStateMachine(
          entityId,
        );

      if (
        fsm.hasState(
          clip.name,
        )
      ) {
        continue;
      }

      this.registerState(
        entityId,
        {
          id:
            clip.name,

          name:
            clip.name,

          durationSeconds:
            Math.max(
              0.001,
              clip.duration,
            ),

          loopMode:
            "LoopRepeat",

          timeScale:
            1,
        },
      );
    }
  }

  public register2DSprite(
    entityId: string,
    material: unknown,
    frames:
      ReadonlyArray<SpriteAnimationFrame>,
  ): void {
    this.spriteDriver.register(
      entityId,
      material as
        SpriteMaterialLike,
      frames,
    );
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

    this.eventManager
      .resetEntityTriggers(
        entityId,
      );
  }

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

  public tick(
    deltaSeconds: number,
  ): void {
    const safeDelta =
      this.sanitizeDelta(
        deltaSeconds,
      );

    for (
      const [
        entityId,
        fsm,
      ] of
      this.fsms.entries()
    ) {
      const previousCurrentState =
        fsm.getCurrentStateName();

      const previousTargetState =
        fsm.getTargetStateName();

      const result =
        fsm.update(
          safeDelta,
        );

      /*
       * Transição disparada por parâmetros da FSM.
       *
       * O driver esquelético é acionado apenas
       * quando aparece um novo target.
       */
      if (
        result.targetState &&
        result.targetState !==
          previousTargetState
      ) {
        this.playSkeletalState(
          entityId,
          fsm,
          result.targetState,
          result.crossFadeDurationSeconds,
        );
      }

      /*
       * A troca lógica do estado só é anunciada
       * quando o crossfade terminou.
       */
      if (
        result.currentState &&
        result.currentState !==
          previousCurrentState
      ) {
        /*
         * Caso a transição tenha começado e terminado
         * no mesmo tick, garante que o clip visual
         * também seja ativado.
         */
        if (
          previousTargetState !==
          result.currentState
        ) {
          this.playSkeletalState(
            entityId,
            fsm,
            result.currentState,
            0,
          );
        }

        this.eventManager
          .resetEntityTriggers(
            entityId,
          );

        this.emitStateChanged(
          entityId,
          previousCurrentState,
          result.currentState,
        );
      }

      const state =
        fsm.getCurrentState();

      if (
        state &&
        state.triggers.length >
          0
      ) {
        this.eventManager
          .processTriggers(
            entityId,
            state.name,
            fsm.getCurrentNormalizedTime(),
            state.triggers,
          );
      }
    }
  }

  public render(
    deltaSeconds: number,
  ): void {
    const safeDelta =
      this.sanitizeDelta(
        deltaSeconds,
      );

    this.skeletalDriver.update(
      safeDelta,
    );

    this.spriteDriver.update(
      safeDelta,
    );
  }

  public dispose(): void {
    this.fsms.clear();

    this.skeletalDriver.dispose();

    this.spriteDriver.dispose();

    this.eventManager.clear();
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

  private playSkeletalState(
    entityId: string,
    fsm:
      AnimationStateMachine,
    stateName: string,
    fadeDurationSeconds:
      number,
  ): void {
    const state =
      fsm.getState(
        stateName,
      );

    if (!state) {
      return;
    }

    this.skeletalDriver.play(
      entityId,
      state.clipId,
      fadeDurationSeconds,
      state.timeScale,
      state.loopMode,
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

    return deltaSeconds;
  }
}

export function createAnimationPlugin():
  Plugin {
  return {
    manifest:
      animManifest,

    setup(
      ctx: PluginContext,
    ): void {
      const animService =
        new AnimationService(
          ctx,
        );

      ctx.caps.provide(
        AnimationToken,
        animService,
      );

      ctx.events.define(
        AnimationStateChangedEvent,
      );

      ctx.events.define(
        AnimationTriggeredEvent,
      );

      ctx.commands.define(
        PlayAnimationCommand,
      );

      ctx.commands.define(
        CrossFadeCommand,
      );

      ctx.commands.define(
        SetAnimParamCommand,
      );

      const unbindTick =
        ctx.events.on(
          "game.loop.tick",
          (
            envelope,
          ): void => {
            const payload =
              envelope.payload as
                GameTickPayload;

            animService.tick(
              payload.deltaSeconds,
            );
          },
        );

      const unbindRender =
        ctx.events.on(
          "game.loop.render",
          (
            envelope,
          ): void => {
            const payload =
              envelope.payload as
                GameRenderPayload;

            animService.render(
              payload.deltaSeconds,
            );
          },
        );

      const unbindPlay =
        ctx.commands.handle(
          "game.anim.play",
          (
            envelope,
          ) => {
            const payload =
              envelope.payload as
                PlayAnimationRequest;

            return animService
              .playAnimation(
                payload.entityId,
                payload.stateName,
                payload.fadeDurationSeconds,
              );
          },
        );

      const unbindCrossFade =
        ctx.commands.handle(
          "game.anim.cross-fade",
          (
            envelope,
          ) => {
            const payload =
              envelope.payload as
                CrossFadeRequest;

            return animService
              .crossFade(
                payload.entityId,
                payload.fromState,
                payload.toState,
                payload.durationSeconds,
              );
          },
        );

      const unbindSetParam =
        ctx.commands.handle(
          "game.anim.set-param",
          (
            envelope,
          ) => {
            const payload =
              envelope.payload as
                SetAnimParamRequest;

            animService.setParam(
              payload.entityId,
              payload.paramName,
              payload.value,
            );
          },
        );

      ctx.lifecycle.onDispose(
        (): void => {
          unbindTick();
          unbindRender();
          unbindPlay();
          unbindCrossFade();
          unbindSetParam();

          animService.dispose();
        },
      );

      ctx.lifecycle.ready();
    },
  };
}