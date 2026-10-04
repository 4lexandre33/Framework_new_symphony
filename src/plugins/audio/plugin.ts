import type { Plugin, PluginContext } from "@core";
import { AudioToken } from "../../tokens/audio";
import { AssetsToken } from "../../tokens/assets";
import { AudioChannelVolumeChangedEvent, MusicCrossfadeCompletedEvent, PositionalSoundTriggeredEvent, PlaySoundCommand, PlayPositionalSoundCommand, SetChannelVolumeCommand, CrossfadeMusicCommand, type AudioChannelType, type PositionalAudioOptions, type MusicCrossfadeOptions } from "../../contracts/audio/types";
import { AudioService } from "../../engine/audio/internal/AudioService";

export const audioManifest: Plugin["manifest"] = {
  id: "game.audio",
  name: "Spatial 3D Audio & Sound Mixer Plugin",
  version: "1.0.0",
  kind: "preloaded",
  authority: "game",
  permissions: {
    capabilities: [AudioToken.id, AssetsToken.id],
    events: [
      "game.audio.channel-volume-changed",
      "game.audio.crossfade-completed",
      "game.audio.positional-sound-triggered",
    ],
  },
  capabilities: {
    provides: [
      {
        id: AudioToken.id,
        version: "1.0.0",
      },
    ],
    consumes: [
      {
        id: AssetsToken.id,
        range: "^1.0.0",
        optional: false,
      },
    ],
    conflicts: [],
  },
};

export function createAudioPlugin(): Plugin {
  return {
    manifest: audioManifest,

    setup(ctx: PluginContext) {
      const audioService = new AudioService(ctx);

      ctx.caps.provide(AudioToken, audioService);

      ctx.events.define(AudioChannelVolumeChangedEvent);
      ctx.events.define(MusicCrossfadeCompletedEvent);
      ctx.events.define(PositionalSoundTriggeredEvent);

      ctx.commands.define(PlaySoundCommand);
      ctx.commands.define(PlayPositionalSoundCommand);
      ctx.commands.define(SetChannelVolumeCommand);
      ctx.commands.define(CrossfadeMusicCommand);

      const unbindPlay = ctx.commands.handle("game.audio.play-sound", (env) => {
        const p = env.payload as { soundUrl: string; channel?: AudioChannelType; volume?: number; loop?: boolean };
        audioService.playSound(p.soundUrl, p.channel, p.volume, p.loop);
      });

      const unbindPositional = ctx.commands.handle("game.audio.play-positional-sound", (env) => {
        const p = env.payload as { soundUrl: string; options: PositionalAudioOptions };
        audioService.playPositionalSound(p.soundUrl, p.options);
      });

      const unbindVolume = ctx.commands.handle("game.audio.set-channel-volume", (env) => {
        const p = env.payload as { channel: AudioChannelType; volume: number; muted?: boolean };
        audioService.setChannelVolume(p.channel, p.volume, p.muted);
      });

      const unbindCrossfade = ctx.commands.handle("game.audio.crossfade-music", (env) => {
        const p = env.payload as { trackUrl: string; options?: MusicCrossfadeOptions };
        return audioService.crossfadeMusic(p.trackUrl, p.options);
      });

      ctx.lifecycle.onDispose(() => {
        unbindPlay();
        unbindPositional();
        unbindVolume();
        unbindCrossfade();
        audioService.dispose();
      });

      ctx.lifecycle.ready();
    },
  };
}