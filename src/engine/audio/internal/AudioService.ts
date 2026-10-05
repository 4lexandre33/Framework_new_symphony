import type {
  PluginContext,
} from "@core";

import type {
  AudioApi,
} from "../../../tokens/audio";

import {
  AssetsToken,
} from "../../../tokens/assets";

import type {
  AssetsApi,
} from "../../../tokens/assets";

import type {
  AudioChannelType,
  MusicCrossfadeOptions,
  PositionalAudioOptions,
  Vector3Audio,
} from "../../../contracts/audio/types";

import {
  AudioListenerBridge,
} from "./AudioListenerBridge";

import {
  AudioMixer,
} from "./AudioMixer";

import {
  AudioVoiceRegistry,
} from "./AudioVoiceRegistry";

import {
  MusicCrossfader,
} from "./MusicCrossfader";

import {
  PositionalAudio3D,
} from "./PositionalAudio3D";

function clampVolume(
  value:
    number,
): number {
  if (
    !Number.isFinite(
      value,
    )
  ) {
    return 0;
  }

  return Math.min(
    1,
    Math.max(
      0,
      value,
    ),
  );
}

function normalizeUrl(
  value:
    string,
): string {
  return value.trim();
}

export class AudioService
  implements AudioApi {
  private readonly mixer:
    AudioMixer;

  private readonly positional:
    PositionalAudio3D;

  private readonly crossfader:
    MusicCrossfader;

  private readonly listenerBridge:
    AudioListenerBridge;

  private readonly voices =
    new AudioVoiceRegistry();

  private musicRequestGeneration =
    0;

  private disposed =
    false;

  public constructor(
    private readonly ctx:
      PluginContext,
    mixer?:
      AudioMixer,
  ) {
    this.mixer =
      mixer ??
      new AudioMixer();

    this.positional =
      new PositionalAudio3D(
        this.mixer,
      );

    this.crossfader =
      new MusicCrossfader(
        this.mixer,
      );

    this.listenerBridge =
      new AudioListenerBridge(
        this.mixer,
      );
  }

  public playSound(
    soundUrl:
      string,
    channel:
      AudioChannelType =
        "sfx",
    volume =
      1,
    loop =
      false,
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    const normalizedUrl =
      normalizeUrl(
        soundUrl,
      );

    if (
      normalizedUrl.length ===
      0
    ) {
      return;
    }

    const assets =
      this.getAssets();

    const buffer =
      assets?.getAsset<
        AudioBuffer
      >(
        normalizedUrl,
      );

    if (
      buffer ===
      null ||
      buffer ===
      undefined
    ) {
      console.warn(
        `[AudioService] Áudio não encontrado no cache de assets: ${normalizedUrl}`,
      );

      return;
    }

    void this.mixer
      .resumeIfSuspended();

    const audioContext =
      this.mixer
        .audioContext;

    const source =
      audioContext
        .createBufferSource();

    source.buffer =
      buffer;

    source.loop =
      loop;

    const voiceGain =
      audioContext
        .createGain();

    voiceGain.gain
      .setValueAtTime(
        clampVolume(
          volume,
        ),
        audioContext
          .currentTime,
      );

    source.connect(
      voiceGain,
    );

    voiceGain.connect(
      this.mixer
        .getChannelGainNode(
          channel,
        ),
    );

    if (
      !this.voices.register({
        source,
        gainNode:
          voiceGain,
      })
    ) {
      return;
    }

    try {
      source.start(
        0,
      );
    } catch {
      this.voices.release(
        source,
      );
    }
  }

  public playPositionalSound(
    soundUrl:
      string,
    options:
      PositionalAudioOptions,
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    const normalizedUrl =
      normalizeUrl(
        soundUrl,
      );

    const assets =
      this.getAssets();

    const buffer =
      assets?.getAsset<
        AudioBuffer
      >(
        normalizedUrl,
      );

    if (
      buffer ===
        null ||
      buffer ===
        undefined
    ) {
      console.warn(
        `[AudioService] Áudio posicional não encontrado no cache: ${normalizedUrl}`,
      );

      return;
    }

    const handle =
      this.positional.play(
        buffer,
        options,
      );

    if (
      !this.voices.register(
        handle,
      )
    ) {
      return;
    }

    this.ctx.events.emit(
      "game.audio.positional-sound-triggered",
      {
        soundUrl:
          normalizedUrl,

        position: {
          x:
            options.position.x,
          y:
            options.position.y,
          z:
            options.position.z,
        },
      },
    );
  }

  public setChannelVolume(
    channel:
      AudioChannelType,
    volume:
      number,
    muted =
      false,
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.mixer
      .setChannelVolume(
        channel,
        volume,
        muted,
      );

    this.ctx.events.emit(
      "game.audio.channel-volume-changed",
      {
        channel,

        volume:
          this.mixer
            .getChannelVolume(
              channel,
            ),

        muted:
          this.mixer
            .isChannelMuted(
              channel,
            ),
      },
    );
  }

  public getChannelVolume(
    channel:
      AudioChannelType,
  ): number {
    return this.mixer
      .getChannelVolume(
        channel,
      );
  }

  public isChannelMuted(
    channel:
      AudioChannelType,
  ): boolean {
    return this.mixer
      .isChannelMuted(
        channel,
      );
  }

  public async crossfadeMusic(
    trackUrl:
      string,
    options?:
      MusicCrossfadeOptions,
  ): Promise<void> {
    if (
      this.disposed
    ) {
      return;
    }

    const normalizedUrl =
      normalizeUrl(
        trackUrl,
      );

    if (
      normalizedUrl.length ===
      0
    ) {
      return;
    }

    const requestGeneration =
      this.musicRequestGeneration +
      1;

    this.musicRequestGeneration =
      requestGeneration;

    const assets =
      this.getAssets();

    let buffer =
      assets?.getAsset<
        AudioBuffer
      >(
        normalizedUrl,
      );

    let retainedByLoad =
      false;

    if (
      (
        buffer ===
          null ||
        buffer ===
          undefined
      ) &&
      assets !==
        null
    ) {
      try {
        buffer =
          await assets
            .loadAudio(
              normalizedUrl,
            );

        retainedByLoad =
          true;
      } catch (
        error:
          unknown
      ) {
        if (
          !this.disposed &&
          requestGeneration ===
            this.musicRequestGeneration
        ) {
          console.error(
            `[AudioService] Erro ao carregar música para crossfade: ${normalizedUrl}`,
            error,
          );
        }

        return;
      }
    }

    if (
      this.disposed ||
      requestGeneration !==
        this.musicRequestGeneration ||
      buffer ===
        null ||
      buffer ===
        undefined
    ) {
      if (
        retainedByLoad
      ) {
        assets?.releaseAsset(
          normalizedUrl,
        );
      }

      return;
    }

    await this.crossfader
      .crossfade(
        buffer,
        normalizedUrl,
        options,
      );

    if (
      retainedByLoad
    ) {
      assets?.releaseAsset(
        normalizedUrl,
      );
    }

    if (
      this.disposed ||
      requestGeneration !==
        this.musicRequestGeneration
    ) {
      return;
    }

    this.ctx.events.emit(
      "game.audio.crossfade-completed",
      {
        trackUrl:
          normalizedUrl,

        durationSeconds:
          this.crossfader
            .lastCrossfadeDurationSeconds,
      },
    );
  }

  public updateListenerPosition(
    position:
      Vector3Audio,
    forward?:
      Vector3Audio,
    up?:
      Vector3Audio,
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.listenerBridge
      .updateListenerPosition(
        position,
        forward,
        up,
      );
  }

  public stopAllSounds(): void {
    this.musicRequestGeneration +=
      1;

    this.voices
      .stopAll();

    this.crossfader
      .stop();
  }

  public get activeVoiceCount():
    number {
    return this.voices
      .activeVoiceCount;
  }

  public dispose(): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.disposed =
      true;

    this.musicRequestGeneration +=
      1;

    this.voices
      .dispose();

    this.crossfader
      .dispose();

    this.mixer
      .dispose();
  }

  private getAssets():
    AssetsApi | null {
    return (
      this.ctx.caps.get(
        AssetsToken,
      ) ??
      null
    );
  }
}
