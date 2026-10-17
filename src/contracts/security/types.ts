import { defineEvent, defineCommand } from "@core";

/**
 * G113: `avgDurationMs`/`maxDurationMs` são da JANELA MÓVEL (últimas N
 * medições, N = tamanho do histórico do profiler); `lastDurationMs` é a
 * última; `lifetimeMaxDurationMs` é o máximo desde o início/reset.
 */
export interface SubsystemProfilingMetric {
  readonly name: string;
  readonly lastDurationMs: number;
  readonly avgDurationMs: number;
  readonly maxDurationMs: number;
  /** Medições desde o início/reset. */
  readonly sampleCount?: number;
  /** Medições dentro da janela usada em avg/max. */
  readonly windowSamples?: number;
  readonly lifetimeMaxDurationMs?: number;
}

/**
 * G113: tempos de frame REAIS (relógio de parede entre `game.loop.render`),
 * não o delta fixo do tick. `fps` = 1000 / média da janela.
 */
export interface SystemFrameMetric {
  readonly frameIndex: number;
  /** Tempo real do ÚLTIMO frame (ms). */
  readonly totalFrameTimeMs: number;
  readonly fps: number;
  readonly subsystems: ReadonlyArray<SubsystemProfilingMetric>;
  /** Frames usados nas estatísticas abaixo (janela). */
  readonly windowFrames?: number;
  readonly avgFrameTimeMs?: number;
  readonly minFrameTimeMs?: number;
  readonly maxFrameTimeMs?: number;
}

/**
 * Valor protegido OPACO (G114). Só descritores EMITIDOS pela própria
 * instância de `game.security` (`protectNumber`) são aceitos: um objeto
 * forjado/copiado/desserializado (mesmo com campos idênticos) é rejeitado,
 * e o checksum usa um segredo que nunca sai do serviço. O descritor é
 * congelado. Não persista descritores (não sobrevivem a reload).
 */
export interface ProtectedValueDescriptor {
  readonly id: string;
  readonly obfuscatedValue: number;
  readonly key: number;
  readonly checksum: number;
}

export interface SecurityViolationPayload {
  readonly violationType: "memory_tampering" | "speedhack_detected" | "checksum_mismatch";
  readonly details: string;
  readonly timestamp: number;
  /** Heurística que disparou (speedhack): ver `SpeedhackHeuristic`. */
  readonly heuristic?: SpeedhackHeuristic;
}

export type CrashReportSource =
  | "manual"
  | "window.error"
  | "unhandledrejection"
  | "kernel.handler";

export interface CrashReportPayload {
  readonly crashId: string;
  readonly errorMessage: string;
  readonly stackTrace: string;
  /** Cena ativa do `game.world` (se disponível), senão "desconhecida". */
  readonly activeSceneId?: string;
  readonly webglRenderer?: string;
  readonly timestamp: number;
  readonly environment: Record<string, string | number>;
  /** G115: true só se o dump foi REALMENTE gravado em disco (Tauri). */
  readonly written?: boolean;
  /** Caminho absoluto do arquivo gravado (Tauri). */
  readonly path?: string;
  /** Motivo de não ter gravado (sem Tauri, erro de IO, limite da sessão…). */
  readonly writeError?: string;
  /** G16: origem do relatório. */
  readonly source?: CrashReportSource;
}

export interface CrashReportOptions {
  /** Sobrepõe a cena detectada no `game.world`. */
  readonly activeSceneId?: string;
  readonly source?: CrashReportSource;
}

/** G114: heurísticas de speedhack. */
export type SpeedhackHeuristic =
  /** Tempo simulado (soma dos ticks) andou mais rápido que o relógio monotônico. */
  | "tick_ahead_of_monotonic"
  /** `performance.now()` divergiu de `Date.now()` de forma sustentada. */
  | "monotonic_vs_wall_drift"
  /** Relógio do JS divergiu do `Instant` monotônico nativo (Tauri). */
  | "js_vs_native_drift"
  /** `validateSystemClock` reprovou o delta informado. */
  | "caller_clock_check";

export interface SpeedhackStatus {
  readonly enabled: boolean;
  /** Janelas avaliadas desde o início/reset. */
  readonly windowsEvaluated: number;
  readonly detections: number;
  readonly lastHeuristic: SpeedhackHeuristic | null;
  /** Razão (simulado/monotônico) da última janela. */
  readonly lastTickRatio: number;
  /** Razão (monotônico/parede) da última janela. */
  readonly lastWallRatio: number;
  /** Saltos isolados do relógio de parede ignorados (ajuste de hora do SO). */
  readonly wallClockAdjustments: number;
  /** true se a última amostra nativa (Tauri) foi usada. */
  readonly nativeAvailable: boolean;
}

export interface ClockValidationResult {
  readonly valid: boolean;
  /** Delta do relógio de referência (nativo ou `Date.now`) desde a chamada anterior DESTE chamador. */
  readonly referenceDeltaMs: number;
  readonly browserDeltaMs: number;
  /** "baseline" = primeira chamada do chamador (sempre válida). */
  readonly source: "native" | "wall-clock" | "baseline";
}

/** Validador de relógio com estado PRÓPRIO por chamador (G114). */
export interface ClockValidator {
  readonly callerId: string;
  /** Mede o delta do navegador desde a chamada anterior e confere. */
  validate(): Promise<ClockValidationResult>;
}

// ── EVENTOS DE SEGURANÇA & PROFILING ───────────────────────────────────────

export const SecurityAlertEvent = defineEvent<
  "game.security.alert",
  SecurityViolationPayload
>("game.security.alert");

export const CrashReportGeneratedEvent = defineEvent<
  "game.security.crash-generated",
  CrashReportPayload
>("game.security.crash-generated");

// ── COMANDOS DE SEGURANÇA & PROFILING ───────────────────────────────────────

export interface CaptureFrameMetricsPayload {
  readonly sampleCount?: number;
}

export const CaptureFrameMetricsCommand = defineCommand<
  "game.security.capture-metrics",
  CaptureFrameMetricsPayload
>("game.security.capture-metrics");

export interface ValidateMemoryIntegrityPayload {
  readonly descriptors: ReadonlyArray<ProtectedValueDescriptor>;
}

export const ValidateMemoryIntegrityCommand = defineCommand<
  "game.security.validate-integrity",
  ValidateMemoryIntegrityPayload
>("game.security.validate-integrity");

export interface DumpCrashReportPayload {
  readonly error: Error | string;
}

export const DumpCrashReportCommand = defineCommand<
  "game.security.dump-crash",
  DumpCrashReportPayload
>("game.security.dump-crash");