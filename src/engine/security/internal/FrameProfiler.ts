import type {
  SubsystemProfilingMetric,
  SystemFrameMetric,
} from "../../../contracts/security/types";

interface SubsystemAccumulator {
  lastDurationMs: number;
  totalDurationMs: number;
  maxDurationMs: number;
  sampleCount: number;
}

type NowProvider = () => number;

const DEFAULT_FRAME_HISTORY_SIZE = 120;

export class FrameProfiler {
  private readonly subsystemStartTimes = new Map<string, number>();
  private readonly subsystemStats = new Map<string, SubsystemAccumulator>();
  private readonly frameHistory: Float64Array;

  private currentFrameIndex = 0;
  private lastFrameTimestamp: number;
  private currentFrameTimeMs = 0;

  public constructor(
    private readonly now: NowProvider = defaultNowMs,
    historyBufferSize = DEFAULT_FRAME_HISTORY_SIZE,
  ) {
    const safeHistorySize = Number.isFinite(historyBufferSize)
      ? Math.max(1, Math.floor(historyBufferSize))
      : DEFAULT_FRAME_HISTORY_SIZE;

    this.frameHistory = new Float64Array(safeHistorySize);
    this.lastFrameTimestamp = this.now();
  }

  public beginSubsystem(name: string): void {
    const normalizedName = name.trim();
    if (normalizedName.length === 0) {
      return;
    }

    this.subsystemStartTimes.set(normalizedName, this.now());
  }

  public endSubsystem(name: string): void {
    const normalizedName = name.trim();
    const startTime = this.subsystemStartTimes.get(normalizedName);

    if (startTime === undefined) {
      return;
    }

    this.subsystemStartTimes.delete(normalizedName);

    const durationMs = Math.max(0, this.now() - startTime);
    const existing = this.subsystemStats.get(normalizedName);

    if (existing) {
      existing.lastDurationMs = durationMs;
      existing.totalDurationMs += durationMs;
      existing.maxDurationMs = Math.max(existing.maxDurationMs, durationMs);
      existing.sampleCount += 1;
      return;
    }

    this.subsystemStats.set(normalizedName, {
      lastDurationMs: durationMs,
      totalDurationMs: durationMs,
      maxDurationMs: durationMs,
      sampleCount: 1,
    });
  }

  public updateFrame(deltaSeconds?: number): void {
    const now = this.now();

    if (
      deltaSeconds !== undefined &&
      Number.isFinite(deltaSeconds) &&
      deltaSeconds >= 0
    ) {
      this.currentFrameTimeMs = deltaSeconds * 1000;
    } else {
      this.currentFrameTimeMs = Math.max(0, now - this.lastFrameTimestamp);
    }

    this.lastFrameTimestamp = now;

    const historyIndex = this.currentFrameIndex % this.frameHistory.length;
    this.frameHistory[historyIndex] = this.currentFrameTimeMs;
    this.currentFrameIndex += 1;
  }

  public getProfilerSnapshot(sampleCount?: number): SystemFrameMetric {
    const availableSamples = Math.min(
      this.currentFrameIndex,
      this.frameHistory.length,
    );

    const samplesToUse = this.resolveSampleCount(sampleCount, availableSamples);

    let totalFrameTimeMs = 0;

    for (let offset = 0; offset < samplesToUse; offset += 1) {
      const historyIndex =
        (this.currentFrameIndex - 1 - offset + this.frameHistory.length) %
        this.frameHistory.length;

      totalFrameTimeMs += this.frameHistory[historyIndex] ?? 0;
    }

    const averageFrameTimeMs =
      samplesToUse > 0 ? totalFrameTimeMs / samplesToUse : 0;

    const fps =
      averageFrameTimeMs > 0
        ? Math.round(1000 / averageFrameTimeMs)
        : 0;

    const subsystemMetrics: SubsystemProfilingMetric[] = [];

    for (const [name, stats] of this.subsystemStats.entries()) {
      const averageDurationMs =
        stats.sampleCount > 0
          ? stats.totalDurationMs / stats.sampleCount
          : 0;

      subsystemMetrics.push({
        name,
        lastDurationMs: roundMetric(stats.lastDurationMs),
        avgDurationMs: roundMetric(averageDurationMs),
        maxDurationMs: roundMetric(stats.maxDurationMs),
      });
    }

    subsystemMetrics.sort((first, second) => first.name.localeCompare(second.name));

    return {
      frameIndex: this.currentFrameIndex,
      totalFrameTimeMs: roundMetric(this.currentFrameTimeMs),
      fps,
      subsystems: subsystemMetrics,
    };
  }

  public clear(): void {
    this.subsystemStartTimes.clear();
    this.subsystemStats.clear();
    this.frameHistory.fill(0);

    this.currentFrameIndex = 0;
    this.currentFrameTimeMs = 0;
    this.lastFrameTimestamp = this.now();
  }

  private resolveSampleCount(
    requestedSampleCount: number | undefined,
    availableSamples: number,
  ): number {
    if (availableSamples <= 0) {
      return 0;
    }

    if (
      requestedSampleCount === undefined ||
      !Number.isFinite(requestedSampleCount)
    ) {
      return availableSamples;
    }

    return Math.min(
      availableSamples,
      Math.max(1, Math.floor(requestedSampleCount)),
    );
  }
}

function defaultNowMs(): number {
  if (
    typeof performance !== "undefined" &&
    typeof performance.now === "function"
  ) {
    return performance.now();
  }

  return Date.now();
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}
