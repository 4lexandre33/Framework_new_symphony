import { invoke } from "@tauri-apps/api/core";
import type { ClockValidationResult, CrashReportPayload } from "../../../contracts/security/types";

export interface SystemClockValidationResult {
  readonly valid: boolean;
  readonly osDeltaMs: number;
}

export interface CrashDumpWriteResult {
  readonly written: boolean;
  readonly path?: string;
  readonly removed?: number;
  readonly error?: string;
}

const CLOCK_TOLERANCE_RATIO = 0.25;
const CLOCK_MIN_ABSOLUTE_TOLERANCE_MS = 50;
const CALLER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/u;
const DEFAULT_CALLER = "default";

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

export function isTauriRuntime(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ === "object"
  );
}

/**
 * G114/G115: ponte com `security.rs`.
 *
 * - Relógio POR CHAMADOR (`callerId`): cada chamador tem o seu baseline no
 *   nativo; sem Tauri o baseline é `Date.now()` por chamador (não "sempre
 *   passa").
 * - Crash dump: devolve o resultado REAL da gravação.
 */
export class TauriSecurityDriver {
  private readonly wallBaselines = new Map<string, number>();

  public constructor(
    private readonly call: Invoke = invoke as Invoke,
    private readonly hasNative: () => boolean = isTauriRuntime,
    private readonly wallNow: () => number = Date.now,
  ) {}

  /** API legada: chamador "default". */
  public async validateSystemClock(
    browserDeltaMs: number,
  ): Promise<SystemClockValidationResult> {
    const result = await this.validateForCaller(DEFAULT_CALLER, browserDeltaMs);
    return { valid: result.valid, osDeltaMs: result.referenceDeltaMs };
  }

  public async validateForCaller(
    callerId: string,
    browserDeltaMs: number,
  ): Promise<ClockValidationResult> {
    if (!CALLER_ID_RE.test(callerId)) {
      throw new TypeError(`callerId inválido: "${callerId}" (use [A-Za-z0-9_-], até 64)`);
    }
    if (!Number.isFinite(browserDeltaMs) || browserDeltaMs < 0) {
      return { valid: false, referenceDeltaMs: 0, browserDeltaMs, source: "wall-clock" };
    }

    let referenceDeltaMs: number;
    let source: ClockValidationResult["source"];
    const native = await this.nativeDelta(callerId);
    if (native !== null) {
      referenceDeltaMs = native;
      source = "native";
    } else {
      const now = this.wallNow();
      const previous = this.wallBaselines.get(callerId);
      this.wallBaselines.set(callerId, now);
      if (this.wallBaselines.size > 64) {
        const first = this.wallBaselines.keys().next().value;
        if (first !== undefined && first !== callerId) this.wallBaselines.delete(first);
      }
      referenceDeltaMs = previous === undefined ? 0 : Math.max(0, now - previous);
      source = "wall-clock";
    }

    if (referenceDeltaMs === 0) {
      return { valid: true, referenceDeltaMs, browserDeltaMs, source: "baseline" };
    }

    const allowedDriftMs = Math.max(
      CLOCK_MIN_ABSOLUTE_TOLERANCE_MS,
      referenceDeltaMs * CLOCK_TOLERANCE_RATIO,
    );
    return {
      valid: Math.abs(browserDeltaMs - referenceDeltaMs) <= allowedDriftMs,
      referenceDeltaMs,
      browserDeltaMs,
      source,
    };
  }

  /** ms nativos (Instant) desde a chamada anterior do chamador; null sem Tauri. */
  public async nativeDelta(callerId: string): Promise<number | null> {
    if (!this.hasNative()) return null;
    try {
      const osDeltaMs = await this.call<number>("security_validate_system_clock", {
        clientTimestampMs: Math.floor(monotonicNow()),
        callerId,
      });
      return Number.isFinite(osDeltaMs) && osDeltaMs >= 0 ? osDeltaMs : null;
    } catch {
      return null;
    }
  }

  public async writeCrashDump(
    report: CrashReportPayload,
    options: { readonly namespace?: string; readonly maxFiles?: number } = {},
  ): Promise<CrashDumpWriteResult> {
    if (!this.hasNative()) {
      return { written: false, error: "sem host Tauri: dump não gravado em disco" };
    }
    try {
      const raw = await this.call<unknown>("security_write_crash_dump", {
        crashId: report.crashId,
        content: JSON.stringify(report, null, 2),
        ...(options.namespace ? { namespace: options.namespace } : {}),
        ...(options.maxFiles !== undefined ? { maxFiles: options.maxFiles } : {}),
      });
      if (typeof raw === "boolean") return { written: raw };
      if (raw !== null && typeof raw === "object") {
        const r = raw as { written?: unknown; path?: unknown; removed?: unknown };
        return {
          written: r.written === true,
          ...(typeof r.path === "string" ? { path: r.path } : {}),
          ...(typeof r.removed === "number" ? { removed: r.removed } : {}),
        };
      }
      return { written: false, error: "resposta nativa inesperada" };
    } catch (err) {
      return { written: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

function monotonicNow(): number {
  if (
    typeof performance !== "undefined" &&
    typeof performance.now === "function"
  ) {
    return performance.now();
  }

  return Date.now();
}
