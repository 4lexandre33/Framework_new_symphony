import type {
  MusicCrossfadeOptions,
} from "../../../contracts/audio/types";

import {
  AudioMixer,
} from "./AudioMixer";

const MIN_EXPONENTIAL_GAIN = 0.0001;

function sanitizeDuration(value: number | undefined): number {
  if (value === undefined) {
    return 1.5;
  }

  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(60, Math.max(0, value));
}

function rampGain(param: AudioParam, value: number, endTime: number, exponential: boolean): void {
  if (exponential && typeof param.exponentialRampToValueAtTime === "function") {
    param.exponentialRampToValueAtTime(Math.max(MIN_EXPONENTIAL_GAIN, value), endTime);
    return;
  }

  param.linearRampToValueAtTime(value, endTime);
}

/** Resultado de um crossfade: concluído, ignorado (mesma faixa) ou substituído/parado. */
export type CrossfadeOutcome = "completed" | "unchanged" | "superseded";

interface PendingFade {
  timer: ReturnType<typeof setTimeout> | null;
  resolve: (outcome: CrossfadeOutcome) => void;
}

/**
 * Música de fundo no canal `bgm` com crossfade. A promessa de `crossfade`
 * resolve QUANDO o fade termina (G84); um novo crossfade/stop resolve a
 * anterior com "superseded". Crossfade para a faixa que já toca não reinicia
 * (G85), salvo `restart: true`.
 */
export class MusicCrossfader {
  private currentSource: AudioBufferSourceNode | null = null;
  private currentGainNode: GainNode | null = null;
  private currentTrackUrl: string | null = null;
  private lastDurationSeconds = 0;
  private pending: PendingFade | null = null;
  private trackEndedListener: ((url: string) => void) | null = null;
  private disposed = false;

  public constructor(private readonly mixer: AudioMixer) {}

  public get activeTrackUrl(): string | null {
    return this.currentTrackUrl;
  }

  public get lastCrossfadeDurationSeconds(): number {
    return this.lastDurationSeconds;
  }

  /** Avisado quando uma faixa deixa de tocar (fim natural, troca ou stop). */
  public setTrackEndedListener(listener: ((url: string) => void) | null): void {
    this.trackEndedListener = listener;
  }

  public crossfade(
    newBuffer: AudioBuffer,
    newTrackUrl: string,
    options?: MusicCrossfadeOptions,
  ): Promise<CrossfadeOutcome> {
    if (this.disposed || !this.mixer.isAvailable) {
      return Promise.resolve<CrossfadeOutcome>("superseded");
    }

    if (
      options?.restart !== true &&
      this.currentTrackUrl === newTrackUrl &&
      this.currentSource !== null
    ) {
      return Promise.resolve<CrossfadeOutcome>("unchanged");
    }

    this.settlePending("superseded");
    const ctx = this.mixer.audioContext;
    const bgmGain = this.mixer.getChannelGainNode("bgm");
    const duration = sanitizeDuration(options?.durationSeconds);
    const exponential = options?.fadeCurve === "exponential";
    const now = ctx.currentTime;

    this.fadeOutCurrent(duration, exponential);

    const nextSource = ctx.createBufferSource();
    nextSource.buffer = newBuffer;
    nextSource.loop = options?.loop !== false;
    const nextGain = ctx.createGain();
    const initialGain = duration > 0 ? MIN_EXPONENTIAL_GAIN : 1;
    nextGain.gain.setValueAtTime(initialGain, now);

    if (duration > 0) {
      rampGain(nextGain.gain, 1, now + duration, exponential);
    }

    nextSource.connect(nextGain);
    nextGain.connect(bgmGain);

    nextSource.onended = (): void => {
      this.disconnectPair(nextSource, nextGain);

      if (this.currentSource === nextSource) {
        const url = this.currentTrackUrl;
        this.currentSource = null;
        this.currentGainNode = null;
        this.currentTrackUrl = null;

        if (url !== null) {
          this.notifyTrackEnded(url);
        }
      }
    };

    nextSource.start(0);
    this.currentSource = nextSource;
    this.currentGainNode = nextGain;
    this.currentTrackUrl = newTrackUrl;
    this.lastDurationSeconds = duration;

    return this.waitFade(duration);
  }

