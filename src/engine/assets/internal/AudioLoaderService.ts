interface WindowWithWebkitAudioContext
  extends Window {
  readonly webkitAudioContext?:
    typeof AudioContext;
}

export interface AudioLoadProgressObserver {
  onProgress(
    url:
      string,
    loadedBytes:
      number,
    totalBytes:
      number,
  ): void;
}

export class AudioLoaderService {
  private audioContext:
    AudioContext |
    null = null;

  private disposed =
    false;

  public constructor(
    private readonly observer?:
      AudioLoadProgressObserver,
  ) {}

  public async load(
    url:
      string,
  ): Promise<AudioBuffer> {
    if (
      this.disposed
    ) {
      throw new Error(
        "AudioLoaderService já foi descartado.",
      );
    }

    const response =
      await fetch(
        url,
      );

    if (
      !response.ok
    ) {
      throw new Error(
        `HTTP ${String(response.status)} ao carregar áudio ${url}.`,
      );
    }

    const totalHeader =
      response.headers.get(
        "content-length",
      );

    const totalBytes =
      totalHeader ===
        null
        ? 0
        : Number(
            totalHeader,
          );

    const arrayBuffer =
      await response
        .arrayBuffer();

    this.observer
      ?.onProgress(
        url,
        arrayBuffer.byteLength,
        Number.isFinite(
          totalBytes,
        )
          ? totalBytes
          : 0,
      );

    const context =
      await this.getAudioContext();

    return context
      .decodeAudioData(
        arrayBuffer,
      );
  }

  public dispose(): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.disposed =
      true;

    const context =
      this.audioContext;

    this.audioContext =
      null;

    if (
      context !==
        null &&
      context.state !==
        "closed"
    ) {
      void context.close()
        .catch(
          (): void => {
            // Teardown best-effort: não bloqueia shutdown do Kernel.
          },
        );
    }
  }

  private async getAudioContext():
    Promise<AudioContext> {
    if (
      this.audioContext ===
      null
    ) {
      const windowRef =
        window as
          WindowWithWebkitAudioContext;

      const AudioContextCtor =
        window.AudioContext ??
        windowRef.webkitAudioContext;

      if (
        AudioContextCtor ===
        undefined
      ) {
        throw new Error(
          "Web Audio API indisponível.",
        );
      }

      this.audioContext =
        new AudioContextCtor();
    }

    if (
      this.audioContext.state ===
      "suspended"
    ) {
      await this.audioContext
        .resume();
    }

    return this.audioContext;
  }
}
