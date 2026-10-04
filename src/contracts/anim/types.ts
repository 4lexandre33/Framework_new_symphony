import {
  defineCommand,
  defineEvent,
} from "@core";

export type AnimationLoopMode =
  | "LoopOnce"
  | "LoopRepeat"
  | "LoopPingPong";

export interface AnimationEventTrigger {
  /**
   * Valor normalizado da animação entre 0 e 1.
   *
   * Exemplo:
   * 0.0 = início
   * 0.5 = metade
   * 1.0 = final
   */
  readonly frameOrTime: number;

  readonly eventName: string;

  readonly payload?:
    Record<string, unknown>;
}

export interface AnimationClipConfig {
  /**
   * Nome real do clip dentro do AnimationMixer.
   *
   * Exemplo:
   * "clip_idle"
   */
  readonly id: string;

  /**
   * Nome lógico do estado da FSM.
   *
   * Exemplo:
   * "Idle"
   */
  readonly name: string;

  readonly durationSeconds: number;

  readonly loopMode?:
    AnimationLoopMode;

  readonly timeScale?:
    number;

  readonly triggers?:
    ReadonlyArray<AnimationEventTrigger>;
}

export interface SpriteAnimationFrame {
  readonly frameIndex: number;

  readonly durationMs: number;

  readonly uvOffset: {
    readonly x: number;
    readonly y: number;
  };

  readonly uvScale: {
    readonly x: number;
    readonly y: number;
  };
}

export interface AnimationTransition {
  readonly fromState: string;

  readonly toState: string;

  readonly durationSeconds: number;

  readonly conditionParam?:
    string;

  readonly conditionOperator?:
    | ">"
    | "<"
    | "=="
    | "!="
    | ">="
    | "<=";

  readonly conditionValue?:
    number | string | boolean;
}

export type AnimationParamValue =
  | number
  | string
  | boolean;

export interface AnimationEventTriggerPayload {
  readonly entityId: string;

  readonly stateName: string;

  readonly eventName: string;

  readonly payload?:
    Record<string, unknown>;
}

/* ==========================================================================
 * EVENTS
 * ======================================================================== */

export interface AnimationStateChangedPayload {
  readonly entityId: string;

  readonly fromState: string;

  readonly toState: string;

  readonly timestamp: number;
}

export const AnimationStateChangedEvent =
  defineEvent<
    "game.anim.state-changed",
    AnimationStateChangedPayload
  >(
    "game.anim.state-changed",
  );

export const AnimationTriggeredEvent =
  defineEvent<
    "game.anim.event-triggered",
    AnimationEventTriggerPayload
  >(
    "game.anim.event-triggered",
  );

/* ==========================================================================
 * COMMANDS
 * ======================================================================== */

export interface PlayAnimationRequest {
  readonly entityId: string;

  readonly stateName: string;

  readonly fadeDurationSeconds?:
    number;
}

export const PlayAnimationCommand =
  defineCommand<
    "game.anim.play",
    PlayAnimationRequest
  >(
    "game.anim.play",
  );

export interface CrossFadeRequest {
  readonly entityId: string;

  readonly fromState: string;

  readonly toState: string;

  readonly durationSeconds: number;
}

export const CrossFadeCommand =
  defineCommand<
    "game.anim.cross-fade",
    CrossFadeRequest
  >(
    "game.anim.cross-fade",
  );

export interface SetAnimParamRequest {
  readonly entityId: string;

  readonly paramName: string;

  readonly value:
    AnimationParamValue;
}

export const SetAnimParamCommand =
  defineCommand<
    "game.anim.set-param",
    SetAnimParamRequest
  >(
    "game.anim.set-param",
  );