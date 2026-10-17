import type { PluginContext } from "@core";
import { type SecurityApi } from "../../../tokens/security";
import {
  CrashReportGeneratedEvent,
  SecurityAlertEvent,
  type ClockValidationResult,
  type ClockValidator,
  type CrashReportOptions,
  type CrashReportPayload,
  type CrashReportSource,
  type ProtectedValueDescriptor,
  type SpeedhackHeuristic,
  type SpeedhackStatus,
  type SystemFrameMetric,
} from "../../../contracts/security/types";
import { FrameProfiler } from "./FrameProfiler";
import { MemoryIntegrityGuard } from "./MemoryIntegrityGuard";
import { CrashReportDumper } from "./CrashReportDumper";
import { TauriSecurityDriver } from "./TauriSecurityDriver";
import { SpeedhackMonitor } from "./SpeedhackMonitor";

export interface SecurityServiceOptions {
  /** G16: captura automática de erros (window + kernel). Default true. */
  readonly crashCapture?: boolean;
  /** Máximo de dumps por sessão (manuais + automáticos). Default 10. */
  readonly maxCrashDumpsPerSession?: number;
  /** Rotação no disco (Tauri): dumps mantidos na pasta. Default 20. */
  readonly maxCrashDumpFiles?: number;
  /** Subpasta extra dentro de `crash-dumps/` ([A-Za-z0-9_-]). */
  readonly crashNamespace?: string;
  /** G114: detecção automática de speedhack. Default true. */
  readonly speedhackDetection?: boolean;
  readonly speedhackWindowMs?: number;
  readonly speedhackTolerance?: number;
  /** Cena ativa (ex.: `game.world.currentSceneId`). */
  readonly sceneIdProvider?: () => string | null | undefined;
  /** Nome da GPU a partir de um contexto JÁ existente. */
  readonly rendererNameProvider?: () => string | undefined;
  readonly driver?: TauriSecurityDriver;
  readonly profiler?: FrameProfiler;
  readonly monotonicNow?: () => number;
  readonly wallNow?: () => number;
  /** Alvo dos listeners globais (default `globalThis` se tiver addEventListener). */
  readonly errorTarget?: Pick<EventTarget, "addEventListener" | "removeEventListener"> | null;
}

/** Erros repetidos (mesma mensagem) dentro desta janela viram um só dump. */
const DEDUPE_WINDOW_MS = 1000;
const NAMESPACE_RE = /^[A-Za-z0-9_-]{1,64}$/u;
let validatorSequence = 0;

export class SecurityService implements SecurityApi {
  private readonly profiler: FrameProfiler;
  private readonly guard = new MemoryIntegrityGuard();
  private readonly dumper = new CrashReportDumper();
  private readonly driver: TauriSecurityDriver;
  private readonly speedhack: SpeedhackMonitor;
  private readonly monotonicNow: () => number;

  private crashCaptureEnabled: boolean;
  private readonly maxDumpsPerSession: number;
  private readonly maxDumpFiles: number;
  private readonly namespace: string | undefined;
  private dumpsThisSession = 0;
  private lastAutoMessage = "";
  private lastAutoAt = Number.NEGATIVE_INFINITY;
  private readonly disposers: Array<() => void> = [];
  private readonly errorTarget: SecurityServiceOptions["errorTarget"];
  private globalListenersAttached = false;
  private disposed = false;

  private readonly onWindowError = (event: Event): void => {
    const e = event as ErrorEvent;
    const error: unknown = e.error ?? e.message ?? "erro desconhecido";
    this.captureAutomatic(error, "window.error");
  };

  private readonly onUnhandledRejection = (event: Event): void => {
    const reason: unknown = (event as PromiseRejectionEvent).reason;
    this.captureAutomatic(reason ?? "promise rejeitada sem motivo", "unhandledrejection");
  };

  public constructor(
    private readonly ctx: PluginContext,
    private readonly options: SecurityServiceOptions = {},
  ) {
    this.profiler = options.profiler ?? new FrameProfiler(options.monotonicNow);
    this.driver = options.driver ?? new TauriSecurityDriver();
    this.monotonicNow = options.monotonicNow ?? defaultMonotonicNow;
    this.crashCaptureEnabled = options.crashCapture ?? true;
    this.maxDumpsPerSession = clampInt(options.maxCrashDumpsPerSession, 10, 0, 1000);
    this.maxDumpFiles = clampInt(options.maxCrashDumpFiles, 20, 1, 200);
    this.namespace =
      options.crashNamespace !== undefined && NAMESPACE_RE.test(options.crashNamespace)
        ? options.crashNamespace
        : undefined;
    this.errorTarget =
      options.errorTarget !== undefined
        ? options.errorTarget
        : typeof globalThis.addEventListener === "function"
          ? globalThis
          : null;

    this.speedhack = new SpeedhackMonitor({
      windowMs: options.speedhackWindowMs,
      tolerance: options.speedhackTolerance,
      monotonicNow: this.monotonicNow,
      wallNow: options.wallNow,
      nativeDelta: () => this.driver.nativeDelta("security_monitor"),
      onDetect: (heuristic, details) =>
        this.emitSecurityAlert("speedhack_detected", details, heuristic),
    });
    this.speedhack.setEnabled(options.speedhackDetection ?? true);

    if (this.crashCaptureEnabled) this.attachGlobalListeners();
  }

