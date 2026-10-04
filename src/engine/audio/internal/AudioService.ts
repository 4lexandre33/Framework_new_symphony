import type { PluginContext } from "@core";
import { type AudioApi } from "../../../tokens/audio";
import { AssetsToken, type AssetsApi } from "../../../tokens/assets";
import { type AudioChannelType, type PositionalAudioOptions, type MusicCrossfadeOptions, type Vector3Audio } from "../../../contracts/audio/types";
import { AudioMixer } from "./AudioMixer";
import { PositionalAudio3D } from "./PositionalAudio3D";
import { MusicCrossfader } from "./MusicCrossfader";
import { AudioListenerBridge } from "./AudioListenerBridge";

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
