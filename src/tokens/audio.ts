import { defineCapability } from "@core";
import type {
  AudioChannelType,
  AudioSystemState,
  PlaySoundOptions,
  PositionalAudioOptions,
  MusicCrossfadeOptions,
  SoundHandle,
  Vector3Audio,
} from "../contracts/audio/types";

export interface AudioApi {
  /**
   * Toca um som já carregado (assets). Devolve o handle (> 0) ou 0 se não
   * tocou. One-shots pedidos com o contexto bloqueado (antes do 1º gesto)
   * só tocam se o gesto vier em até ~250 ms; loops começam ao desbloquear.
   */
  playSound(
    soundUrl: string,
    channel?: AudioChannelType,
    volume?: number,
    loop?: boolean,
    options?: PlaySoundOptions,
  ): SoundHandle;
  /** Som 3D; `options.channel` escolhe o canal (padrão "sfx"). Devolve o handle ou 0. */
  playPositionalSound(soundUrl: string, options: PositionalAudioOptions): SoundHandle;
  /** Para um som (com fade opcional). false se o handle não está ativo. */
  stopSound(handle: SoundHandle, fadeSeconds?: number): boolean;
  /** Volume (0..1) de um som ativo, com rampa opcional. */
  setSoundVolume(handle: SoundHandle, volume: number, fadeSeconds?: number): boolean;
  /** Move um som posicional ativo. */
  setSoundPosition(handle: SoundHandle, position: Vector3Audio): boolean;
  /** Aponta o cone de um som posicional ativo. */
  setSoundOrientation(handle: SoundHandle, direction: Vector3Audio): boolean;
  /** Velocidade/pitch de um som ativo. */
  setSoundPlaybackRate(handle: SoundHandle, rate: number): boolean;
  isSoundPlaying(handle: SoundHandle): boolean;
  /** Para todos os sons de um canal (não afeta a música; para ela use `stopMusic`). */
  stopChannel(channel: AudioChannelType, fadeSeconds?: number): void;
  /**
   * `muted` omitido mantém o estado de mudo atual (não desmuta).
   */
  setChannelVolume(channel: AudioChannelType, volume: number, muted?: boolean): void;
  setChannelMuted(channel: AudioChannelType, muted: boolean): void;
  getChannelVolume(channel: AudioChannelType): number;
  isChannelMuted(channel: AudioChannelType): boolean;
  /**
   * Troca a música com crossfade. Resolve quando o fade TERMINA (junto com
   * `game.audio.crossfade-completed`). Pedir a faixa que já toca é no-op
   * (use `options.restart`). A faixa fica retida no cache enquanto toca.
   */
  crossfadeMusic(trackUrl: string, options?: MusicCrossfadeOptions): Promise<void>;
  /** Para só a música (fade opcional). Resolve ao terminar. */
  stopMusic(fadeSeconds?: number): Promise<void>;
  /** URL normalizada da música atual, ou null. */
  getCurrentMusicTrack(): string | null;
  updateListenerPosition(position: Vector3Audio, forward?: Vector3Audio, up?: Vector3Audio): void;
  /** Para sons e música; `fadeSeconds` > 0 faz fade-out em vez de corte seco. */
  stopAllSounds(fadeSeconds?: number): void;
  /** Estado do contexto Web Audio ("unavailable" sem Web Audio). */
  readonly state: AudioSystemState;
  /** Tenta desbloquear o áudio (chame dentro de um gesto do usuário). */
  resume(): Promise<boolean>;
  /** Vozes ativas (sem a música). */
  readonly activeVoiceCount: number;
  /** Limite de vozes simultâneas (rouba o one-shot mais antigo). Padrão 32. */
  setVoiceLimit(maxVoices: number, maxHrtfVoices?: number): void;
}

export const AudioToken = defineCapability<AudioApi>("game.audio", "1.0.0");