  // ── Profiler (G113) ────────────────────────────────────────────────

  public beginSubsystemMetric(name: string): void {
    this.profiler.beginSubsystem(name);
  }

  public endSubsystemMetric(name: string): void {
    this.profiler.endSubsystem(name);
  }

  public getProfilerSnapshot(sampleCount?: number): SystemFrameMetric {
    return this.profiler.getProfilerSnapshot(sampleCount);
  }

  public recordFrame(realDeltaSeconds?: number): void {
    this.profiler.updateFrame(realDeltaSeconds);
  }

  public resetProfiler(): void {
    this.profiler.clear();
  }

  // ── Valores protegidos ─────────────────────────────────────────────

  public protectNumber(
    id: string,
    value: number,
  ): ProtectedValueDescriptor {
    return this.guard.protectNumber(id, value);
  }

  public readProtectedNumber(
    descriptor: ProtectedValueDescriptor,
  ): number | null {
    const value = this.guard.readProtectedNumber(descriptor);

    if (value === null) {
      this.emitSecurityAlert(
        "memory_tampering",
        `Adulteração detectada na variável protegida: ${safeId(descriptor)}`,
      );
    }

    return value;
  }

  public verifyIntegrity(
    descriptor: ProtectedValueDescriptor,
  ): boolean {
    return this.guard.verifyIntegrity(descriptor);
  }

  public validateMemoryIntegrity(
    descriptors: ReadonlyArray<ProtectedValueDescriptor>,
  ): boolean {
    const invalidIds: string[] = [];

    for (let index = 0; index < descriptors.length; index += 1) {
      const descriptor = descriptors[index];

      if (!descriptor) {
        continue;
      }

      if (!this.guard.verifyIntegrity(descriptor)) {
        invalidIds.push(safeId(descriptor));
      }
    }

    if (invalidIds.length === 0) {
      return true;
    }

    this.emitSecurityAlert(
      "checksum_mismatch",
      `Checksum inválido em ${invalidIds.length} variável(is): ${invalidIds.join(", ")}`,
    );

    return false;
  }

  // ── Relógio / speedhack (G114) ─────────────────────────────────────

  public async validateSystemClock(browserDeltaMs: number, callerId?: string): Promise<boolean> {
    const result = await this.driver.validateForCaller(callerId ?? "default", browserDeltaMs);
    this.reportClockResult(result);
    return result.valid;
  }

  public createClockValidator(callerId?: string): ClockValidator {
    validatorSequence += 1;
    const id = callerId ?? `validator_${validatorSequence}`;
    let last: number | null = null;
    return {
      callerId: id,
      validate: async (): Promise<ClockValidationResult> => {
        const now = this.monotonicNow();
        const browserDeltaMs = last === null ? 0 : now - last;
        last = now;
        const result = await this.driver.validateForCaller(id, browserDeltaMs);
        this.reportClockResult(result);
        return result;
      },
    };
  }

  public getSpeedhackStatus(): SpeedhackStatus {
    return this.speedhack.getStatus();
  }

  public setSpeedhackDetectionEnabled(enabled: boolean): void {
    this.speedhack.setEnabled(enabled);
  }

  /** Recomeça a janela de speedhack (pausa/retomada, aba oculta). */
  public rebaseTiming(): void {
    this.speedhack.rebase();
    this.profiler.rebase();
  }

  // ── Crash report (G16/G115) ────────────────────────────────────────

  public async dumpCrashReport(
    error: Error | string,
    options: CrashReportOptions = {},
  ): Promise<CrashReportPayload> {
    return this.dump(error, options.source ?? "manual", options.activeSceneId);
  }

  public setCrashCaptureEnabled(enabled: boolean): void {
    this.crashCaptureEnabled = enabled;
    if (enabled) this.attachGlobalListeners();
    else this.detachGlobalListeners();
  }

  public isCrashCaptureEnabled(): boolean {
    return this.crashCaptureEnabled;
  }

  /** Chamado pelo plugin para cada `kernel.handler.error`. */
  public captureHandlerError(info: {
    readonly pluginId: string;
    readonly kind: string;
    readonly type: string;
    readonly message: string;
    readonly stack?: string;
  }): void {
    // Erros dos próprios handlers de segurança não geram dump (sem laço).
    if (info.pluginId === this.ctx.id) return;
    const err = new Error(`[${info.pluginId}] ${info.kind} "${info.type}": ${info.message}`);
    if (info.stack !== undefined) err.stack = info.stack;
    this.captureAutomatic(err, "kernel.handler");
  }

