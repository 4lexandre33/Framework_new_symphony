import { defineEvent, defineCommand } from "@core";

export type AudioChannelType = "master" | "bgm" | "sfx" | "voice" | "ui";

export type DistanceModelType = "linear" | "inverse" | "exponential";

export interface Vector3Audio {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Handle de um som tocando (inteiro > 0). 0 = o som não foi tocado (asset
 * ausente, Web Audio indisponível, limite de vozes ou contexto ainda
 * bloqueado pela política de autoplay para one-shots).
 */
export type SoundHandle = number;

/** Estado do sistema de áudio: "unavailable" = sem Web Audio (a engine segue muda). */
export type AudioSystemState = "running" | "suspended" | "closed" | "interrupted" | "unavailable";

export interface PlaySoundOptions {
  /** Velocidade/pitch (1 = normal). */
  readonly playbackRate?: number;
  /** Fade-in em segundos. */
  readonly fadeInSeconds?: number;
}

export interface PositionalAudioOptions {
  readonly position: Vector3Audio;
  /** Canal do mixer (padrão "sfx"). */
  readonly channel?: AudioChannelType;
  /** Direção para onde o cone aponta (padrão Web Audio: +X). */
  readonly orientation?: Vector3Audio;
  /**
   * Modelo de panning. Padrão "HRTF"; acima do limite de vozes HRTF a
   * engine usa "equalpower" automaticamente.
   */
  readonly panningModel?: "HRTF" | "equalpower";
  readonly playbackRate?: number;
  readonly refDistance?: number;
  /**
   * Distância máxima. Em "linear" é o ponto de silêncio (Web Audio). Em
   * "inverse"/"exponential", com `maxDistanceMode: "silence"` (padrão quando
   * `maxDistance` é informado) o som some suavemente nos últimos 10% até
   * `maxDistance`; com "clamp" a atenuação apenas para de crescer.
   */
  readonly maxDistance?: number;
  readonly maxDistanceMode?: "silence" | "clamp";
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
  /** Reinicia mesmo se a faixa pedida já estiver tocando (padrão false: no-op). */
  readonly restart?: boolean;
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

/** Emitido quando o fade TERMINA (não no início). */
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
  readonly handle?: SoundHandle;
  readonly channel?: AudioChannelType;
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
export interface StopMusicRequest {
  readonly fadeSeconds?: number;
}

export const StopMusicCommand = defineCommand<
  "game.audio.stop-music",
  StopMusicRequest
>("game.audio.stop-music");

export interface MusicStoppedPayload {
  /** Faixa que parou (null se não havia música). */
  readonly trackUrl: string | null;
}

/** Emitido quando `stopMusic` conclui (após o fade). */
export const MusicStoppedEvent = defineEvent<
  "game.audio.music-stopped",
  MusicStoppedPayload
>("game.audio.music-stopped");
