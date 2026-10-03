import { AssetCache } from "./AssetCache";

export class AudioLoaderService {
  private audioContext: AudioContext | null = null;

  constructor(private readonly cache: AssetCache) {}

  private getAudioContext(): AudioContext {
    if (!this.audioContext) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx();
    }
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume();
    }
    return this.audioContext;
  }

  public async load(url: string): Promise<AudioBuffer> {
    if (this.cache.has(url)) {
      this.cache.retain(url);
      return this.cache.get<AudioBuffer>(url)!;
    }

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status} ao carregar áudio ${url}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const ctx = this.getAudioContext();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

      this.cache.set(url, audioBuffer, "audio");
      console.log(`[AudioLoaderService] ✅ Áudio decodificado em memória: ${url}`);
      return audioBuffer;
    } catch (error) {
      console.error(`[AudioLoaderService] ❌ Erro ao decodificar áudio ${url}:`, error);
      throw error;
    }
  }
}