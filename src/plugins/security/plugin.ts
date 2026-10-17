import { defineConfig, type Plugin, type PluginContext } from "@core";
import { SecurityToken } from "../../tokens/security";
import { WorldToken } from "../../tokens/world";
import { RenderToken } from "../../tokens/render";
import type { GameTickPayload } from "../../contracts/game-loop/types";
import type { HandlerErrorEventPayload } from "@core";
import { CaptureFrameMetricsCommand, CrashReportGeneratedEvent, DumpCrashReportCommand, SecurityAlertEvent, ValidateMemoryIntegrityCommand, type CaptureFrameMetricsPayload, type CrashReportPayload, type DumpCrashReportPayload, type SystemFrameMetric, type ValidateMemoryIntegrityPayload } from "../../contracts/security/types";
import { SecurityService } from "../../engine/security/internal/SecurityService";
import { readRendererName } from "../../engine/security/internal/CrashReportDumper";

export interface SecurityPluginConfig extends Record<string, unknown> {
  /** G16: captura automática de erros. `false` = opt-out. */
  readonly crashCapture: boolean;
  readonly maxCrashDumpsPerSession: number;
  readonly maxCrashDumpFiles: number;
  /** Subpasta em crash-dumps/ ("" = nenhuma; a pasta de logs já é por jogo). */
  readonly crashNamespace: string;
  /** G114: detecção automática de speedhack. `false` = opt-out. */
  readonly speedhackDetection: boolean;
  readonly speedhackWindowMs: number;
  readonly speedhackTolerance: number;
}

const SECURITY_DEFAULTS: SecurityPluginConfig = {
  crashCapture: true,
  maxCrashDumpsPerSession: 10,
  maxCrashDumpFiles: 20,
  crashNamespace: "",
  speedhackDetection: true,
  speedhackWindowMs: 2000,
  speedhackTolerance: 0.25,
};

export const securityConfigSchema = defineConfig<SecurityPluginConfig>({
  defaults: SECURITY_DEFAULTS,
  parse(raw: unknown): SecurityPluginConfig {
    const input = (raw ?? {}) as Partial<Record<keyof SecurityPluginConfig, unknown>>;
    const bool = (k: "crashCapture" | "speedhackDetection"): boolean =>
      typeof input[k] === "boolean" ? (input[k] as boolean) : SECURITY_DEFAULTS[k];
    const num = (k: "maxCrashDumpsPerSession" | "maxCrashDumpFiles" | "speedhackWindowMs" | "speedhackTolerance", min: number, max: number): number => {
      const v = input[k];
      if (v === undefined) return SECURITY_DEFAULTS[k];
      if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
        throw new Error(`game.security: config "${k}" deve ser número em [${min}, ${max}]`);
      }
      return v;
    };
    const ns = input.crashNamespace ?? "";
    if (typeof ns !== "string" || (ns !== "" && !/^[A-Za-z0-9_-]{1,64}$/u.test(ns))) {
      throw new Error('game.security: config "crashNamespace" deve casar [A-Za-z0-9_-]{1,64}');
    }
    return {
      crashCapture: bool("crashCapture"),
      maxCrashDumpsPerSession: num("maxCrashDumpsPerSession", 0, 1000),
      maxCrashDumpFiles: num("maxCrashDumpFiles", 1, 200),
      crashNamespace: ns,
      speedhackDetection: bool("speedhackDetection"),
      speedhackWindowMs: num("speedhackWindowMs", 250, 600_000),
      speedhackTolerance: num("speedhackTolerance", 0.01, 10),
    };
  },
});

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
    // Opcionais (G115): cena ativa no crash dump e nome da GPU a partir do
    // contexto WebGL já existente do render.
    {
      id: "game.world",
      range: "^1.0.0",
      optional: true,
    },
    {
      id: "game.render",
      range: "^1.0.0",
      optional: true,
    },
  ],

  permissions: {
    capabilities: [SecurityToken.id, WorldToken.id, RenderToken.id],
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
    consumes: [
      { id: WorldToken.id, range: "^1.0.0", optional: true },
      { id: RenderToken.id, range: "^1.0.0", optional: true },
    ],
    conflicts: [],
  },

  configSchema: securityConfigSchema as unknown as NonNullable<Plugin["manifest"]["configSchema"]>,
};

export function createSecurityPlugin(): Plugin {
  return {
    manifest: securityManifest,

    setup(ctx: PluginContext): void {
      const config = { ...SECURITY_DEFAULTS, ...(ctx.config as Partial<SecurityPluginConfig>) };
      let cachedRenderer: string | undefined;

      const securityService = new SecurityService(ctx, {
        crashCapture: config.crashCapture,
        maxCrashDumpsPerSession: config.maxCrashDumpsPerSession,
        maxCrashDumpFiles: config.maxCrashDumpFiles,
        crashNamespace: config.crashNamespace === "" ? undefined : config.crashNamespace,
        speedhackDetection: config.speedhackDetection,
        speedhackWindowMs: config.speedhackWindowMs,
        speedhackTolerance: config.speedhackTolerance,
        sceneIdProvider: () => ctx.caps.get(WorldToken)?.currentSceneId ?? undefined,
        rendererNameProvider: () => {
          if (cachedRenderer !== undefined) return cachedRenderer;
          // Lê do contexto JÁ existente do render (nunca cria um novo).
          const renderer = ctx.caps.get(RenderToken)?.getRenderer?.();
          cachedRenderer = readRendererName(renderer?.getContext?.());
          return cachedRenderer;
        },
      });

      ctx.caps.provide(
        SecurityToken,
        securityService,
      );

      ctx.events.define(SecurityAlertEvent);
      ctx.events.define(CrashReportGeneratedEvent);

      ctx.commands.define(CaptureFrameMetricsCommand);
      ctx.commands.define(ValidateMemoryIntegrityCommand);
      ctx.commands.define(DumpCrashReportCommand);

      // Tick (delta simulado) → speedhack. Render (tempo real) → profiler.
      const unbindTick = ctx.events.on(
        "game.loop.tick",
        (envelope): void => {
          const payload = envelope.payload as GameTickPayload;
          securityService.update(payload.deltaSeconds);
        },
      );

      const unbindRender = ctx.events.on("game.loop.render", (): void => {
        securityService.recordFrame();
      });

      // G16: falhas de handlers do kernel também viram crash report.
      const unbindHandlerError = ctx.events.on("kernel.handler.error", (envelope): void => {
        securityService.captureHandlerError(envelope.payload as HandlerErrorEventPayload);
      });

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
        unbindRender();
        unbindHandlerError();
        unbindCapture();
        unbindValidate();
        unbindDump();

        securityService.dispose();
        securityService.clear();
      });

      ctx.lifecycle.ready();
    },
  };
}
