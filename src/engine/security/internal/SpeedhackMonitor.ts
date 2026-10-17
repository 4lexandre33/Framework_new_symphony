import type {
  SpeedhackHeuristic,
  SpeedhackStatus,
} from "../../../contracts/security/types";

/**
 * G114: detecção AUTOMÁTICA de speedhack, no navegador e no nativo.
 *
 * Janela de avaliação a cada `windowMs` de tempo monotônico:
 *
 * 1. `tick_ahead_of_monotonic`: a soma dos deltas de `game.loop.tick` não
 *    pode passar o tempo monotônico (`performance.now`): o loop só PERDE
 *    tempo (clamp, pausa, aba oculta), nunca ganha. Simulado > real além da
 *    tolerância = delta/loop adulterado.
 * 2. `monotonic_vs_wall_drift`: `performance.now()` e `Date.now()` andam
 *    juntos; speedhacks que aceleram um só deles criam DESVIO PROPORCIONAL
 *    sustentado. Um salto isolado (ajuste de hora do SO/NTP) é contado em
 *    `wallClockAdjustments` e ignorado; só `sustainWindows` janelas
 *    seguidas fora da tolerância acusam.
 * 3. `js_vs_native_drift` (só Tauri): o `Instant` monotônico do Rust
 *    (por chamador) é comparado ao delta monotônico do JS.
 *
 * Hot path: `onTick` faz 1 leitura de relógio + somas; zero alocação.
 * Alertas têm cooldown (`cooldownMs`).
 */
export interface SpeedhackMonitorOptions {
  readonly windowMs?: number;
  readonly tolerance?: number;
  readonly sustainWindows?: number;
  readonly cooldownMs?: number;
  readonly monotonicNow?: () => number;
  readonly wallNow?: () => number;
  /** Delta nativo (ms) desde a amostra anterior; null = indisponível. */
  readonly nativeDelta?: () => Promise<number | null>;
  readonly onDetect: (heuristic: SpeedhackHeuristic, details: string) => void;
}

const DEFAULT_WINDOW_MS = 2000;
const DEFAULT_TOLERANCE = 0.25;
const DEFAULT_SUSTAIN = 2;
const DEFAULT_COOLDOWN_MS = 30_000;
/** Folga absoluta para jitter de agendamento (ms). */
const ABSOLUTE_SLACK_MS = 100;

export class SpeedhackMonitor {
  private readonly windowMs: number;
  private readonly tolerance: number;
  private readonly sustainWindows: number;
  private readonly cooldownMs: number;
  private readonly monotonicNow: () => number;
  private readonly wallNow: () => number;
  private readonly nativeDelta: (() => Promise<number | null>) | undefined;
  private readonly onDetect: SpeedhackMonitorOptions["onDetect"];

  private enabled = true;
  private windowStartMono = 0;
  private windowStartWall = 0;
  private simulatedMs = 0;
  private started = false;
  private driftStreak = 0;
  private lastAlertAt = Number.NEGATIVE_INFINITY;
  private nativeInFlight = false;
  private nativeBaselineMono: number | null = null;

  private windowsEvaluated = 0;
  private detections = 0;
  private lastHeuristic: SpeedhackHeuristic | null = null;
  private lastTickRatio = 1;
  private lastWallRatio = 1;
  private wallClockAdjustments = 0;
  private nativeAvailable = false;

