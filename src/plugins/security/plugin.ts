import type {
  Plugin,
  PluginContext,
} from "../../core/contracts/plugin-context";
import { SecurityToken, type SecurityApi } from "../../tokens/security";
import type { GameTickPayload } from "../../contracts/game-loop/types";

import {
  CaptureFrameMetricsCommand,
  CrashReportGeneratedEvent,
  DumpCrashReportCommand,
  SecurityAlertEvent,
  ValidateMemoryIntegrityCommand,
  type CaptureFrameMetricsPayload,
  type CrashReportPayload,
  type DumpCrashReportPayload,
  type ProtectedValueDescriptor,
  type SystemFrameMetric,
  type ValidateMemoryIntegrityPayload,
} from "../../contracts/security/types";

import { FrameProfiler } from "../../engine/security/FrameProfiler";
import { MemoryIntegrityGuard } from "../../engine/security/MemoryIntegrityGuard";
import { CrashReportDumper } from "../../engine/security/CrashReportDumper";
import { TauriSecurityDriver } from "../../engine/security/TauriSecurityDriver";

export const securityManifest: Plugin["manifest"] = {
  id: "game.security",
  name: "Profiler, Anti-cheat & Crash Report Plugin",
  version: "1.0.0",
  kind: "preloaded",
  authority: "game",

  dependsOn: [
    {
      id: "game.loop",
      range: "^1.0.0",
    },
  ],

  permissions: {
    capabilities: [SecurityToken.id],
    events: [
      SecurityAlertEvent.type,
      CrashReportGeneratedEvent.type,
      "game.loop.tick",
    ],
  },

  capabilities: {
    provides: [
      {
        id: SecurityToken.id,
        version: "1.0.0",
      },
    ],
  },
};

export class SecurityService implements SecurityApi {
  private readonly profiler = new FrameProfiler();
  private readonly guard = new MemoryIntegrityGuard();
  private readonly dumper = new CrashReportDumper();
  private readonly driver = new TauriSecurityDriver();

  public constructor(
    private readonly ctx: PluginContext,
  ) {}

  public beginSubsystemMetric(name: string): void {
    this.profiler.beginSubsystem(name);
  }

  public endSubsystemMetric(name: string): void {
    this.profiler.endSubsystem(name);
  }

  public getProfilerSnapshot(sampleCount?: number): SystemFrameMetric {
    return this.profiler.getProfilerSnapshot(sampleCount);
  }

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
        `Adulteração detectada na variável protegida: ${descriptor.id}`,
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
        invalidIds.push(descriptor.id);
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

  public async validateSystemClock(browserDeltaMs: number): Promise<boolean> {
    const result = await this.driver.validateSystemClock(browserDeltaMs);

    if (!result.valid) {
      this.emitSecurityAlert(
        "speedhack_detected",
        `Desvio de tempo detectado entre navegador e SO: ${browserDeltaMs}ms vs ${result.osDeltaMs}ms`,
      );
    }

    return result.valid;
  }

  public async dumpCrashReport(
    error: Error | string,
  ): Promise<CrashReportPayload> {
    const report = this.dumper.generateReport(error);

    await this.driver.writeCrashDump(report);

    this.ctx.events.emit(
      CrashReportGeneratedEvent.type,
      report,
    );

    return report;
  }

  public update(deltaSeconds: number): void {
    this.profiler.updateFrame(deltaSeconds);
  }

  public clear(): void {
    this.profiler.clear();
    this.guard.rotateKey();
  }

  private emitSecurityAlert(
    violationType: "memory_tampering" | "speedhack_detected" | "checksum_mismatch",
    details: string,
  ): void {
    this.ctx.events.emit(
      SecurityAlertEvent.type,
      {
        violationType,
        details,
        timestamp: Date.now(),
      },
    );
  }
}

export function createSecurityPlugin(): Plugin {
  return {
    manifest: securityManifest,

    setup(ctx: PluginContext): void {
      const securityService = new SecurityService(ctx);

      ctx.caps.provide(
        SecurityToken,
        securityService,
      );

      ctx.events.define(SecurityAlertEvent);
      ctx.events.define(CrashReportGeneratedEvent);

      ctx.commands.define(CaptureFrameMetricsCommand);
      ctx.commands.define(ValidateMemoryIntegrityCommand);
      ctx.commands.define(DumpCrashReportCommand);

      const unbindTick = ctx.events.on(
        "game.loop.tick",
        (envelope): void => {
          const payload = envelope.payload as GameTickPayload;
          securityService.update(payload.deltaSeconds);
        },
      );

      const unbindCapture = ctx.commands.handle(
        CaptureFrameMetricsCommand.type,
        (envelope): SystemFrameMetric => {
          const payload = envelope.payload as CaptureFrameMetricsPayload;
          return securityService.getProfilerSnapshot(payload.sampleCount);
        },
      );

      const unbindValidate = ctx.commands.handle(
        ValidateMemoryIntegrityCommand.type,
        (envelope): boolean => {
          const payload = envelope.payload as ValidateMemoryIntegrityPayload;
          return securityService.validateMemoryIntegrity(payload.descriptors);
        },
      );

      const unbindDump = ctx.commands.handle(
        DumpCrashReportCommand.type,
        (envelope): Promise<CrashReportPayload> => {
          const payload = envelope.payload as DumpCrashReportPayload;
          return securityService.dumpCrashReport(payload.error);
        },
      );

      ctx.lifecycle.onDispose((): void => {
        unbindTick();
        unbindCapture();
        unbindValidate();
        unbindDump();

        securityService.clear();
      });

      ctx.lifecycle.ready();
    },
  };
}
