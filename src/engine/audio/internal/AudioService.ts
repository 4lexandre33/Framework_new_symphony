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
  AudioSystemState,
  MusicCrossfadeOptions,
  PlaySoundOptions,
  PositionalAudioOptions,
  SoundHandle,
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

import type {
  AudioVoiceHandle,
  AudioVoiceRecord,
} from "./AudioVoiceRegistry";

import {
  MusicCrossfader,
} from "./MusicCrossfader";

import {
  PositionalAudio3D,
} from "./PositionalAudio3D";

/** One-shots pedidos com o contexto suspenso só tocam se o gesto vier nessa janela. */
const DEFERRED_ONE_SHOT_WINDOW_MS = 250;
const DEFAULT_MAX_VOICES = 32;
const DEFAULT_MAX_HRTF_VOICES = 16;
const VOLUME_RAMP_SECONDS = 0.02;
const RANGE_FADE_FRACTION = 0.1;

export interface AudioServiceOptions {
  readonly maxVoices?: number;
  readonly maxHrtfVoices?: number;
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function normalizeUrl(value: string): string {
  return typeof value === "string" ? value.trim() : "";
}

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function sanitizeFade(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.min(value, 60) : 0;
}

function sanitizeLimit(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;
}

export class AudioService implements AudioApi {
  private readonly mixer: AudioMixer;
  private readonly positional: PositionalAudio3D;
  private readonly crossfader: MusicCrossfader;
  private readonly listenerBridge: AudioListenerBridge;
  private readonly voices = new AudioVoiceRegistry();
  /** URL → quantas faixas de música a retêm no cache de assets. */
  private readonly musicRetains = new Map<string, number>();
  private readonly listener = { x: 0, y: 0, z: 0 };
  private maxVoices = DEFAULT_MAX_VOICES;
  private maxHrtfVoices = DEFAULT_MAX_HRTF_VOICES;
  private musicRequestGeneration = 0;
  private warnedUnavailable = false;
  private disposed = false;

  public constructor(
    private readonly ctx: PluginContext,
    mixer?: AudioMixer,
    options?: AudioServiceOptions,
  ) {
    this.mixer = mixer ?? new AudioMixer();
    this.positional = new PositionalAudio3D(this.mixer);
    this.crossfader = new MusicCrossfader(this.mixer);
    this.listenerBridge = new AudioListenerBridge(this.mixer);
    this.maxVoices = sanitizeLimit(options?.maxVoices, DEFAULT_MAX_VOICES);
    this.maxHrtfVoices = sanitizeLimit(options?.maxHrtfVoices, DEFAULT_MAX_HRTF_VOICES);

    this.crossfader.setTrackEndedListener((url: string): void => {
      this.releaseMusicRetain(url);
    });

    this.mixer.setBeforeResumeHook((): void => {
      this.pruneStaleDeferredVoices();
    });

    this.mixer.setRunningHook((): void => {
      this.pruneStaleDeferredVoices();

      for (const voice of this.voices.values()) {
        voice.deferred = false;
      }
    });
  }

  public get state(): AudioSystemState {
    return this.mixer.state;
  }

  public async resume(): Promise<boolean> {
    if (this.disposed || !this.mixer.isAvailable) {
      return false;
    }

    this.pruneStaleDeferredVoices();
    await this.mixer.resumeIfSuspended();
    return this.mixer.state === "running";
  }

