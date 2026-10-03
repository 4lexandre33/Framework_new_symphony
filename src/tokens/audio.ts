import { defineCapability } from "../core/contracts/capability-token";
import type {
  AudioChannelType,
  PositionalAudioOptions,
  MusicCrossfadeOptions,
  Vector3Audio,
} from "../contracts/audio/types";

export interface AudioApi {
  playSound(soundUrl: string, channel?: AudioChannelType, volume?: number, loop?: boolean): void;
  playPositionalSound(soundUrl: string, options: PositionalAudioOptions): void;
  setChannelVolume(channel: AudioChannelType, volume: number, muted?: boolean): void;
  getChannelVolume(channel: AudioChannelType): number;
  isChannelMuted(channel: AudioChannelType): boolean;
  crossfadeMusic(trackUrl: string, options?: MusicCrossfadeOptions): Promise<void>;
  updateListenerPosition(position: Vector3Audio, forward?: Vector3Audio, up?: Vector3Audio): void;
  stopAllSounds(): void;
}

export const AudioToken = defineCapability<AudioApi>("game.audio", "1.0.0");