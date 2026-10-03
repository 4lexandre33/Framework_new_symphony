import type { MusicCrossfadeOptions } from "../../contracts/audio/types";
import { AudioMixer } from "./AudioMixer";

export class MusicCrossfader {
  private currentSource: AudioBufferSourceNode | null = null;
  private currentGainNode: GainNode | null = null;
  private currentTrackUrl: string | null = null;

  public constructor(private readonly mixer: AudioMixer) {}

  public get activeTrackUrl(): string | null {
    return this.currentTrackUrl;
  }

  public async crossfade(
    newBuffer: AudioBuffer,
    newTrackUrl: string,
    options?: MusicCrossfadeOptions
  ): Promise<void> {
    this.mixer.resumeIfSuspended();
    const ctx = this.mixer.audioContext;
    const bgmGain = this.mixer.getChannelGainNode("bgm");
    const duration = options?.durationSeconds ?? 1.5;
    const now = ctx.currentTime;

    if (this.currentSource && this.currentGainNode) {
      const oldGain = this.currentGainNode;
      const oldSource = this.currentSource;

      oldGain.gain.cancelScheduledValues(now);
      oldGain.gain.setValueAtTime(oldGain.gain.value, now);
      oldGain.gain.linearRampToValueAtTime(0.0001, now + duration);

      setTimeout(() => {
        try {
          oldSource.stop();
          oldSource.disconnect();
          oldGain.disconnect();
        } catch {
          // Ignora se o áudio já tiver finalizado
        }
      }, duration * 1000 + 100);
    }

    const nextSource = ctx.createBufferSource();
    nextSource.buffer = newBuffer;
    nextSource.loop = options?.loop !== false;

    const nextGain = ctx.createGain();
    nextGain.gain.setValueAtTime(0.0001, now);
    nextGain.gain.linearRampToValueAtTime(1.0, now + duration);

    nextSource.connect(nextGain);
    nextGain.connect(bgmGain);

    nextSource.start(0);

    this.currentSource = nextSource;
    this.currentGainNode = nextGain;
    this.currentTrackUrl = newTrackUrl;
  }

  public stop(): void {
    if (this.currentSource && this.currentGainNode) {
      try {
        this.currentSource.stop();
        this.currentSource.disconnect();
        this.currentGainNode.disconnect();
      } catch {
        // Ignora
      }
      this.currentSource = null;
      this.currentGainNode = null;
      this.currentTrackUrl = null;
    }
  }
}