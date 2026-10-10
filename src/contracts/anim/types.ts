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

  /**
   * Duração de um ciclo (s). Opcional: quando o clip real existe (clip 3D do
   * mixer ou quadros 2D do estado) a duração do clip é usada — FSM e mixer
   * compartilham o mesmo relógio. Sem clip e sem valor: 1 s.
   */
  readonly durationSeconds?: number;

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

  /**
   * Tempo de saída normalizado do estado de origem (0..n). A transição só
   * dispara quando o clip atinge esse ponto (e a condição, se houver, é
   * verdadeira). Em clips em loop, valores < 1 são verificados a cada ciclo;
   * valores >= 1 após N ciclos. Em `LoopOnce`, >= 1 = fim do clip.
   *
   * Padrão: transição SEM `conditionParam` usa 1 (fim do clip);
   * transição com condição não tem tempo de saída.
   */
  readonly exitTime?: number;

  /**
   * `false` desliga o tempo de saída (transição sem condição volta a
   * disparar imediatamente, no próximo tick). `true` com `exitTime`
   * ausente usa 1.
   */
  readonly hasExitTime?: boolean;
}

export interface PlayAnimationOptions {
  /**
   * Pedir o estado atual de novo:
   * - `true`: reinicia o clip do começo (golpe repetido, triggers de novo);
   * - `false`: nunca reinicia (continua tocando);
   * - ausente: reinicia só se o estado for `LoopOnce` e já tiver terminado.
   */
  readonly restart?: boolean;
}

/** Relógio que avança FSM, mixer 3D e sprites 2D (sempre o MESMO para os três). */
export type AnimationClockSource =
  | "tick"
  | "render";

export interface SpriteRegistrationOptions {
  /**
   * Textura por entidade: `true` clona `material.map` para esta entidade;
   * `"auto"` (padrão) clona só se o mesmo `map` já estiver em uso por outra
   * entidade registrada; `false` usa a textura recebida.
   */
  readonly cloneTexture?: boolean | "auto";

  /**
   * Objeto (Sprite/Mesh) dono do material. Se informado e o material já
   * estiver em uso por outra entidade (ou `cloneMaterial: true`), o material
   * é clonado e atribuído a `target.material` — cada entidade anima sozinha.
   */
  readonly target?: { material: unknown };

  readonly cloneMaterial?: boolean;
}

export interface AnimationStateInfo {
  readonly currentState: string | null;
  /** Estado de destino durante um crossfade (null se não houver). */
  readonly targetState: string | null;
  /** `targetState ?? currentState`: o último estado pedido/em vigor. */
  readonly requestedState: string | null;
  readonly normalizedTime: number;
  readonly elapsedSeconds: number;
  readonly durationSeconds: number;
  readonly isCrossFading: boolean;
  /** `LoopOnce` que já chegou ao fim. */
  readonly isFinished: boolean;
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

export interface AnimationClipFinishedPayload {
  readonly entityId: string;

  readonly stateName: string;

  readonly clipId: string;

  readonly loopMode: AnimationLoopMode;

  /**
   * Ciclos completos desde a entrada no estado (LoopOnce: sempre 1).
   */
  readonly completedCycles: number;
}

/**
 * Emitido quando um clip chega ao fim: uma vez em `LoopOnce`; a cada ciclo
 * completo em `LoopRepeat`/`LoopPingPong`.
 */
export const AnimationClipFinishedEvent =
  defineEvent<
    "game.anim.clip-finished",
    AnimationClipFinishedPayload
  >(
    "game.anim.clip-finished",
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

  /** Ver `PlayAnimationOptions.restart`. */
  readonly restart?:
    boolean;
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