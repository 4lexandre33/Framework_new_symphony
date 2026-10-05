export interface InputFrameUpdatable {
  update(): void;
}

export interface InputFrameScheduler {
  requestFrame(
    callback:
      FrameRequestCallback,
  ): number;

  cancelFrame(
    handle:
      number,
  ): void;
}

const BROWSER_INPUT_FRAME_SCHEDULER:
  InputFrameScheduler = {
    requestFrame(
      callback:
        FrameRequestCallback,
    ): number {
      return globalThis
        .requestAnimationFrame(
          callback,
        );
    },

    cancelFrame(
      handle:
        number,
    ): void {
      globalThis
        .cancelAnimationFrame(
          handle,
        );
    },
  };

export class InputFramePump {
  private running =
    false;

  private disposed =
    false;

  private frameHandle:
    number |
    null = null;

  private readonly frameCallback:
    FrameRequestCallback =
      (
        timestamp,
      ): void => {
        void timestamp;

        this.processFrame();
      };

  public constructor(
    private readonly input:
      InputFrameUpdatable,
    private readonly scheduler:
      InputFrameScheduler =
        BROWSER_INPUT_FRAME_SCHEDULER,
  ) {}

  public get isRunning():
    boolean {
    return this.running;
  }

  public start(): boolean {
    if (
      this.disposed ||
      this.running
    ) {
      return false;
    }

    this.running =
      true;

    try {
      this.scheduleNextFrame();
    } catch (
      error:
        unknown
    ) {
      this.running =
        false;

      this.frameHandle =
        null;

      throw error;
    }

    return true;
  }

  public stop(): void {
    if (
      !this.running &&
      this.frameHandle ===
        null
    ) {
      return;
    }

    this.running =
      false;

    const handle =
      this.frameHandle;

    this.frameHandle =
      null;

    if (
      handle !==
      null
    ) {
      this.scheduler
        .cancelFrame(
          handle,
        );
    }
  }

  public dispose(): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.stop();

    this.disposed =
      true;
  }

  private processFrame(): void {
    if (
      !this.running ||
      this.disposed
    ) {
      return;
    }

    this.frameHandle =
      null;

    this.input.update();

    if (
      this.running &&
      !this.disposed
    ) {
      this.scheduleNextFrame();
    }
  }

  private scheduleNextFrame(): void {
    this.frameHandle =
      this.scheduler
        .requestFrame(
          this.frameCallback,
        );
  }
}
