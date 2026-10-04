import { defineEvent, defineCommand } from "@core";

export type AudioChannelType = "master" | "bgm" | "sfx" | "voice" | "ui";

export type DistanceModelType = "linear" | "inverse" | "exponential";

export interface Vector3Audio {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface PositionalAudioOptions {
  readonly position: Vector3Audio;
  readonly refDistance?: number;
  readonly maxDistance?: number;
  readonly rolloffFactor?: number;
  readonly distanceModel?: DistanceModelType;
  readonly coneInnerAngle?: number;
  readonly coneOuterAngle?: number;
  readonly coneOuterGain?: number;
  readonly loop?: boolean;
  readonly volume?: number;
}

export interface MusicCrossfadeOptions {
  readonly durationSeconds: number;
  readonly loop?: boolean;
  readonly fadeCurve?: "linear" | "exponential";
}

// ── EVENTOS DE ÁUDIO ────────────────────────────────────────────────────────

export interface AudioChannelVolumeChangedPayload {
  readonly channel: AudioChannelType;
  readonly volume: number;
  readonly muted: boolean;
}

export const AudioChannelVolumeChangedEvent = defineEvent<
  "game.audio.channel-volume-changed",
  AudioChannelVolumeChangedPayload
>("game.audio.channel-volume-changed");

export interface MusicCrossfadeCompletedPayload {
  readonly trackUrl: string;
  readonly durationSeconds: number;
}

export const MusicCrossfadeCompletedEvent = defineEvent<
  "game.audio.crossfade-completed",
  MusicCrossfadeCompletedPayload
>("game.audio.crossfade-completed");

export interface PositionalSoundTriggeredPayload {
  readonly soundUrl: string;
  readonly position: Vector3Audio;
}

export const PositionalSoundTriggeredEvent = defineEvent<
  "game.audio.positional-sound-triggered",
  PositionalSoundTriggeredPayload
>("game.audio.positional-sound-triggered");

// ── COMANDOS DE ÁUDIO ───────────────────────────────────────────────────────

export interface PlaySoundRequest {
  readonly soundUrl: string;
  readonly channel?: AudioChannelType;
  readonly volume?: number;
  readonly loop?: boolean;
}

export const PlaySoundCommand = defineCommand<
  "game.audio.play-sound",
  PlaySoundRequest
>("game.audio.play-sound");

export interface PlayPositionalSoundRequest {
  readonly soundUrl: string;
  readonly options: PositionalAudioOptions;
}

export const PlayPositionalSoundCommand = defineCommand<
  "game.audio.play-positional-sound",
  PlayPositionalSoundRequest
>("game.audio.play-positional-sound");

export interface SetChannelVolumeRequest {
  readonly channel: AudioChannelType;
  readonly volume: number;
  readonly muted?: boolean;
}

export const SetChannelVolumeCommand = defineCommand<
  "game.audio.set-channel-volume",
  SetChannelVolumeRequest
>("game.audio.set-channel-volume");

export interface CrossfadeMusicRequest {
  readonly trackUrl: string;
  readonly options?: MusicCrossfadeOptions;
}

export const CrossfadeMusicCommand = defineCommand<
  "game.audio.crossfade-music",
  CrossfadeMusicRequest
>("game.audio.crossfade-music");