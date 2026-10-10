import type {
  AnimationClip,
  Object3D,
} from "three";

import {
  defineCapability,
} from "@core";

import type {
  AnimationClipConfig,
  AnimationClockSource,
  AnimationParamValue,
  AnimationStateInfo,
  AnimationTransition,
  PlayAnimationOptions,
  SpriteAnimationFrame,
  SpriteRegistrationOptions,
} from "../contracts/anim/types";

export interface AnimationApi {
  /**
   * Registra um estado. Ordem livre (G76): o primeiro estado explícito vira o
   * estado inicial e TOCA no próximo passo (emite `state-changed` de "none").
   */
  registerState(
    entityId: string,
    config: AnimationClipConfig,
  ): boolean;

  /**
   * Transições podem ser registradas antes dos estados (ficam pendentes).
   * Sem `conditionParam`, a transição espera o fim do clip (exitTime 1);
   * veja `exitTime`/`hasExitTime`.
   */
  addTransition(
    entityId: string,
    transition: AnimationTransition,
  ): boolean;

  /**
   * Toca um estado. Pedir o estado ATUAL de novo: `options.restart: true`
   * reinicia o clip (triggers disparam de novo); sem a opção, reinicia só um
   * `LoopOnce` que já terminou (G74).
   */
  playAnimation(
    entityId: string,
    stateName: string,
    fadeDurationSeconds?: number,
    options?: PlayAnimationOptions,
  ): boolean;

  crossFade(
    entityId: string,
    fromState: string,
    toState: string,
    durationSeconds: number,
  ): boolean;

  setParam(
    entityId: string,
    paramName: string,
    value: AnimationParamValue,
  ): void;

  getParam(
    entityId: string,
    paramName: string,
  ): AnimationParamValue | undefined;

  register3DSkeleton(
    entityId: string,
    rootObject: Object3D,
    animations:
      ReadonlyArray<AnimationClip>,
  ): void;

  /**
   * Registra o material do sprite e a sequência padrão. Retorna o material
   * efetivamente animado (pode ser um clone por entidade, G77).
   */
  register2DSprite(
    entityId: string,
    material: unknown,
    frames:
      ReadonlyArray<SpriteAnimationFrame>,
    options?: SpriteRegistrationOptions,
  ): unknown;

  /**
   * Quadros de um estado da FSM (G77): ao entrar no estado o sprite troca
   * de sequência; o tempo vem da FSM (mesmo relógio), respeitando o
   * `loopMode` do estado. Exige `register2DSprite` antes.
   */
  register2DSpriteState(
    entityId: string,
    stateName: string,
    frames:
      ReadonlyArray<SpriteAnimationFrame>,
  ): boolean;

  unregisterEntity(
    entityId: string,
  ): void;

  /**
   * Estado lógico atual. Durante um crossfade continua o de ORIGEM até o fim
   * do fade; o pedido está em `getTargetState`/`getStateInfo().requestedState`.
   */
  getCurrentState(
    entityId: string,
  ): string | null;

  /** Destino do crossfade em andamento, ou null. */
  getTargetState(
    entityId: string,
  ): string | null;

  /** Fotografia (objeto novo) do estado da FSM, ou null. */
  getStateInfo(
    entityId: string,
  ): AnimationStateInfo | null;

  /**
   * Relógio único de FSM + mixer + sprites: "tick" (padrão, determinístico)
   * ou "render" (suave; congela com o jogo pausado).
   */
  setClockSource(
    source: AnimationClockSource,
  ): void;

  getClockSource(): AnimationClockSource;
}

export const AnimationToken =
  defineCapability<AnimationApi>(
    "game.anim",
    "1.0.0",
  );