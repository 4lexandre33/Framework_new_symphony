import type {
  AudioChannelType,
} from "../../../contracts/audio/types";

export interface ChannelNodeState {
  readonly gainNode: GainNode;
  volume: number;
  muted: boolean;
}

interface WindowWithWebkitAudioContext extends Window {
  readonly webkitAudioContext?: typeof AudioContext;
}

/** "unavailable" = sem Web Audio (node/jsdom/WebView restrito): a engine segue muda. */
export type AudioMixerState = AudioContextState | "unavailable";

const CHILD_CHANNELS: readonly AudioChannelType[] = Object.freeze([
  "bgm",
  "sfx",
  "voice",
  "ui",
]);

const UNLOCK_EVENTS: readonly string[] = Object.freeze([
  "pointerdown",
  "mousedown",
  "keydown",
  "touchstart",
  "touchend",
]);

const CHANNEL_RAMP_SECONDS = 0.05;

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function resolveAudioContextCtor(): (typeof AudioContext) | undefined {
  if (typeof window === "undefined") {
    return typeof AudioContext === "undefined" ? undefined : AudioContext;
  }

  const windowRef = window as WindowWithWebkitAudioContext;
  return window.AudioContext ?? windowRef.webkitAudioContext;
}

/**
 * Mixer por canais (`bgm`/`sfx`/`voice`/`ui` → `master` → destination).
 *
 * Sem Web Audio o mixer entra em modo "unavailable": volumes continuam
 * rastreados e nenhuma chamada lança (G86). Com o contexto suspenso pela
 * política de autoplay, o mixer escuta o primeiro gesto do usuário e
 * chama `resume()` dentro dele.
 */
export class AudioMixer {
  private readonly context: AudioContext | null;
  private readonly masterGain: GainNode | null;
  private readonly channels = new Map<AudioChannelType, ChannelNodeState>();
  private readonly volumes = new Map<AudioChannelType, { volume: number; muted: boolean }>();
  private readonly ownsContext: boolean;
  private disposed = false;
  private unlockInstalled = false;
  private beforeResumeHook: (() => void) | null = null;
  private runningHook: (() => void) | null = null;

  public constructor(customAudioContext?: AudioContext | null) {
    let context: AudioContext | null = null;
    let owns = false;

    if (customAudioContext !== undefined) {
      context = customAudioContext;
    } else {
      const AudioContextCtor = resolveAudioContextCtor();

      if (AudioContextCtor !== undefined) {
        try {
          context = new AudioContextCtor();
          owns = true;
        } catch (error: unknown) {
          console.warn("[AudioMixer] AudioContext indisponível; áudio desativado:", error);
          context = null;
        }
      }
    }

    this.context = context;
    this.ownsContext = owns;
    this.volumes.set("master", { volume: 1, muted: false });

    if (context === null) {
      this.masterGain = null;

      for (const type of CHILD_CHANNELS) {
        this.volumes.set(type, { volume: 1, muted: false });
      }

      return;
    }

    this.masterGain = context.createGain();
    this.masterGain.connect(context.destination);
    this.channels.set("master", {
      gainNode: this.masterGain,
      volume: 1,
      muted: false,
    });
    this.initializeChildChannels(context, this.masterGain);

    this.handleUnlockGesture = this.handleUnlockGesture.bind(this);
    this.handleStateChange = this.handleStateChange.bind(this);

    if (typeof context.addEventListener === "function") {
      context.addEventListener("statechange", this.handleStateChange);
    }

    this.installUnlockListeners();
  }

  public get isAvailable(): boolean {
    return this.context !== null && !this.disposed;
  }

  public get state(): AudioMixerState {
    if (this.context === null) {
      return "unavailable";
    }

    return this.context.state;
  }

  /** O contexto Web Audio. Lança se indisponível: verifique `isAvailable` antes. */
  public get audioContext(): AudioContext {
    if (this.context === null) {
      throw new Error("Web Audio API indisponível.");
    }

    return this.context;
  }

  public get masterGainNode(): GainNode {
    if (this.masterGain === null) {
      throw new Error("Web Audio API indisponível.");
    }

    return this.masterGain;
  }

  public get isDisposed(): boolean {
    return this.disposed;
  }

  /** Chamado (sincronamente, dentro do gesto) logo antes de `resume()`. */
  public setBeforeResumeHook(hook: (() => void) | null): void {
    this.beforeResumeHook = hook;
  }