  public constructor(options: SpeedhackMonitorOptions) {
    this.windowMs = positive(options.windowMs, DEFAULT_WINDOW_MS);
    this.tolerance = positive(options.tolerance, DEFAULT_TOLERANCE);
    this.sustainWindows = Math.max(1, Math.floor(positive(options.sustainWindows, DEFAULT_SUSTAIN)));
    this.cooldownMs = Math.max(0, options.cooldownMs ?? DEFAULT_COOLDOWN_MS);
    this.monotonicNow = options.monotonicNow ?? defaultMonotonicNow;
    this.wallNow = options.wallNow ?? Date.now;
    this.nativeDelta = options.nativeDelta;
    this.onDetect = options.onDetect;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.rebase();
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  /** Recomeça a janela (ex.: ao pausar/retomar ou voltar de aba oculta). */
  public rebase(): void {
    this.started = false;
    this.simulatedMs = 0;
    this.driftStreak = 0;
    this.nativeBaselineMono = null;
  }

  public reset(): void {
    this.rebase();
    this.windowsEvaluated = 0;
    this.detections = 0;
    this.lastHeuristic = null;
    this.lastTickRatio = 1;
    this.lastWallRatio = 1;
    this.wallClockAdjustments = 0;
    this.lastAlertAt = Number.NEGATIVE_INFINITY;
  }

  /** Chamado a cada `game.loop.tick` com o delta simulado (s). */
  public onTick(deltaSeconds: number): void {
    if (!this.enabled) return;
    const mono = this.monotonicNow();
    if (!this.started) {
      this.started = true;
      this.windowStartMono = mono;
      this.windowStartWall = this.wallNow();
      this.simulatedMs = 0;
      this.sampleNative(mono);
      return;
    }
    if (Number.isFinite(deltaSeconds) && deltaSeconds > 0) {
      this.simulatedMs += deltaSeconds * 1000;
    }
    const monoElapsed = mono - this.windowStartMono;
    if (monoElapsed >= this.windowMs) {
      this.evaluate(mono, monoElapsed);
    }
  }

  public getStatus(): SpeedhackStatus {
    return {
      enabled: this.enabled,
      windowsEvaluated: this.windowsEvaluated,
      detections: this.detections,
      lastHeuristic: this.lastHeuristic,
      lastTickRatio: this.lastTickRatio,
      lastWallRatio: this.lastWallRatio,
      wallClockAdjustments: this.wallClockAdjustments,
      nativeAvailable: this.nativeAvailable,
    };
  }

  private evaluate(mono: number, monoElapsed: number): void {
    const wall = this.wallNow();
    const wallElapsed = wall - this.windowStartWall;
    this.windowsEvaluated += 1;

    // 1) tempo simulado não pode andar mais que o real.
    this.lastTickRatio = monoElapsed > 0 ? this.simulatedMs / monoElapsed : 1;
    if (this.simulatedMs > monoElapsed * (1 + this.tolerance) + ABSOLUTE_SLACK_MS) {
      this.detect(
        "tick_ahead_of_monotonic",
        `tempo simulado ${this.simulatedMs.toFixed(0)}ms em ${monoElapsed.toFixed(0)}ms monotônicos (x${this.lastTickRatio.toFixed(2)})`,
        mono,
      );
    }

    // 2) performance.now vs Date.now, sustentado.
    this.lastWallRatio = wallElapsed > 0 ? monoElapsed / wallElapsed : 0;
    const drift = Math.abs(monoElapsed - wallElapsed);
    if (drift > monoElapsed * this.tolerance + ABSOLUTE_SLACK_MS) {
      this.driftStreak += 1;
      if (this.driftStreak >= this.sustainWindows) {
        this.detect(
          "monotonic_vs_wall_drift",
          `performance.now ${monoElapsed.toFixed(0)}ms vs Date.now ${wallElapsed.toFixed(0)}ms por ${this.driftStreak} janelas`,
          mono,
        );
      }
    } else {
      if (this.driftStreak === 1) this.wallClockAdjustments += 1;
      this.driftStreak = 0;
    }

    this.windowStartMono = mono;
    this.windowStartWall = wall;
    this.simulatedMs = 0;
    this.sampleNative(mono);
  }

  private sampleNative(mono: number): void {
    if (this.nativeDelta === undefined || this.nativeInFlight) return;
    this.nativeInFlight = true;
    const baseline = this.nativeBaselineMono;
    void this.nativeDelta()
      .then((nativeMs) => {
        const now = this.monotonicNow();
        if (nativeMs === null || !Number.isFinite(nativeMs)) {
          this.nativeAvailable = false;
          return;
        }
        this.nativeAvailable = true;
        if (baseline !== null && nativeMs > 0) {
          const jsMs = mono - baseline;
          if (Math.abs(jsMs - nativeMs) > nativeMs * this.tolerance + ABSOLUTE_SLACK_MS) {
            this.detect(
              "js_vs_native_drift",
              `JS ${jsMs.toFixed(0)}ms vs Instant nativo ${nativeMs.toFixed(0)}ms`,
              now,
            );
          }
        }
        this.nativeBaselineMono = mono;
      })
      .catch(() => {
        this.nativeAvailable = false;
      })
      .finally(() => {
        this.nativeInFlight = false;
      });
  }

  private detect(heuristic: SpeedhackHeuristic, details: string, mono: number): void {
    this.lastHeuristic = heuristic;
    this.detections += 1;
    if (mono - this.lastAlertAt < this.cooldownMs) return;
    this.lastAlertAt = mono;
    try {
      this.onDetect(heuristic, details);
    } catch {
      /* consumidor hostil */
    }
  }
}

function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function defaultMonotonicNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}