  public playSound(
    soundUrl: string,
    channel: AudioChannelType = "sfx",
    volume = 1,
    loop = false,
    options?: PlaySoundOptions,
  ): SoundHandle {
    if (this.disposed || !this.ensureAvailable()) {
      return 0;
    }

    const normalizedUrl = normalizeUrl(soundUrl);

    if (normalizedUrl.length === 0) {
      return 0;
    }

    const buffer = this.getAssets()?.getAsset<AudioBuffer>(normalizedUrl);

    if (buffer === null || buffer === undefined) {
      console.warn(`[AudioService] Áudio não encontrado no cache de assets: ${normalizedUrl}`);
      return 0;
    }

    if (!this.makeRoomForVoice(loop)) {
      return 0;
    }

    // Sem resume() aqui: fora de um gesto ele não desbloqueia e, se
    // desbloqueasse depois, tocaria tudo junto. O desbloqueio vem do
    // listener de gesto do mixer ou de resume() explícito (G86).
    const audioContext = this.mixer.audioContext;
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;

    if (options?.playbackRate !== undefined && source.playbackRate !== undefined) {
      source.playbackRate.value = Math.max(0.01, Number.isFinite(options.playbackRate) ? options.playbackRate : 1);
    }

    const targetVolume = clampVolume(volume);
    const fadeIn = sanitizeFade(options?.fadeInSeconds);
    const voiceGain = audioContext.createGain();
    voiceGain.gain.setValueAtTime(fadeIn > 0 ? 0 : targetVolume, audioContext.currentTime);

    if (fadeIn > 0) {
      voiceGain.gain.linearRampToValueAtTime(targetVolume, audioContext.currentTime + fadeIn);
    }

    source.connect(voiceGain);
    voiceGain.connect(this.mixer.getChannelGainNode(channel));

    const id = this.voices.add(
      { source, gainNode: voiceGain },
      {
        channel,
        loop,
        volume: targetVolume,
        deferred: this.mixer.state !== "running",
        requestedAtMs: nowMs(),
      },
    );

    if (id === 0) {
      return 0;
    }

    try {
      source.start(0);
    } catch {
      this.voices.release(id);
      return 0;
    }

    return id;
  }

  public playPositionalSound(soundUrl: string, options: PositionalAudioOptions): SoundHandle {
    if (this.disposed || !this.ensureAvailable()) {
      return 0;
    }

    const normalizedUrl = normalizeUrl(soundUrl);
    const buffer = this.getAssets()?.getAsset<AudioBuffer>(normalizedUrl);

    if (buffer === null || buffer === undefined) {
      console.warn(`[AudioService] Áudio posicional não encontrado no cache: ${normalizedUrl}`);
      return 0;
    }

    const loop = options.loop ?? false;

    if (!this.makeRoomForVoice(loop)) {
      return 0;
    }

    const wantsHrtf = (options.panningModel ?? "HRTF") === "HRTF";
    const hrtf = wantsHrtf && this.voices.countHrtf() < this.maxHrtfVoices;
    const volume = clampVolume(options.volume ?? 1);
    const distanceModel = options.distanceModel ?? "inverse";
    const rangeCutoff =
      options.maxDistance !== undefined &&
      Number.isFinite(options.maxDistance) &&
      options.maxDistance > 0 &&
      distanceModel !== "linear" &&
      (options.maxDistanceMode ?? "silence") === "silence";
    const maxDistance = rangeCutoff ? (options.maxDistance as number) : 0;
    const rangeFactor = rangeCutoff
      ? this.computeRangeFactor(options.position.x, options.position.y, options.position.z, maxDistance)
      : 1;

    let handle: AudioVoiceHandle;

    try {
      handle = this.positional.play(buffer, options, {
        panningModel: hrtf ? "HRTF" : "equalpower",
        initialGain: volume * rangeFactor,
      });
    } catch (error: unknown) {
      console.warn("[AudioService] Falha ao tocar som posicional:", error);
      return 0;
    }

    const id = this.voices.add(handle, {
      channel: options.channel ?? "sfx",
      loop,
      volume,
      hrtf,
      deferred: this.mixer.state !== "running",
      requestedAtMs: nowMs(),
    });

    if (id === 0) {
      return 0;
    }

    const voice = this.voices.get(id);

    if (voice !== undefined) {
      voice.px = finite(options.position.x);
      voice.py = finite(options.position.y);
      voice.pz = finite(options.position.z);
      voice.rangeCutoff = rangeCutoff;
      voice.maxDistance = maxDistance;
      voice.rangeFactor = rangeFactor;
    }

    this.ctx.events.emit("game.audio.positional-sound-triggered", {
      soundUrl: normalizedUrl,
      handle: id,
      channel: options.channel ?? "sfx",
      position: {
        x: options.position.x,
        y: options.position.y,
        z: options.position.z,
      },
    });

    return id;
  }

