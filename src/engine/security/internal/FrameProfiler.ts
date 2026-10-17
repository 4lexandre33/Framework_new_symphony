import type {
  SubsystemProfilingMetric,
  SystemFrameMetric,
} from "../../../contracts/security/types";

/**
 * G113: profiler com tempo de frame REAL e estatísticas em JANELA MÓVEL.
 *
 * - `updateFrame()` sem argumento mede o tempo de parede desde o frame
 *   anterior (relógio monotônico). Com argumento usa o delta informado
 *   (deve ser um delta REAL, nunca o delta fixo do tick).
 * - Frames e subsistemas guardam as últimas `historyBufferSize` amostras em
 *   ring buffers pré-alocados (zero alocação por frame/medição depois da
 *   primeira medição de cada nome). avg/max/min do snapshot são da janela.
 * - `clear()` zera tudo (reset).
 */
interface SubsystemAccumulator {
  lastDurationMs: number;
  /** Total desde o início/reset (vitalício). */
  totalDurationMs: number;
  /** Máximo desde o início/reset (vitalício). */
  maxDurationMs: number;
  sampleCount: number;
  readonly window: Float64Array;
}

type NowProvider = () => number;

const DEFAULT_FRAME_HISTORY_SIZE = 120;

export class FrameProfiler {
  private readonly subsystemStartTimes = new Map<string, number>();
  private readonly subsystemStats = new Map<string, SubsystemAccumulator>();
  private readonly frameHistory: Float64Array;
  private readonly windowSize: number;

  private currentFrameIndex = 0;
  private lastFrameTimestamp: number;
  private currentFrameTimeMs = 0;
  private hasFrameTimestamp = false;

  public constructor(
    private readonly now: NowProvider = defaultNowMs,
    historyBufferSize = DEFAULT_FRAME_HISTORY_SIZE,
  ) {
    const safeHistorySize = Number.isFinite(historyBufferSize)
      ? Math.max(1, Math.floor(historyBufferSize))
      : DEFAULT_FRAME_HISTORY_SIZE;

    this.windowSize = safeHistorySize;
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
      existing.window[existing.sampleCount % existing.window.length] = durationMs;
      existing.sampleCount += 1;
      return;
    }

    const window = new Float64Array(this.windowSize);
    window[0] = durationMs;
    this.subsystemStats.set(normalizedName, {
      lastDurationMs: durationMs,
      totalDurationMs: durationMs,
      maxDurationMs: durationMs,
      sampleCount: 1,
      window,
    });
  }

  /**
   * Registra um frame. Sem argumento: delta REAL medido pelo relógio
   * monotônico desde o frame anterior (o primeiro frame após criar/limpar
   * mede desde a criação/limpeza).
   */
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
    this.hasFrameTimestamp = true;

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
    let minFrameTimeMs = Number.POSITIVE_INFINITY;
    let maxFrameTimeMs = 0;

    for (let offset = 0; offset < samplesToUse; offset += 1) {
      const historyIndex =
        (this.currentFrameIndex - 1 - offset + this.frameHistory.length) %
        this.frameHistory.length;

      const sample = this.frameHistory[historyIndex] ?? 0;
      totalFrameTimeMs += sample;
      if (sample < minFrameTimeMs) minFrameTimeMs = sample;
      if (sample > maxFrameTimeMs) maxFrameTimeMs = sample;
    }

    const averageFrameTimeMs =
      samplesToUse > 0 ? totalFrameTimeMs / samplesToUse : 0;

    const fps =
      averageFrameTimeMs > 0
        ? Math.round(1000 / averageFrameTimeMs)
        : 0;

    const subsystemMetrics: SubsystemProfilingMetric[] = [];

    for (const [name, stats] of this.subsystemStats.entries()) {
      const inWindow = Math.min(stats.sampleCount, stats.window.length);
      let windowTotal = 0;
      let windowMax = 0;
      for (let i = 0; i < inWindow; i += 1) {
        const value = stats.window[i] ?? 0;
        windowTotal += value;
        if (value > windowMax) windowMax = value;
      }

      subsystemMetrics.push({
        name,
        lastDurationMs: roundMetric(stats.lastDurationMs),
        avgDurationMs: roundMetric(inWindow > 0 ? windowTotal / inWindow : 0),
        maxDurationMs: roundMetric(windowMax),
        sampleCount: stats.sampleCount,
        windowSamples: inWindow,
        lifetimeMaxDurationMs: roundMetric(stats.maxDurationMs),
      });
    }

    subsystemMetrics.sort((first, second) => first.name.localeCompare(second.name));

    return {
      frameIndex: this.currentFrameIndex,
      totalFrameTimeMs: roundMetric(this.currentFrameTimeMs),
      fps,
      subsystems: subsystemMetrics,
      windowFrames: samplesToUse,
      avgFrameTimeMs: roundMetric(averageFrameTimeMs),
      minFrameTimeMs: samplesToUse > 0 ? roundMetric(minFrameTimeMs) : 0,
      maxFrameTimeMs: roundMetric(maxFrameTimeMs),
    };
  }

  /** true depois do primeiro `updateFrame` desde a criação/limpeza. */
  public hasFrames(): boolean {
    return this.hasFrameTimestamp;
  }

  public clear(): void {
    this.subsystemStartTimes.clear();
    this.subsystemStats.clear();
    this.frameHistory.fill(0);

    this.currentFrameIndex = 0;
    this.currentFrameTimeMs = 0;
    this.hasFrameTimestamp = false;
    this.lastFrameTimestamp = this.now();
  }

  /**
   * Re-ancora a medição de frame (ex.: ao voltar de aba oculta), sem
   * apagar estatísticas: o próximo frame não conta o tempo parado.
   */
  public rebase(): void {
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
