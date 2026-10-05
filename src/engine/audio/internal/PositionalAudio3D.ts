import type {
  PositionalAudioOptions,
  Vector3Audio,
} from "../../../contracts/audio/types";

import {
  AudioMixer,
} from "./AudioMixer";

import type {
  AudioVoiceHandle,
} from "./AudioVoiceRegistry";

function clampVolume(
  value:
    number,
): number {
  if (
    !Number.isFinite(
      value,
    )
  ) {
    return 1;
  }

  return Math.min(
    1,
    Math.max(
      0,
      value,
    ),
  );
}

function finiteOr(
  value:
    number | undefined,
  fallback:
    number,
): number {
  return (
    value !==
      undefined &&
    Number.isFinite(
      value,
    )
  )
    ? value
    : fallback;
}

export class PositionalAudio3D {
  public constructor(
    private readonly mixer:
      AudioMixer,
  ) {}

  public play(
    buffer:
      AudioBuffer,
    options:
      PositionalAudioOptions,
  ): AudioVoiceHandle {
    void this.mixer
      .resumeIfSuspended();

    const ctx =
      this.mixer
        .audioContext;

    const source =
      ctx.createBufferSource();

    source.buffer =
      buffer;

    source.loop =
      options.loop ??
      false;

    const panner =
      ctx.createPanner();

    panner.panningModel =
      "HRTF";

    panner.distanceModel =
      options.distanceModel ??
      "inverse";

    panner.refDistance =
      Math.max(
        0.0001,
        finiteOr(
          options.refDistance,
          1,
        ),
      );

    panner.maxDistance =
      Math.max(
        panner.refDistance,
        finiteOr(
          options.maxDistance,
          10000,
        ),
      );

    panner.rolloffFactor =
      Math.max(
        0,
        finiteOr(
          options.rolloffFactor,
          1,
        ),
      );

    panner.coneInnerAngle =
      Math.max(
        0,
        finiteOr(
          options.coneInnerAngle,
          360,
        ),
      );

    panner.coneOuterAngle =
      Math.max(
        0,
        finiteOr(
          options.coneOuterAngle,
          360,
        ),
      );

    panner.coneOuterGain =
      clampVolume(
        finiteOr(
          options.coneOuterGain,
          0,
        ),
      );

    this.setPosition(
      panner,
      options.position,
    );

    const gainNode =
      ctx.createGain();

    gainNode.gain
      .setValueAtTime(
        clampVolume(
          options.volume ??
          1,
        ),
        ctx.currentTime,
      );

    const sfxChannelGain =
      this.mixer
        .getChannelGainNode(
          "sfx",
        );

    source.connect(
      panner,
    );

    panner.connect(
      gainNode,
    );

    gainNode.connect(
      sfxChannelGain,
    );

    source.start(
      0,
    );

    return {
      source,
      pannerNode:
        panner,
      gainNode,
    };
  }

  public setPosition(
    panner:
      PannerNode,
    pos:
      Vector3Audio,
  ): void {
    const ctx =
      this.mixer
        .audioContext;

    const x =
      Number.isFinite(
        pos.x,
      )
        ? pos.x
        : 0;

    const y =
      Number.isFinite(
        pos.y,
      )
        ? pos.y
        : 0;

    const z =
      Number.isFinite(
        pos.z,
      )
        ? pos.z
        : 0;

    if (
      panner.positionX
    ) {
      panner.positionX
        .setValueAtTime(
          x,
          ctx.currentTime,
        );

      panner.positionY
        .setValueAtTime(
          y,
          ctx.currentTime,
        );

      panner.positionZ
        .setValueAtTime(
          z,
          ctx.currentTime,
        );

      return;
    }

    panner.setPosition(
      x,
      y,
      z,
    );
  }
}