  public stopSound(handle: SoundHandle, fadeSeconds?: number): boolean {
    if (this.disposed) {
      return false;
    }

    const voice = this.voices.get(handle);

    if (voice === undefined) {
      return false;
    }

    const fade = sanitizeFade(fadeSeconds);

    if (fade === 0 || !this.mixer.isAvailable) {
      return this.voices.stopNow(handle);
    }

    if (voice.stopping) {
      return true;
    }

    voice.stopping = true;
    const ctx = this.mixer.audioContext;
    const now = ctx.currentTime;
    const gain = voice.gainNode.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + fade);

    try {
      voice.source.stop(now + fade);
    } catch {
      return this.voices.stopNow(handle);
    }

    return true;
  }

  public setSoundVolume(handle: SoundHandle, volume: number, fadeSeconds?: number): boolean {
    const voice = this.voices.get(handle);

    if (this.disposed || voice === undefined || voice.stopping) {
      return false;
    }

    voice.volume = clampVolume(volume);
    this.applyVoiceGain(voice, sanitizeFade(fadeSeconds));
    return true;
  }

  public setSoundPosition(handle: SoundHandle, position: Vector3Audio): boolean {
    const voice = this.voices.get(handle);

    if (this.disposed || voice === undefined || voice.pannerNode === undefined) {
      return false;
    }

    this.positional.setPosition(voice.pannerNode, position);
    voice.px = finite(position.x);
    voice.py = finite(position.y);
    voice.pz = finite(position.z);
    this.updateRange(voice);
    return true;
  }

  public setSoundOrientation(handle: SoundHandle, direction: Vector3Audio): boolean {
    const voice = this.voices.get(handle);

    if (this.disposed || voice === undefined || voice.pannerNode === undefined) {
      return false;
    }

    this.positional.setOrientation(voice.pannerNode, direction);
    return true;
  }

  public setSoundPlaybackRate(handle: SoundHandle, rate: number): boolean {
    const voice = this.voices.get(handle);

    if (this.disposed || voice === undefined || voice.source.playbackRate === undefined) {
      return false;
    }

    voice.source.playbackRate.value = Math.max(0.01, Number.isFinite(rate) ? rate : 1);
    return true;
  }

  public isSoundPlaying(handle: SoundHandle): boolean {
    const voice = this.voices.get(handle);
    return voice !== undefined && !voice.stopping;
  }

  public stopChannel(channel: AudioChannelType, fadeSeconds?: number): void {
    for (const voice of this.voices.values()) {
      if (channel === "master" || voice.channel === channel) {
        this.stopSound(voice.id, fadeSeconds);
      }
    }
  }

  public setChannelVolume(channel: AudioChannelType, volume: number, muted?: boolean): void {
    if (this.disposed) {
      return;
    }

    this.mixer.setChannelVolume(channel, volume, muted);
    this.emitChannelChanged(channel);
  }

  public setChannelMuted(channel: AudioChannelType, muted: boolean): void {
    if (this.disposed) {
      return;
    }

    this.mixer.setChannelMuted(channel, muted);
    this.emitChannelChanged(channel);
  }

  public getChannelVolume(channel: AudioChannelType): number {
    return this.mixer.getChannelVolume(channel);
  }

  public isChannelMuted(channel: AudioChannelType): boolean {
    return this.mixer.isChannelMuted(channel);
  }

