import type { Plugin, PluginContext } from "@core";
import { SecurityToken } from "../../tokens/security";
import type { GameTickPayload } from "../../contracts/game-loop/types";
import { CaptureFrameMetricsCommand, CrashReportGeneratedEvent, DumpCrashReportCommand, SecurityAlertEvent, ValidateMemoryIntegrityCommand, type CaptureFrameMetricsPayload, type CrashReportPayload, type DumpCrashReportPayload, type SystemFrameMetric, type ValidateMemoryIntegrityPayload } from "../../contracts/security/types";
import { SecurityService } from "../../engine/security/internal/SecurityService";

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
    conflicts: [],
  },
};

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