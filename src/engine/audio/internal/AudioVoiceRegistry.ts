export interface AudioVoiceHandle {
  readonly source:
    AudioBufferSourceNode;

  readonly gainNode:
    GainNode;

  readonly pannerNode?:
    PannerNode;
}

export class AudioVoiceRegistry {
  private readonly voices =
    new Map<
      AudioBufferSourceNode,
      AudioVoiceHandle
    >();

  private disposed =
    false;

  public get activeVoiceCount():
    number {
    return this.voices
      .size;
  }

  public register(
    handle:
      AudioVoiceHandle,
  ): boolean {
    if (
      this.disposed
    ) {
      this.stopAndDisconnect(
        handle,
      );

      return false;
    }

    const source =
      handle.source;

    if (
      this.voices.has(
        source,
      )
    ) {
      return false;
    }

    this.voices.set(
      source,
      handle,
    );

    source.onended =
      (): void => {
        this.release(
          source,
        );
      };

    return true;
  }

  public release(
    source:
      AudioBufferSourceNode,
  ): boolean {
    const handle =
      this.voices.get(
        source,
      );

    if (
      handle ===
      undefined
    ) {
      return false;
    }

    this.voices.delete(
      source,
    );

    source.onended =
      null;

    this.disconnect(
      handle,
    );

    return true;
  }

  public stopAll(): void {
    for (
      const handle of
      this.voices.values()
    ) {
      handle.source.onended =
        null;

      try {
        handle.source
          .stop();
      } catch {
        // Source já encerrada.
      }

      this.disconnect(
        handle,
      );
    }

    this.voices.clear();
  }

  public dispose(): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.stopAll();

    this.disposed =
      true;
  }

  private stopAndDisconnect(
    handle:
      AudioVoiceHandle,
  ): void {
    handle.source.onended =
      null;

    try {
      handle.source.stop();
    } catch {
      // Source já encerrada.
    }

    this.disconnect(
      handle,
    );
  }

  private disconnect(
    handle:
      AudioVoiceHandle,
  ): void {
    try {
      handle.source
        .disconnect();
    } catch {
      // Node já desconectado.
    }

    if (
      handle.pannerNode !==
      undefined
    ) {
      try {
        handle.pannerNode
          .disconnect();
      } catch {
        // Node já desconectado.
      }
    }

    try {
      handle.gainNode
        .disconnect();
    } catch {
      // Node já desconectado.
    }
  }
}