  public async crossfadeMusic(trackUrl: string, options?: MusicCrossfadeOptions): Promise<void> {
    if (this.disposed || !this.ensureAvailable()) {
      return;
    }

    const normalizedUrl = normalizeUrl(trackUrl);

    if (normalizedUrl.length === 0) {
      return;
    }

    if (
      options?.restart !== true &&
      this.crossfader.activeTrackUrl === normalizedUrl
    ) {
      // Mesma faixa: nada a fazer (G85). Uma troca pendente para outra
      // faixa já foi invalidada pela geração? Não: a faixa ativa é esta.
      this.musicRequestGeneration += 1;
      return;
    }

    const requestGeneration = this.musicRequestGeneration + 1;
    this.musicRequestGeneration = requestGeneration;
    const assets = this.getAssets();

    if (assets === null) {
      console.warn("[AudioService] game.assets indisponível para crossfade.");
      return;
    }

    let buffer = assets.getAsset<AudioBuffer>(normalizedUrl);
    let retained = false;

    if (buffer === null || buffer === undefined) {
      try {
        buffer = await assets.loadAudio(normalizedUrl);
        retained = true;
      } catch (error: unknown) {
        if (!this.disposed && requestGeneration === this.musicRequestGeneration) {
          console.error(
            `[AudioService] Erro ao carregar música para crossfade: ${normalizedUrl}`,
            error,
          );
        }

        return;
      }
    } else {
      retained = assets.retainAsset(normalizedUrl);
    }

    if (
      this.disposed ||
      requestGeneration !== this.musicRequestGeneration ||
      buffer === null ||
      buffer === undefined
    ) {
      if (retained) {
        assets.releaseAsset(normalizedUrl);
      }

      return;
    }

    // A faixa fica retida enquanto toca (G87); liberada quando sai.
    if (retained) {
      this.musicRetains.set(normalizedUrl, (this.musicRetains.get(normalizedUrl) ?? 0) + 1);
    }

    const outcome = await this.crossfader.crossfade(buffer, normalizedUrl, {
      durationSeconds: options?.durationSeconds ?? 1.5,
      loop: options?.loop,
      fadeCurve: options?.fadeCurve,
      restart: true,
    });

    if (
      outcome !== "completed" ||
      this.disposed ||
      requestGeneration !== this.musicRequestGeneration
    ) {
      return;
    }

    this.ctx.events.emit("game.audio.crossfade-completed", {
      trackUrl: normalizedUrl,
      durationSeconds: this.crossfader.lastCrossfadeDurationSeconds,
    });
  }

  public async stopMusic(fadeSeconds?: number): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.musicRequestGeneration += 1;
    const requestGeneration = this.musicRequestGeneration;
    const trackUrl = this.crossfader.activeTrackUrl;
    const outcome = await this.crossfader.stopMusic(sanitizeFade(fadeSeconds));

    if (outcome !== "completed" || this.disposed || requestGeneration !== this.musicRequestGeneration) {
      return;
    }

