import { Kernel } from "../kernel";
import type { Plugin } from "../contracts/plugin-context";

export interface PluginConformanceReport {
  readonly pluginId: string;
  readonly started: boolean;
  readonly disposed: boolean;
  readonly leakedCapabilities: readonly string[];
  readonly leakedSlots: readonly string[];
}

/**
 * Smoke/conformance independente de Vitest. O teste do plugin pode chamar
 * isto e fazer expect(report...). Serve como contrato comum para os plugins
 * migrados do Lume.
 */
export async function checkPluginConformance(
  plugin: Plugin,
  opts: { readyTimeoutMs?: number; coreTokens?: readonly unknown[] } = {},
): Promise<PluginConformanceReport> {
  const kernel = new Kernel({ tolerant: false, readyTimeoutMs: opts.readyTimeoutMs ?? 1000 });
  if (opts.coreTokens) kernel.registerCoreTokens(opts.coreTokens);
  kernel.register(plugin);
  await kernel.boot();
  const before = kernel.inspect();
  const started = before.plugins.some((p) => p.id === plugin.manifest.id && p.state === "started");
  await kernel.disposePlugin(plugin.manifest.id);
  const after = kernel.inspect();
  const leakedCapabilities = after.capabilities
    .filter((c) => c.providers.some((p) => p.pluginId === plugin.manifest.id))
    .map((c) => c.id);
  const leakedSlots = after.slots.filter((s) => s.owner === plugin.manifest.id).map((s) => s.id);
  const disposed = after.plugins.some((p) => p.id === plugin.manifest.id && p.state === "disposed");
  await kernel.stop();
  return { pluginId: plugin.manifest.id, started, disposed, leakedCapabilities, leakedSlots };
}