  /** Chamado quando o contexto passa a "running". */
  public setRunningHook(hook: (() => void) | null): void {
    this.runningHook = hook;
  }

  /**
   * Ajusta o volume do canal. `muted` omitido MANTÉM o estado de mudo atual
   * (G84: antes desmutava).
   */
  public setChannelVolume(channel: AudioChannelType, volume: number, muted?: boolean): void {
    if (this.disposed) {
      return;
    }

    const record = this.volumes.get(channel);

    if (record === undefined) {
      return;
    }

    record.volume = clampVolume(volume);

    if (muted !== undefined) {
      record.muted = muted;
    }

    const state = this.channels.get(channel);

    if (state === undefined || this.context === null) {
      return;
    }

    state.volume = record.volume;
    state.muted = record.muted;
    const targetGain = state.muted ? 0 : state.volume;
    const now = this.context.currentTime;
    state.gainNode.gain.cancelScheduledValues(now);
    state.gainNode.gain.setValueAtTime(state.gainNode.gain.value, now);
    state.gainNode.gain.linearRampToValueAtTime(targetGain, now + CHANNEL_RAMP_SECONDS);
  }

  public setChannelMuted(channel: AudioChannelType, muted: boolean): void {
    this.setChannelVolume(channel, this.getChannelVolume(channel), muted);
  }

  public getChannelVolume(channel: AudioChannelType): number {
    return this.volumes.get(channel)?.volume ?? 1;
  }

  public isChannelMuted(channel: AudioChannelType): boolean {
    return this.volumes.get(channel)?.muted ?? false;
  }

  public getChannelGainNode(channel: AudioChannelType): GainNode {
    const node = this.channels.get(channel)?.gainNode ?? this.masterGain;

    if (node === null) {
      throw new Error("Web Audio API indisponível.");
    }

    return node;
  }

  public async resumeIfSuspended(): Promise<void> {
    if (this.disposed || this.context === null || this.context.state !== "suspended") {
      return;
    }

    try {
      await this.context.resume();
    } catch (error: unknown) {
      console.warn("[AudioMixer] Falha ao retomar AudioContext:", error);
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.removeUnlockListeners();
    this.beforeResumeHook = null;
    this.runningHook = null;

    if (this.context !== null && typeof this.context.removeEventListener === "function") {
      this.context.removeEventListener("statechange", this.handleStateChange);
    }

    for (const state of this.channels.values()) {
      try {
        state.gainNode.disconnect();
      } catch {
        // AudioNode já desconectado.
      }
    }

    this.channels.clear();

    if (this.ownsContext && this.context !== null && this.context.state !== "closed") {
      void this.context.close().catch((): void => {
        // Shutdown best-effort.
      });
    }
  }

  private installUnlockListeners(): void {
    if (
      this.unlockInstalled ||
      this.context === null ||
      this.context.state !== "suspended" ||
      typeof window === "undefined"
    ) {
      return;
    }

    for (const type of UNLOCK_EVENTS) {
      window.addEventListener(type, this.handleUnlockGesture, { capture: true, passive: true });
    }

    this.unlockInstalled = true;
  }

  private removeUnlockListeners(): void {
    if (!this.unlockInstalled || typeof window === "undefined") {
      return;
    }

    for (const type of UNLOCK_EVENTS) {
      window.removeEventListener(type, this.handleUnlockGesture, { capture: true });
    }

    this.unlockInstalled = false;
  }

  private handleUnlockGesture(): void {
    if (this.disposed || this.context === null) {
      return;
    }

    if (this.context.state !== "suspended") {
      this.removeUnlockListeners();
      return;
    }

    const hook = this.beforeResumeHook;

    if (hook !== null) {
      hook();
    }

    void this.resumeIfSuspended();
  }

  private handleStateChange(): void {
    if (this.disposed || this.context === null) {
      return;
    }

    if (this.context.state === "running") {
      this.removeUnlockListeners();
      const hook = this.runningHook;

      if (hook !== null) {
        hook();
      }
    } else if (this.context.state === "suspended") {
      this.installUnlockListeners();
    }
  }

  private initializeChildChannels(context: AudioContext, master: GainNode): void {
    for (const type of CHILD_CHANNELS) {
      const gainNode = context.createGain();
      gainNode.connect(master);
      this.channels.set(type, {
        gainNode,
        volume: 1,
        muted: false,
      });
      this.volumes.set(type, { volume: 1, muted: false });
    }
  }
}
