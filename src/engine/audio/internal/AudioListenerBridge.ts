import type {
  Vector3Audio,
} from "../../../contracts/audio/types";

import {
  AudioMixer,
} from "./AudioMixer";

const DEFAULT_FORWARD:
  Readonly<Vector3Audio> =
    Object.freeze({
      x:
        0,
      y:
        0,
      z:
        -1,
    });

const DEFAULT_UP:
  Readonly<Vector3Audio> =
    Object.freeze({
      x:
        0,
      y:
        1,
      z:
        0,
    });

function finiteOrZero(
  value:
    number,
): number {
  return Number.isFinite(
    value,
  )
    ? value
    : 0;
}

export class AudioListenerBridge {
  public constructor(
    private readonly mixer:
      AudioMixer,
  ) {}

  public updateListenerPosition(
    position:
      Vector3Audio,
    forward:
      Vector3Audio =
        DEFAULT_FORWARD,
    up:
      Vector3Audio =
        DEFAULT_UP,
  ): void {
    if (
      this.mixer
        .isDisposed
    ) {
      return;
    }

    const ctx =
      this.mixer
        .audioContext;

    const listener =
      ctx.listener;

    const px =
      finiteOrZero(
        position.x,
      );

    const py =
      finiteOrZero(
        position.y,
      );

    const pz =
      finiteOrZero(
        position.z,
      );

    const fx =
      finiteOrZero(
        forward.x,
      );

    const fy =
      finiteOrZero(
        forward.y,
      );

    const fz =
      finiteOrZero(
        forward.z,
      );

    const ux =
      finiteOrZero(
        up.x,
      );

    const uy =
      finiteOrZero(
        up.y,
      );

    const uz =
      finiteOrZero(
        up.z,
      );

    if (
      listener.positionX
    ) {
      listener.positionX
        .setValueAtTime(
          px,
          ctx.currentTime,
        );

      listener.positionY
        .setValueAtTime(
          py,
          ctx.currentTime,
        );

      listener.positionZ
        .setValueAtTime(
          pz,
          ctx.currentTime,
        );

      listener.forwardX
        .setValueAtTime(
          fx,
          ctx.currentTime,
        );

      listener.forwardY
        .setValueAtTime(
          fy,
          ctx.currentTime,
        );

      listener.forwardZ
        .setValueAtTime(
          fz,
          ctx.currentTime,
        );

      listener.upX
        .setValueAtTime(
          ux,
          ctx.currentTime,
        );

      listener.upY
        .setValueAtTime(
          uy,
          ctx.currentTime,
        );

      listener.upZ
        .setValueAtTime(
          uz,
          ctx.currentTime,
        );

      return;
    }

    listener.setPosition(
      px,
      py,
      pz,
    );

    listener.setOrientation(
      fx,
      fy,
      fz,
      ux,
      uy,
      uz,
    );
  }
}
