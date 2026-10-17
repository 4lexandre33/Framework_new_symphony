import { defineCapability } from "@core";
import type {
  ClockValidator,
  CrashReportOptions,
  CrashReportPayload,
  ProtectedValueDescriptor,
  SpeedhackStatus,
  SystemFrameMetric,
} from "../contracts/security/types";

export interface SecurityApi {
  // ── Profiler (G113) ──
  beginSubsystemMetric(name: string): void;
  endSubsystemMetric(name: string): void;
  /** Frames REAIS (medidos entre `game.loop.render`) em janela móvel. */
  getProfilerSnapshot(sampleCount?: number): SystemFrameMetric;
  /**
   * Registra um frame. O plugin já chama a cada `game.loop.render`; use só
   * em loops próprios/headless. Sem argumento mede o tempo de parede real.
   */
  recordFrame(realDeltaSeconds?: number): void;
  /** Zera estatísticas do profiler (frames e subsistemas). */
  resetProfiler(): void;

  // ── Valores protegidos (opacos, G114) ──
  protectNumber(id: string, value: number): ProtectedValueDescriptor;
  readProtectedNumber(descriptor: ProtectedValueDescriptor): number | null;
  verifyIntegrity(descriptor: ProtectedValueDescriptor): boolean;

  // ── Relógio / speedhack (G114) ──
  /**
   * Confere `browserDeltaMs` contra o relógio de referência (Instant nativo
   * no Tauri; `Date.now` no navegador) desde a chamada ANTERIOR do MESMO
   * `callerId` (default "default"). A 1ª chamada de cada chamador é baseline.
   */
  validateSystemClock(browserDeltaMs: number, callerId?: string): Promise<boolean>;
  /** Validador com estado próprio que mede o delta do navegador sozinho. */
  createClockValidator(callerId?: string): ClockValidator;
  /** Estado da detecção automática (heurísticas tick/monotônico/nativo). */
  getSpeedhackStatus(): SpeedhackStatus;
  setSpeedhackDetectionEnabled(enabled: boolean): void;

  // ── Crash report (G16/G115) ──
  /**
   * Gera e GRAVA (Tauri) um relatório. Sempre resolve: `written`/`path`/
   * `writeError` dizem o que aconteceu de verdade.
   */
  dumpCrashReport(error: Error | string, options?: CrashReportOptions): Promise<CrashReportPayload>;
  /** Captura automática (window error/unhandledrejection + kernel.handler.error). */
  setCrashCaptureEnabled(enabled: boolean): void;
  isCrashCaptureEnabled(): boolean;

  /** Hook do tick (delta simulado): alimenta a detecção de speedhack. */
  update(deltaSeconds: number): void;
  clear(): void;
}

export const SecurityToken = defineCapability<SecurityApi>(
  "game.security",
  "1.0.0",
);
