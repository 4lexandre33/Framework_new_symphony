import type {
  MusicCrossfadeOptions,
} from "../../../contracts/audio/types";

import {
  AudioMixer,
} from "./AudioMixer";

const MIN_EXPONENTIAL_GAIN =
  0.0001;

function sanitizeDuration(
  value:
    number | undefined,
): number {
  if (
    value ===
      undefined
  ) {
    return 1.5;
  }

  if (
    !Number.isFinite(
      value,
    )
  ) {
    return 0;
  }

  return Math.min(
    60,
    Math.max(
      0,
      value,
    ),
  );
}

function rampGain(
  param:
    AudioParam,
  value:
    number,
  endTime:
    number,
  exponential:
    boolean,
): void {
  if (
    exponential &&
    typeof param
      .exponentialRampToValueAtTime ===
      "function"
  ) {
    param.exponentialRampToValueAtTime(
      Math.max(
        MIN_EXPONENTIAL_GAIN,
        value,
      ),
      endTime,
    );

    return;
  }

  param.linearRampToValueAtTime(
    value,
    endTime,
  );
}

export class MusicCrossfader {
  private currentSource:
    AudioBufferSourceNode | null =
      null;

  private currentGainNode:
    GainNode | null =
      null;

  private currentTrackUrl:
    string | null =
      null;

  private lastDurationSeconds =
    0;

  private disposed =
    false;

  public constructor(
    private readonly mixer:
      AudioMixer,
  ) {}

  public get activeTrackUrl():
    string | null {
    return this.currentTrackUrl;
  }

  public get lastCrossfadeDurationSeconds():
    number {
    return this.lastDurationSeconds;
  }

  public async crossfade(
    newBuffer:
      AudioBuffer,
    newTrackUrl:
      string,
    options?:
      MusicCrossfadeOptions,
  ): Promise<void> {
    if (
      this.disposed
    ) {
      return;
    }

    void this.mixer
      .resumeIfSuspended();

    const ctx =
      this.mixer
        .audioContext;

    const bgmGain =
      this.mixer
        .getChannelGainNode(
          "bgm",
        );

    const duration =
      sanitizeDuration(
        options
          ?.durationSeconds,
      );

    const exponential =
      options?.fadeCurve ===
      "exponential";

    const now =
      ctx.currentTime;

    const oldSource =
      this.currentSource;

    const oldGain =
      this.currentGainNode;

    if (
      oldSource !==
        null &&
      oldGain !==
        null
    ) {
      oldGain.gain
        .cancelScheduledValues(
          now,
        );

      oldGain.gain
        .setValueAtTime(
          Math.max(
            MIN_EXPONENTIAL_GAIN,
            oldGain.gain
              .value,
          ),
          now,
        );

      rampGain(
        oldGain.gain,
        exponential
          ? MIN_EXPONENTIAL_GAIN
          : 0,
        now +
          duration,
        exponential,
      );

      oldSource.onended =
        (): void => {
          this.disconnectPair(
            oldSource,
            oldGain,
          );
        };

      try {
        oldSource.stop(
          now +
            duration,
        );
      } catch {
        this.disconnectPair(
          oldSource,
          oldGain,
        );
      }
    }

    const nextSource =
      ctx.createBufferSource();

    nextSource.buffer =
      newBuffer;

    nextSource.loop =
      options?.loop !==
      false;

    const nextGain =
      ctx.createGain();

    const initialGain =
      duration >
        0
        ? MIN_EXPONENTIAL_GAIN
        : 1;

    nextGain.gain
      .setValueAtTime(
        initialGain,
        now,
      );

    if (
      duration >
      0
    ) {
      rampGain(
        nextGain.gain,
        1,
        now +
          duration,
        exponential,
      );
    }

    nextSource.connect(
      nextGain,
    );

    nextGain.connect(
      bgmGain,
    );

    nextSource.onended =
      (): void => {
        this.disconnectPair(
          nextSource,
          nextGain,
        );

        if (
          this.currentSource ===
          nextSource
        ) {
          this.currentSource =
            null;

          this.currentGainNode =
            null;

          this.currentTrackUrl =
            null;
        }
      };

    nextSource.start(
      0,
    );

    this.currentSource =
      nextSource;

    this.currentGainNode =
      nextGain;

    this.currentTrackUrl =
      newTrackUrl;

    this.lastDurationSeconds =
      duration;
  }

  public stop(): void {
    const source =
      this.currentSource;

    const gain =
      this.currentGainNode;

    this.currentSource =
      null;

    this.currentGainNode =
      null;

    this.currentTrackUrl =
      null;

    this.lastDurationSeconds =
      0;

    if (
      source ===
        null ||
      gain ===
        null
    ) {
      return;
    }

    source.onended =
      null;

    try {
      source.stop();
    } catch {
      // Source já encerrada.
    }

    this.disconnectPair(
      source,
      gain,
    );
  }

  public dispose(): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.stop();

    this.disposed =
      true;
  }

  private disconnectPair(
    source:
      AudioBufferSourceNode,
    gain:
      GainNode,
  ): void {
    try {
      source.disconnect();
    } catch {
      // Node já desconectado.
    }

    try {
      gain.disconnect();
    } catch {
      // Node já desconectado.
    }
  }
}