  // ── Loop ───────────────────────────────────────────────────────────

  /**
   * Hook de `game.loop.tick` com o delta SIMULADO: alimenta a detecção de
   * speedhack. NÃO mede frames (G113 — antes daqui saía o fps = tick rate).
   */
  public update(deltaSeconds: number): void {
    this.speedhack.onTick(deltaSeconds);
  }

  public clear(): void {
    this.profiler.clear();
    this.guard.rotateKey();
    this.speedhack.reset();
    this.dumpsThisSession = 0;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detachGlobalListeners();
    for (const d of this.disposers.splice(0)) {
      try { d(); } catch { /* hostil */ }
    }
  }

  // ── privados ───────────────────────────────────────────────────────

  private captureAutomatic(error: unknown, source: CrashReportSource): void {
    if (!this.crashCaptureEnabled || this.disposed) return;
    const message = error instanceof Error ? error.message : String(error);
    const now = this.monotonicNow();
    if (message === this.lastAutoMessage && now - this.lastAutoAt < DEDUPE_WINDOW_MS) return;
    this.lastAutoMessage = message;
    this.lastAutoAt = now;
    void this.dump(error, source).catch(() => { /* nunca propaga */ });
  }

  private async dump(
    error: unknown,
    source: CrashReportSource,
    sceneOverride?: string,
  ): Promise<CrashReportPayload> {
    const sceneId = sceneOverride ?? this.safeCall(this.options.sceneIdProvider) ?? undefined;
    const renderer = this.safeCall(this.options.rendererNameProvider);
    const base = this.dumper.generateReport(error, sceneId ?? undefined, renderer ?? undefined);

    let writeInfo: Pick<CrashReportPayload, "written" | "path" | "writeError">;
    if (this.dumpsThisSession >= this.maxDumpsPerSession) {
      writeInfo = {
        written: false,
        writeError: `limite de ${this.maxDumpsPerSession} dumps por sessão atingido`,
      };
    } else {
      this.dumpsThisSession += 1;
      const result = await this.driver.writeCrashDump(
        { ...base, source },
        { namespace: this.namespace, maxFiles: this.maxDumpFiles },
      );
      writeInfo = {
        written: result.written,
        ...(result.path !== undefined ? { path: result.path } : {}),
        ...(result.error !== undefined ? { writeError: result.error } : {}),
      };
    }

    const report: CrashReportPayload = { ...base, source, ...writeInfo };
    if (!this.disposed) {
      try {
        this.ctx.events.emit(CrashReportGeneratedEvent.type, report);
      } catch {
        /* evento é best-effort */
      }
    }
    return report;
  }

  private reportClockResult(result: ClockValidationResult): void {
    if (!result.valid) {
      this.emitSecurityAlert(
        "speedhack_detected",
        `Desvio de tempo: chamador mediu ${result.browserDeltaMs.toFixed(0)}ms vs ${result.referenceDeltaMs.toFixed(0)}ms (${result.source})`,
        "caller_clock_check",
      );
    }
  }

  private attachGlobalListeners(): void {
    if (this.globalListenersAttached || this.disposed || !this.errorTarget) return;
    this.errorTarget.addEventListener("error", this.onWindowError);
    this.errorTarget.addEventListener("unhandledrejection", this.onUnhandledRejection);
    this.globalListenersAttached = true;
  }

  private detachGlobalListeners(): void {
    if (!this.globalListenersAttached || !this.errorTarget) return;
    this.errorTarget.removeEventListener("error", this.onWindowError);
    this.errorTarget.removeEventListener("unhandledrejection", this.onUnhandledRejection);
    this.globalListenersAttached = false;
  }

  private safeCall<T>(fn: (() => T) | undefined): T | undefined {
    if (!fn) return undefined;
    try {
      return fn();
    } catch {
      return undefined;
    }
  }

  private emitSecurityAlert(
    violationType: "memory_tampering" | "speedhack_detected" | "checksum_mismatch",
    details: string,
    heuristic?: SpeedhackHeuristic,
  ): void {
    if (this.disposed) return;
    try {
      this.ctx.events.emit(
        SecurityAlertEvent.type,
        {
          violationType,
          details,
          timestamp: Date.now(),
          ...(heuristic !== undefined ? { heuristic } : {}),
        },
      );
    } catch {
      /* best-effort */
    }
  }
}

function safeId(descriptor: unknown): string {
  return typeof descriptor === "object" && descriptor !== null &&
    typeof (descriptor as { id?: unknown }).id === "string"
    ? (descriptor as { id: string }).id
    : "(inválido)";
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function defaultMonotonicNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}
