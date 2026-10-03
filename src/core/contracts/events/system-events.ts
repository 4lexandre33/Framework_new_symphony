import { defineEvent } from "../typed-event";
import type { Schema } from "../schema";

/**
 * Eventos emitidos pelo próprio kernel. Tipos ficam reservados sob o
 * prefixo "kernel.".
 *
 * O kernel não exige schema para eles, mas expõe definições para que
 * plugins possam tipar seus handlers e para que devtools os listem.
 */

const noSchema: Schema<unknown> | undefined = undefined;

export const KernelPluginSetupStart = defineEvent<
  "kernel.plugin.setup.start",
  { pluginId: string }
>("kernel.plugin.setup.start", {
  description: "Emitido imediatamente antes de `plugin.setup(ctx)`.",
  ...(noSchema ? { schema: noSchema } : {}),
});

export const KernelPluginSetupDone = defineEvent<
  "kernel.plugin.setup.done",
  { pluginId: string }
>("kernel.plugin.setup.done", {
  description: "Emitido após `plugin.setup(ctx)` retornar sem erro.",
});

export const KernelPluginSetupFailed = defineEvent<
  "kernel.plugin.setup.failed",
  { pluginId: string; error: string }
>("kernel.plugin.setup.failed", {
  description: "Emitido quando `plugin.setup(ctx)` lança.",
});

export const KernelPluginStarted = defineEvent<
  "kernel.plugin.started",
  { pluginId: string }
>("kernel.plugin.started", {
  description: "Emitido quando o plugin transita para `started`.",
});

export const KernelPluginDisposed = defineEvent<
  "kernel.plugin.disposed",
  { pluginId: string }
>("kernel.plugin.disposed", {
  description: "Emitido após o plugin ser descartado.",
});

export const KernelPluginConfigFailed = defineEvent<
  "kernel.plugin.config.failed",
  { pluginId: string; error: string }
>("kernel.plugin.config.failed", {
  description: "Emitido quando o `configSchema.parse` falha.",
});

export const KernelPluginResolveFailed = defineEvent<
  "kernel.plugin.resolve.failed",
  { pluginId: string; error: string }
>("kernel.plugin.resolve.failed", {
  description: "Emitido quando a resolução de capabilities do plugin falha.",
});

export const KernelPluginReadyTimeout = defineEvent<
  "kernel.plugin.ready.timeout",
  { pluginId: string }
>("kernel.plugin.ready.timeout", {
  description: "Emitido para cada plugin que não chamou `ctx.lifecycle.ready()` a tempo.",
});

export const KernelPluginReplaced = defineEvent<
  "kernel.plugin.replaced",
  { pluginId: string; oldVersion: string; newVersion: string }
>("kernel.plugin.replaced", {
  description:
    "Emitido após um plugin ser substituído por outro de mesmo id via `kernel.replace()`.",
});

export const KernelCapabilityChanged = defineEvent<
  "kernel.capability.changed",
  {
    capabilityId: string;
    pluginId: string;
    reason: "provided" | "replaced" | "removed";
    version: string;
  }
>("kernel.capability.changed", {
  description:
    "Emitido quando uma capability tem seu valor anexado (`provided`), substituído (`replaced`) ou removido (`removed`).",
});

export const KernelBooted = defineEvent<
  "kernel.booted",
  { plugins: readonly string[]; order: readonly string[] }
>("kernel.booted", {
  description: "Emitido após o boot completar com sucesso.",
});

export const KernelStopping = defineEvent<"kernel.stopping", Record<string, never>>(
  "kernel.stopping",
  { description: "Emitido imediatamente antes de `stop()`." },
);

export const KernelStopped = defineEvent<"kernel.stopped", Record<string, never>>(
  "kernel.stopped",
  { description: "Emitido após `stop()` completar." },
);

export const SYSTEM_EVENTS = [
  KernelPluginSetupStart,
  KernelPluginSetupDone,
  KernelPluginSetupFailed,
  KernelPluginStarted,
  KernelPluginDisposed,
  KernelPluginConfigFailed,
  KernelPluginResolveFailed,
  KernelPluginReadyTimeout,
  KernelPluginReplaced,
  KernelCapabilityChanged,
  KernelBooted,
  KernelStopping,
  KernelStopped,
] as const;