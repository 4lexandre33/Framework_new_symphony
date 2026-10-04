import type {
  AnimationClip,
  Object3D,
} from "three";

import {
  defineCapability,
} from "@core";

import type {
  AnimationClipConfig,
  AnimationParamValue,
  AnimationTransition,
  SpriteAnimationFrame,
} from "../contracts/anim/types";

export interface AnimationApi {
  registerState(
    entityId: string,
    config: AnimationClipConfig,
  ): boolean;

  addTransition(
    entityId: string,
    transition: AnimationTransition,
  ): boolean;

  playAnimation(
    entityId: string,
    stateName: string,
    fadeDurationSeconds?: number,
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

  register2DSprite(
    entityId: string,
    material: unknown,
    frames:
      ReadonlyArray<SpriteAnimationFrame>,
  ): void;

  unregisterEntity(
    entityId: string,
  ): void;

  getCurrentState(
    entityId: string,
  ): string | null;
}

export const AnimationToken =
  defineCapability<AnimationApi>(
    "game.anim",
    "1.0.0",
  );