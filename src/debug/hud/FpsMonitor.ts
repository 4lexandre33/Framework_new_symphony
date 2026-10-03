export interface FpsSnapshot {
  fps: number;
  frameTimeMs: number;
  totalFrames: number;
}

export class FpsMonitor {
  private totalFrames = 0;
  private sampleFrames = 0;

  private lastSampleTime = 0;

  private readonly snapshot: FpsSnapshot = {
    fps: 0,
    frameTimeMs: 0,
    totalFrames: 0,
  };

  public constructor(
    private readonly sampleIntervalMs = 500,
  ) {}

  public reset(
    now: number = performance.now(),
  ): void {
    this.totalFrames = 0;
    this.sampleFrames = 0;

    this.lastSampleTime =
      now;

    this.snapshot.fps = 0;
    this.snapshot.frameTimeMs = 0;
    this.snapshot.totalFrames = 0;
  }

  public update(
    now: number,
  ): boolean {
    this.totalFrames += 1;
    this.sampleFrames += 1;

    this.snapshot.totalFrames =
      this.totalFrames;

    const elapsed =
      now - this.lastSampleTime;

    if (
      elapsed <
      this.sampleIntervalMs
    ) {
      return false;
    }

    this.snapshot.fps =
      (this.sampleFrames * 1000) /
      elapsed;

    this.snapshot.frameTimeMs =
      elapsed /
      this.sampleFrames;

    this.sampleFrames = 0;

    this.lastSampleTime =
      now;

    return true;
  }

  public getSnapshot():
    Readonly<FpsSnapshot> {
    return this.snapshot;
  }
}