import {
  fetchArrayBuffer,
} from "./AssetFetch";

import type {
  AssetProgressCallback,
  FetchLike,
} from "./AssetFetch";

interface WindowWithWebkitAudioContext {
  readonly AudioContext?: typeof AudioContext;
  readonly webkitAudioContext?: typeof AudioContext;
}

export interface AudioLoadProgressObserver {
  onProgress(url: string, loadedBytes: number, totalBytes: number): void;
}

type DecodeContext = BaseAudioContext & { close?: () => Promise<void> };

/**
 * Baixa e decodifica áudio. A decodificação NÃO depende do contexto estar
 * "running": o contexto de decodificação nunca recebe `resume()`, então
 * `loadAudio` conclui antes do primeiro gesto do usuário (G80). Um
 * AudioBuffer decodificado aqui toca em qualquer outro AudioContext.
 */
export class AudioLoaderService {
  private audioContext: DecodeContext | null = null;
  private disposed = false;

  public constructor(
    private readonly observer?: AudioLoadProgressObserver,
    private readonly fetchImpl?: FetchLike,
  ) {}

  public async load(url: string, onProgress?: AssetProgressCallback): Promise<AudioBuffer> {
    if (this.disposed) {
      throw new Error("AudioLoaderService já foi descartado.");
    }

    const { buffer } = await fetchArrayBuffer(
      url,
      (loaded: number, total: number): void => {
        this.observer?.onProgress(url, loaded, total);
        onProgress?.(loaded, total);
      },
      this.fetchImpl,
    );

    if (this.disposed) {
      throw new Error("AudioLoaderService já foi descartado.");
    }

    const context = this.getDecodeContext();
    return decode(context, buffer);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    const context = this.audioContext;
    this.audioContext = null;

    if (context !== null && context.state !== "closed" && typeof context.close === "function") {
      void context.close().catch((): void => {
        // Teardown best-effort: não bloqueia shutdown do Kernel.
      });
    }
  }

  private getDecodeContext(): DecodeContext {
    if (this.audioContext !== null) {
      return this.audioContext;
    }

    const windowRef =
      typeof window === "undefined" ? undefined : (window as unknown as WindowWithWebkitAudioContext);
    const AudioContextCtor =
      windowRef?.AudioContext ??
      windowRef?.webkitAudioContext ??
      (typeof AudioContext === "undefined" ? undefined : AudioContext);

    if (AudioContextCtor !== undefined) {
      try {
        const created: DecodeContext = new AudioContextCtor();
        this.audioContext = created;
        return created;
      } catch {
        // Cai para OfflineAudioContext.
      }
    }

    if (typeof OfflineAudioContext !== "undefined") {
      const offline: DecodeContext = new OfflineAudioContext(1, 1, 44100);
      this.audioContext = offline;
      return offline;
    }

    throw new Error("Web Audio API indisponível: não é possível decodificar áudio.");
  }
}

function decode(context: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject): void => {
    let settled = false;
    const ok = (buffer: AudioBuffer): void => {
      if (!settled) {
        settled = true;
        resolve(buffer);
      }
    };
    const fail = (error: unknown): void => {
      if (!settled) {
        settled = true;
        reject(error instanceof Error ? error : new Error(`Falha ao decodificar áudio: ${String(error)}`));
      }
    };

    try {
      // Forma com callbacks + promessa: cobre WebKit antigo e navegadores atuais.
      const maybePromise = context.decodeAudioData(data, ok, fail) as Promise<AudioBuffer> | undefined;

      if (maybePromise !== undefined && typeof maybePromise.then === "function") {
        maybePromise.then(ok, fail);
      }
    } catch (error: unknown) {
      fail(error);
    }
  });
}