  /**
   * Para só a música, com fade opcional (G85). Resolve quando o fade
   * termina. Sem música tocando resolve imediatamente.
   */
  public stopMusic(fadeSeconds = 0): Promise<CrossfadeOutcome> {
    this.settlePending("superseded");

    if (this.currentSource === null || !this.mixer.isAvailable) {
      this.stop();
      return Promise.resolve<CrossfadeOutcome>("completed");
    }

    const duration = sanitizeDuration(fadeSeconds);

    if (duration === 0) {
      this.stop();
      return Promise.resolve<CrossfadeOutcome>("completed");
    }

    this.fadeOutCurrent(duration, false);
    this.currentSource = null;
    this.currentGainNode = null;
    this.currentTrackUrl = null;
    this.lastDurationSeconds = duration;
    return this.waitFade(duration);
  }

  public stop(): void {
    this.settlePending("superseded");
    const source = this.currentSource;
    const gain = this.currentGainNode;
    const url = this.currentTrackUrl;
    this.currentSource = null;
    this.currentGainNode = null;
    this.currentTrackUrl = null;
    this.lastDurationSeconds = 0;

    if (source === null || gain === null) {
      return;
    }

    source.onended = null;

    try {
      source.stop();
    } catch {
      // Source já encerrada.
    }

    this.disconnectPair(source, gain);

    if (url !== null) {
      this.notifyTrackEnded(url);
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.stop();
    this.trackEndedListener = null;
    this.disposed = true;
  }

  private fadeOutCurrent(duration: number, exponential: boolean): void {
    const oldSource = this.currentSource;
    const oldGain = this.currentGainNode;
    const oldUrl = this.currentTrackUrl;

    if (oldSource === null || oldGain === null) {
      return;
    }

    const now = this.mixer.audioContext.currentTime;
    oldGain.gain.cancelScheduledValues(now);
    oldGain.gain.setValueAtTime(Math.max(MIN_EXPONENTIAL_GAIN, oldGain.gain.value), now);
    rampGain(oldGain.gain, exponential ? MIN_EXPONENTIAL_GAIN : 0, now + duration, exponential);

    oldSource.onended = (): void => {
      this.disconnectPair(oldSource, oldGain);

      if (oldUrl !== null) {
        this.notifyTrackEnded(oldUrl);
      }
    };

    try {
      oldSource.stop(now + duration);
    } catch {
      oldSource.onended = null;
      this.disconnectPair(oldSource, oldGain);

      if (oldUrl !== null) {
        this.notifyTrackEnded(oldUrl);
      }
    }
  }

  private waitFade(duration: number): Promise<CrossfadeOutcome> {
    return new Promise<CrossfadeOutcome>((resolve): void => {
      const pending: PendingFade = { timer: null, resolve };
      this.pending = pending;

      const finish = (): void => {
        if (this.pending === pending) {
          this.pending = null;
        }

        pending.timer = null;
        resolve("completed");
      };

      if (duration <= 0) {
        finish();
        return;
      }

      pending.timer = setTimeout(finish, duration * 1000);
    });
  }

  private settlePending(outcome: CrossfadeOutcome): void {
    const pending = this.pending;

    if (pending === null) {
      return;
    }

    this.pending = null;

    if (pending.timer !== null) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }

    pending.resolve(outcome);
  }

  private notifyTrackEnded(url: string): void {
    const listener = this.trackEndedListener;

    if (listener !== null) {
      listener(url);
    }
  }

  private disconnectPair(source: AudioBufferSourceNode, gain: GainNode): void {
    try {
      source.disconnect();
    } catch {
      // Node já desconectado.
    }

    try {
      gain.disconnect();
    } catch {
      // Node já desconectado.
    }
  }
}