    this.ctx.events.emit("game.audio.music-stopped", { trackUrl });
  }

  public getCurrentMusicTrack(): string | null {
    return this.crossfader.activeTrackUrl;
  }

  public updateListenerPosition(position: Vector3Audio, forward?: Vector3Audio, up?: Vector3Audio): void {
    if (this.disposed || !this.mixer.isAvailable) {
      return;
    }

    this.listenerBridge.updateListenerPosition(position, forward, up);
    this.listener.x = finite(position.x);
    this.listener.y = finite(position.y);
    this.listener.z = finite(position.z);

    for (const voice of this.voices.values()) {
      if (voice.rangeCutoff) {
        this.updateRange(voice);
      }
    }
  }

  public stopAllSounds(fadeSeconds?: number): void {
    this.musicRequestGeneration += 1;
    const fade = sanitizeFade(fadeSeconds);

    if (fade > 0 && this.mixer.isAvailable && !this.disposed) {
      for (const voice of this.voices.values()) {
        this.stopSound(voice.id, fade);
      }

      void this.crossfader.stopMusic(fade);
      return;
    }

    this.voices.stopAll();
    this.crossfader.stop();
  }

  public get activeVoiceCount(): number {
    return this.voices.activeVoiceCount;
  }

  public setVoiceLimit(maxVoices: number, maxHrtfVoices?: number): void {
    this.maxVoices = sanitizeLimit(maxVoices, this.maxVoices);

    if (maxHrtfVoices !== undefined) {
      this.maxHrtfVoices = sanitizeLimit(maxHrtfVoices, this.maxHrtfVoices);
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.musicRequestGeneration += 1;
    this.voices.dispose();
    this.crossfader.dispose();
    this.mixer.dispose();
    const assets = this.getAssets();

    if (assets !== null) {
      for (const [url, count] of this.musicRetains) {
        for (let index = 0; index < count; index += 1) {
          assets.releaseAsset(url);
        }
      }
    }

    this.musicRetains.clear();
  }

  private ensureAvailable(): boolean {
    if (this.mixer.isAvailable) {
      return true;
    }

    if (!this.warnedUnavailable) {
      this.warnedUnavailable = true;
      console.warn("[AudioService] Web Audio indisponível: sons serão ignorados.");
    }

    return false;
  }

  /** Aplica o limite de vozes roubando o one-shot mais antigo (G86). */
  private makeRoomForVoice(loop: boolean): boolean {
    while (this.voices.activeVoiceCount >= this.maxVoices) {
      const victim = this.voices.oldestStealable(false);

      if (victim === null) {
        if (!loop) {
          return false;
        }

        const loopVictim = this.voices.oldestStealable(true);

        if (loopVictim === null) {
          return false;
        }

        this.voices.stopNow(loopVictim.id);
        continue;
      }

      this.voices.stopNow(victim.id);
    }

    return true;
  }

  /**
   * Antes do desbloqueio: one-shots pedidos há mais de 250 ms não tocam
   * todos juntos quando o contexto começar (G86).
   */
  private pruneStaleDeferredVoices(): void {
    const now = nowMs();

    for (const voice of this.voices.values()) {
      if (voice.deferred && !voice.loop && now - voice.requestedAtMs > DEFERRED_ONE_SHOT_WINDOW_MS) {
        this.voices.stopNow(voice.id);
      }
    }
  }

  private computeRangeFactor(x: number, y: number, z: number, maxDistance: number): number {
    const dx = finite(x) - this.listener.x;
    const dy = finite(y) - this.listener.y;
    const dz = finite(z) - this.listener.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (distance >= maxDistance) {
      return 0;
    }

    const fadeStart = maxDistance * (1 - RANGE_FADE_FRACTION);

    if (distance <= fadeStart) {
      return 1;
    }

    return (maxDistance - distance) / (maxDistance - fadeStart);
  }

  private updateRange(voice: AudioVoiceRecord): void {
    if (!voice.rangeCutoff) {
      return;
    }

    const factor = this.computeRangeFactor(voice.px, voice.py, voice.pz, voice.maxDistance);

    if (Math.abs(factor - voice.rangeFactor) < 0.001) {
      return;
    }

    voice.rangeFactor = factor;

    if (!voice.stopping) {
      this.applyVoiceGain(voice, VOLUME_RAMP_SECONDS);
    }
  }

  private applyVoiceGain(voice: AudioVoiceRecord, rampSeconds: number): void {
    if (!this.mixer.isAvailable) {
      return;
    }

    const ctx = this.mixer.audioContext;
    const now = ctx.currentTime;
    const gain = voice.gainNode.gain;
    const target = voice.volume * voice.rangeFactor;
    gain.cancelScheduledValues(now);

    if (rampSeconds > 0) {
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(target, now + rampSeconds);
    } else {
      gain.setValueAtTime(target, now);
    }
  }

  private emitChannelChanged(channel: AudioChannelType): void {
    this.ctx.events.emit("game.audio.channel-volume-changed", {
      channel,
      volume: this.mixer.getChannelVolume(channel),
      muted: this.mixer.isChannelMuted(channel),
    });
  }

  private releaseMusicRetain(url: string): void {
    const count = this.musicRetains.get(url);

    if (count === undefined) {
      return;
    }

    if (count <= 1) {
      this.musicRetains.delete(url);
    } else {
      this.musicRetains.set(url, count - 1);
    }

    this.getAssets()?.releaseAsset(url);
  }

  private getAssets(): AssetsApi | null {
    try {
      return this.ctx.caps.get(AssetsToken) ?? null;
    } catch {
      return null;
    }
  }
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
