import type {
  Plugin,
  PluginContext,
} from "@core";

import {
  AudioToken,
} from "../../tokens/audio";

import {
  AssetsToken,
} from "../../tokens/assets";

import {
  AudioChannelVolumeChangedEvent,
  CrossfadeMusicCommand,
  MusicCrossfadeCompletedEvent,
  PlayPositionalSoundCommand,
  PlaySoundCommand,
  PositionalSoundTriggeredEvent,
  SetChannelVolumeCommand,
  StopMusicCommand,
  MusicStoppedEvent,
} from "../../contracts/audio/types";

import type {
  CrossfadeMusicRequest,
  PlayPositionalSoundRequest,
  PlaySoundRequest,
  SetChannelVolumeRequest,
  StopMusicRequest,
} from "../../contracts/audio/types";

import {
  AudioService,
} from "../../engine/audio/internal/AudioService";

import {
  AudioMixer,
} from "../../engine/audio/internal/AudioMixer";

export interface AudioPluginOptions {
  /** Contexto Web Audio injetado (testes/host). `null` força o modo mudo. */
  readonly audioContext?: AudioContext | null;
  /** Vozes simultâneas (padrão 32); acima disso o one-shot mais antigo é roubado. */
  readonly maxVoices?: number;
  /** Vozes HRTF simultâneas (padrão 16); acima disso usa "equalpower". */
  readonly maxHrtfVoices?: number;
}

export const audioManifest:
  Plugin["manifest"] = {
    id:
      "game.audio",

    name:
      "Spatial 3D Audio & Sound Mixer Plugin",

    version:
      "1.0.0",

    kind:
      "preloaded",

    authority:
      "game",

    permissions: {
      capabilities: [
        AudioToken.id,
        AssetsToken.id,
      ],

      events: [
        AudioChannelVolumeChangedEvent.type,
        MusicCrossfadeCompletedEvent.type,
        PositionalSoundTriggeredEvent.type,
        MusicStoppedEvent.type,
      ],
    },

    capabilities: {
      provides: [
        {
          id:
            AudioToken.id,
          version:
            "1.0.0",
        },
      ],

      consumes: [
        {
          id:
            AssetsToken.id,
          range:
            "^1.0.0",
          optional:
            false,
        },
      ],

      conflicts:
        [],
    },
  };

export function createAudioPlugin(
  options:
    AudioPluginOptions =
      {},
):
  Plugin {
  return {
    manifest:
      audioManifest,

    setup(
      ctx:
        PluginContext,
    ): void {
      // Sem Web Audio (node/jsdom/WebView restrito) o mixer entra em modo
      // "unavailable" e o plugin sobe normalmente, mudo (G86).
      const audioService =
        new AudioService(
          ctx,
          new AudioMixer(
            options.audioContext,
          ),
          {
            maxVoices:
              options.maxVoices,
            maxHrtfVoices:
              options.maxHrtfVoices,
          },
        );

      ctx.caps.provide(
        AudioToken,
        audioService,
      );

      ctx.events.define(
        AudioChannelVolumeChangedEvent,
      );

      ctx.events.define(
        MusicCrossfadeCompletedEvent,
      );

      ctx.events.define(
        PositionalSoundTriggeredEvent,
      );

      ctx.events.define(
        MusicStoppedEvent,
      );

      ctx.commands.define(
        StopMusicCommand,
      );

      ctx.commands.define(
        PlaySoundCommand,
      );

      ctx.commands.define(
        PlayPositionalSoundCommand,
      );

      ctx.commands.define(
        SetChannelVolumeCommand,
      );

      ctx.commands.define(
        CrossfadeMusicCommand,
      );

      const unbindPlay =
        ctx.commands.handle(
          PlaySoundCommand.type,
          (
            envelope,
          ): void => {
            const payload =
              envelope.payload as
                PlaySoundRequest;

            audioService.playSound(
              payload.soundUrl,
              payload.channel,
              payload.volume,
              payload.loop,
            );
          },
        );

      const unbindPositional =
        ctx.commands.handle(
          PlayPositionalSoundCommand.type,
          (
            envelope,
          ): void => {
            const payload =
              envelope.payload as
                PlayPositionalSoundRequest;

            audioService
              .playPositionalSound(
                payload.soundUrl,
                payload.options,
              );
          },
        );

      const unbindVolume =
        ctx.commands.handle(
          SetChannelVolumeCommand.type,
          (
            envelope,
          ): void => {
            const payload =
              envelope.payload as
                SetChannelVolumeRequest;

            audioService
              .setChannelVolume(
                payload.channel,
                payload.volume,
                payload.muted,
              );
          },
        );

      const unbindCrossfade =
        ctx.commands.handle(
          CrossfadeMusicCommand.type,
          (
            envelope,
          ): Promise<void> => {
            const payload =
              envelope.payload as
                CrossfadeMusicRequest;

            return audioService
              .crossfadeMusic(
                payload.trackUrl,
                payload.options,
              );
          },
        );

      const unbindStopMusic =
        ctx.commands.handle(
          StopMusicCommand.type,
          (
            envelope,
          ): Promise<void> => {
            const payload =
              envelope.payload as
                StopMusicRequest |
                undefined;

            return audioService.stopMusic(
              payload?.fadeSeconds,
            );
          },
        );

      ctx.lifecycle.onDispose(
        (): void => {
          unbindStopMusic();
          unbindPlay();
          unbindPositional();
          unbindVolume();
          unbindCrossfade();

          audioService.dispose();
        },
      );

      ctx.lifecycle.ready();
    },
  };
}
