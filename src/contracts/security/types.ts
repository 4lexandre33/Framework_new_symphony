import { defineEvent, defineCommand } from "@core";

export interface SubsystemProfilingMetric {
  readonly name: string;
  readonly lastDurationMs: number;
  readonly avgDurationMs: number;
  readonly maxDurationMs: number;
}

export interface SystemFrameMetric {
  readonly frameIndex: number;
  readonly totalFrameTimeMs: number;
  readonly fps: number;
  readonly subsystems: ReadonlyArray<SubsystemProfilingMetric>;
}

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
}

export interface CrashReportPayload {
  readonly crashId: string;
  readonly errorMessage: string;
  readonly stackTrace: string;
  readonly activeSceneId?: string;
  readonly webglRenderer?: string;
  readonly timestamp: number;
  readonly environment: Record<string, string | number>;
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