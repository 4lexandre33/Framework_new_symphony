import { defineCapability } from "@core";
import type {
  CrashReportPayload,
  ProtectedValueDescriptor,
  SystemFrameMetric,
} from "../contracts/security/types";

export interface SecurityApi {
  beginSubsystemMetric(name: string): void;
  endSubsystemMetric(name: string): void;
  getProfilerSnapshot(sampleCount?: number): SystemFrameMetric;

  protectNumber(id: string, value: number): ProtectedValueDescriptor;
  readProtectedNumber(descriptor: ProtectedValueDescriptor): number | null;
  verifyIntegrity(descriptor: ProtectedValueDescriptor): boolean;

  validateSystemClock(browserDeltaMs: number): Promise<boolean>;
  dumpCrashReport(error: Error | string): Promise<CrashReportPayload>;

  update(deltaSeconds: number): void;
  clear(): void;
}

export const SecurityToken = defineCapability<SecurityApi>(
  "game.security",
  "1.0.0",
);