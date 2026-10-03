import type { AudioChannelType } from "../../contracts/audio/types";

export interface ChannelNodeState {
  readonly gainNode: GainNode;
  volume: number;
  muted: boolean;
}

export class AudioMixer {
  private readonly context: AudioContext;
  private readonly masterGain: GainNode;
  private readonly channels = new Map<AudioChannelType, ChannelNodeState>();

  public constructor(customAudioContext?: AudioContext) {
    if (customAudioContext) {
      this.context = customAudioContext;
    } else {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.context = new AudioCtx();
    }

    this.masterGain = this.context.createGain();
    this.masterGain.connect(this.context.destination);

    this.initializeChannels();
  }

  public get audioContext(): AudioContext {
    return this.context;
  }

  public get masterGainNode(): GainNode {
    return this.masterGain;
  }

  public setChannelVolume(channel: AudioChannelType, volume: number, muted = false): void {
    const state = this.channels.get(channel);
    if (!state) return;

    state.volume = Math.max(0, Math.min(1, volume));
    state.muted = muted;

    const targetGain = state.muted ? 0 : state.volume;
    const now = this.context.currentTime;

    state.gainNode.gain.cancelScheduledValues(now);
    state.gainNode.gain.linearRampToValueAtTime(targetGain, now + 0.05);
  }

  public getChannelVolume(channel: AudioChannelType): number {
    return this.channels.get(channel)?.volume ?? 1.0;
  }

  public isChannelMuted(channel: AudioChannelType): boolean {
    return this.channels.get(channel)?.muted ?? false;
  }

  public getChannelGainNode(channel: AudioChannelType): GainNode {
    const state = this.channels.get(channel);
    return state ? state.gainNode : this.masterGain;
  }

  public resumeIfSuspended(): void {
    if (this.context.state === "suspended") {
      this.context.resume().catch((err) => {
        console.warn("[AudioMixer] Falha ao retomar AudioContext:", err);
      });
    }
  }

  public dispose(): void {
    for (const state of this.channels.values()) {
      state.gainNode.disconnect();
    }
    this.channels.clear();
    this.masterGain.disconnect();
    if (this.context.state !== "closed") {
      this.context.close().catch(() => {});
    }
  }

  private initializeChannels(): void {
    const channelTypes: AudioChannelType[] = ["master", "bgm", "sfx", "voice", "ui"];

    for (const type of channelTypes) {
      const gainNode = this.context.createGain();

      if (type === "master") {
        gainNode.connect(this.context.destination);
      } else {
        gainNode.connect(this.masterGain);
      }

      this.channels.set(type, {
        gainNode,
        volume: 1.0,
        muted: false,
      });
    }
  }
}