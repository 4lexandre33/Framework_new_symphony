import * as THREE from "three";

import type {
  AnimationLoopMode,
} from "../../../contracts/anim/types";

export interface ActiveSkeletalAnimation {
  readonly rootObject:
    THREE.Object3D;

  readonly mixer:
    THREE.AnimationMixer;

  readonly actions:
    Map<
      string,
      THREE.AnimationAction
    >;

  currentActionName:
    string | null;
}

export class SkeletalAnimationDriver {
  private readonly entityAnimations =
    new Map<
      string,
      ActiveSkeletalAnimation
    >();

  public register(
    entityId: string,
    rootObject:
      THREE.Object3D,
    clips:
      ReadonlyArray<THREE.AnimationClip>,
  ): void {
    this.unregister(
      entityId,
    );

    const mixer =
      new THREE.AnimationMixer(
        rootObject,
      );

    const actions =
      new Map<
        string,
        THREE.AnimationAction
      >();

    for (
      let index = 0;
      index <
      clips.length;
      index += 1
    ) {
      const clip =
        clips[index];

      if (!clip) {
        continue;
      }

      const action =
        mixer.clipAction(
          clip,
        );

      actions.set(
        clip.name,
        action,
      );
    }

    this.entityAnimations.set(
      entityId,
      {
        rootObject,
        mixer,
        actions,

        currentActionName:
          null,
      },
    );
  }

  public unregister(
    entityId: string,
  ): void {
    const animation =
      this.entityAnimations.get(
        entityId,
      );

    if (!animation) {
      return;
    }

    animation.mixer
      .stopAllAction();

    animation.actions.clear();

    animation.mixer.uncacheRoot(
      animation.rootObject,
    );

    this.entityAnimations.delete(
      entityId,
    );
  }

  public hasClip(
    entityId: string,
    clipName: string,
  ): boolean {
    return (
      this.entityAnimations
        .get(
          entityId,
        )
        ?.actions.has(
          clipName,
        ) ??
      false
    );
  }

  public play(
    entityId: string,
    clipName: string,
    fadeDurationSeconds =
      0.2,
    timeScale =
      1,
    loopMode:
      AnimationLoopMode =
        "LoopRepeat",
  ): boolean {
    const animation =
      this.entityAnimations.get(
        entityId,
      );

    if (!animation) {
      return false;
    }

    const targetAction =
      animation.actions.get(
        clipName,
      );

    if (!targetAction) {
      return false;
    }

    const fadeDuration =
      Number.isFinite(
        fadeDurationSeconds,
      )
        ? Math.max(
            0,
            fadeDurationSeconds,
          )
        : 0;

    const safeTimeScale =
      Number.isFinite(
        timeScale,
      )
        ? timeScale
        : 1;

    this.configureLoop(
      targetAction,
      loopMode,
    );

    targetAction.enabled =
      true;

    targetAction
      .setEffectiveTimeScale(
        safeTimeScale,
      )
      .setEffectiveWeight(
        1,
      );

    if (
      animation.currentActionName ===
      clipName
    ) {
      targetAction.play();

      return true;
    }

    if (
      animation.currentActionName
    ) {
      const currentAction =
        animation.actions.get(
          animation.currentActionName,
        );

      if (currentAction) {
        if (
          fadeDuration >
          0
        ) {
          currentAction.fadeOut(
            fadeDuration,
          );
        } else {
          currentAction.stop();
        }
      }
    }

    targetAction.reset();

    if (
      fadeDuration >
      0
    ) {
      targetAction.fadeIn(
        fadeDuration,
      );
    }

    targetAction.play();

    animation.currentActionName =
      clipName;

    return true;
  }

  public update(
    deltaSeconds: number,
  ): void {
    if (
      !Number.isFinite(
        deltaSeconds,
      ) ||
      deltaSeconds <= 0
    ) {
      return;
    }

    for (
      const animation of
      this.entityAnimations.values()
    ) {
      animation.mixer.update(
        Math.min(
          deltaSeconds,
          0.25,
        ),
      );
    }
  }

  public dispose(): void {
    for (
      const animation of
      this.entityAnimations.values()
    ) {
      animation.mixer
        .stopAllAction();

      animation.actions.clear();

      animation.mixer.uncacheRoot(
        animation.rootObject,
      );
    }

    this.entityAnimations.clear();
  }

  private configureLoop(
    action:
      THREE.AnimationAction,
    loopMode:
      AnimationLoopMode,
  ): void {
    switch (loopMode) {
      case "LoopOnce": {
        action.setLoop(
          THREE.LoopOnce,
          1,
        );

        action.clampWhenFinished =
          true;

        break;
      }

      case "LoopPingPong": {
        action.setLoop(
          THREE.LoopPingPong,
          Infinity,
        );

        action.clampWhenFinished =
          false;

        break;
      }

      case "LoopRepeat":
      default: {
        action.setLoop(
          THREE.LoopRepeat,
          Infinity,
        );

        action.clampWhenFinished =
          false;

        break;
      }
    }
  }
}