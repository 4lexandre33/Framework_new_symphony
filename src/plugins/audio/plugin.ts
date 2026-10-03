import type { Plugin, PluginContext } from "../../core/contracts/plugin-context";
import { AudioToken, type AudioApi } from "../../tokens/audio";
import { AssetsToken, type AssetsApi } from "../../tokens/assets";
import {
  AudioChannelVolumeChangedEvent,
  MusicCrossfadeCompletedEvent,
  PositionalSoundTriggeredEvent,
  PlaySoundCommand,
  PlayPositionalSoundCommand,
  SetChannelVolumeCommand,
  CrossfadeMusicCommand,
  type AudioChannelType,
  type PositionalAudioOptions,
  type MusicCrossfadeOptions,
  type Vector3Audio,
} from "../../contracts/audio/types";
import { AudioMixer } from "../../engine/audio/AudioMixer";
import { PositionalAudio3D } from "../../engine/audio/PositionalAudio3D";
import { MusicCrossfader } from "../../engine/audio/MusicCrossfader";
import { AudioListenerBridge } from "../../engine/audio/AudioListenerBridge";

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
      },
    ],
  },
};

export class AudioService implements AudioApi {
  private readonly mixer = new AudioMixer();
  private readonly positional = new PositionalAudio3D(this.mixer);
  private readonly crossfader = new MusicCrossfader(this.mixer);
  private readonly listenerBridge = new AudioListenerBridge(this.mixer);

  public constructor(private readonly ctx: PluginContext) {}

  public playSound(
    soundUrl: string,
    channel: AudioChannelType = "sfx",
    volume = 1.0,
    loop = false
  ): void {
    const assets = this.ctx.caps.get(AssetsToken) as AssetsApi | null;
    const buffer = assets?.getAsset<AudioBuffer>(soundUrl);

    if (!buffer) {
      console.warn(`[AudioService] Áudio não encontrado no cache de assets: ${soundUrl}`);
      return;
    }

    this.mixer.resumeIfSuspended();
    const ctx = this.mixer.audioContext;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;

    const voiceGain = ctx.createGain();
    voiceGain.gain.setValueAtTime(Math.max(0, Math.min(1, volume)), ctx.currentTime);

    const channelGain = this.mixer.getChannelGainNode(channel);

    source.connect(voiceGain);
    voiceGain.connect(channelGain);

    source.start(0);

    source.onended = () => {
      source.disconnect();
      voiceGain.disconnect();
    };
  }

  public playPositionalSound(soundUrl: string, options: PositionalAudioOptions): void {
    const assets = this.ctx.caps.get(AssetsToken) as AssetsApi | null;
    const buffer = assets?.getAsset<AudioBuffer>(soundUrl);

    if (!buffer) {
      console.warn(`[AudioService] Áudio posicional não encontrado no cache: ${soundUrl}`);
      return;
    }

    this.positional.play(buffer, options);

    this.ctx.events.emit("game.audio.positional-sound-triggered", {
      soundUrl,
      position: options.position,
    });
  }

  public setChannelVolume(channel: AudioChannelType, volume: number, muted = false): void {
    this.mixer.setChannelVolume(channel, volume, muted);
    this.ctx.events.emit("game.audio.channel-volume-changed", {
      channel,
      volume,
      muted,
    });
  }

  public getChannelVolume(channel: AudioChannelType): number {
    return this.mixer.getChannelVolume(channel);
  }

  public isChannelMuted(channel: AudioChannelType): boolean {
    return this.mixer.isChannelMuted(channel);
  }

  public async crossfadeMusic(trackUrl: string, options?: MusicCrossfadeOptions): Promise<void> {
    const assets = this.ctx.caps.get(AssetsToken) as AssetsApi | null;
    let buffer = assets?.getAsset<AudioBuffer>(trackUrl);

    if (!buffer && assets) {
      try {
        buffer = await assets.loadAudio(trackUrl);
      } catch (err) {
        console.error(`[AudioService] Erro ao carregar música para crossfade: ${trackUrl}`, err);
        return;
      }
    }

    if (!buffer) return;

    await this.crossfader.crossfade(buffer, trackUrl, options);

    this.ctx.events.emit("game.audio.crossfade-completed", {
      trackUrl,
      durationSeconds: options?.durationSeconds ?? 1.5,
    });
  }

  public updateListenerPosition(
    position: Vector3Audio,
    forward?: Vector3Audio,
    up?: Vector3Audio
  ): void {
    this.listenerBridge.updateListenerPosition(position, forward, up);
  }

  public stopAllSounds(): void {
    this.crossfader.stop();
  }

  public dispose(): void {
    this.crossfader.stop();
    this.mixer.dispose();
  }
}

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