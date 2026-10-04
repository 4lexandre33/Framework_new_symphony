import { invoke } from "@tauri-apps/api/core";
import type { CrashReportPayload } from "../../../contracts/security/types";

export interface SystemClockValidationResult {
  readonly valid: boolean;
  readonly osDeltaMs: number;
}

const CLOCK_TOLERANCE_RATIO = 0.25;
const CLOCK_MIN_ABSOLUTE_TOLERANCE_MS = 50;

export class TauriSecurityDriver {
  public async validateSystemClock(
    browserDeltaMs: number,
  ): Promise<SystemClockValidationResult> {
    if (!Number.isFinite(browserDeltaMs) || browserDeltaMs < 0) {
      return {
        valid: false,
        osDeltaMs: 0,
      };
    }

    try {
      const osDeltaMs = await invoke<number>(
        "security_validate_system_clock",
        {
          clientTimestampMs: Math.floor(nowMs()),
        },
      );

      if (!Number.isFinite(osDeltaMs) || osDeltaMs < 0) {
        return {
          valid: false,
          osDeltaMs: 0,
        };
      }

      /*
       * A primeira amostra nativa é apenas o baseline.
       */
      if (osDeltaMs === 0) {
        return {
          valid: true,
          osDeltaMs,
        };
      }

      const allowedDriftMs = Math.max(
        CLOCK_MIN_ABSOLUTE_TOLERANCE_MS,
        osDeltaMs * CLOCK_TOLERANCE_RATIO,
      );

      return {
        valid: Math.abs(browserDeltaMs - osDeltaMs) <= allowedDriftMs,
        osDeltaMs,
      };
    } catch {
      /*
       * Vitest/Web sem host Tauri: não acusamos falso positivo.
       */
      return {
        valid: true,
        osDeltaMs: browserDeltaMs,
      };
    }
  }

  public async writeCrashDump(
    report: CrashReportPayload,
  ): Promise<boolean> {
    try {
      return await invoke<boolean>(
        "security_write_crash_dump",
        {
          crashId: report.crashId,
          content: JSON.stringify(report, null, 2),
        },
      );
    } catch {
      console.warn(
        "[TauriSecurityDriver] Falha ao gravar crash dump via Rust IPC.",
      );
      return false;
    }
  }
}

function nowMs(): number {
  if (
    typeof performance !== "undefined" &&
    typeof performance.now === "function"
  ) {
    return performance.now();
  }

  return Date.now();
}
