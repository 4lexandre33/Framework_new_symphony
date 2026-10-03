import { KernelError } from "../contracts/errors";
import type { Plugin } from "../contracts/plugin-context";
import { KERNEL_API_VERSION } from "../contracts/kernel-version";
import { satisfies } from "../internal/semver";
import { assertManifestShape } from "../internal/plugin-registry";
import { trackDisposer } from "./context";
import type { KernelState } from "./state";

/**
 * Regista um plugin. NUNCA chama setup — isso é `runtime/boot.ts` ou
 * `runtime/replace.ts`.
 *
 * `kind: "external"` não pode ser registado aqui — external só entra pelo
 * `plugin-host`.
 */
export function register(state: KernelState, plugin: Plugin): void {
  const id = plugin.manifest.id;

  if (!state.allowLateRegistration && state.status !== "idle") {
    throw new KernelError(
      "PLUGIN_REGISTERED_AFTER_BOOT",
      `register("${id}") após boot é rejeitado (allowLateRegistration=false)`,
      { pluginId: id, status: state.status },
    );
  }

  assertManifestShape(plugin.manifest);

  if (plugin.manifest.kind === "external") {
    throw new KernelError(
      "PLUGIN_KIND_MISMATCH",
      `plugin "${id}" é external e não pode ser registado diretamente; use o plugin-host`,
      { pluginId: id, kind: "external" },
    );
  }

  if (
    plugin.manifest.api &&
    !satisfies(KERNEL_API_VERSION, plugin.manifest.api)
  ) {
    throw new KernelError(
      "PLUGIN_API_MISMATCH",
      `plugin "${id}" requer kernel api "${plugin.manifest.api}", atual ${KERNEL_API_VERSION}`,
      { pluginId: id, required: plugin.manifest.api, current: KERNEL_API_VERSION },
    );
  }

  state.registry.register(plugin);

  const kind = plugin.manifest.kind;
  for (const prov of plugin.manifest.capabilities?.provides ?? []) {
    state.capabilities.declareProvider(id, kind, prov);
  }
  for (const req of plugin.manifest.capabilities?.consumes ?? []) {
    state.capabilities.declareRequirement(id, kind, req);
  }
  for (const slot of plugin.manifest.definesSlots ?? []) {
    const dispose = state.slots.define({ ...slot, owner: id });
    trackDisposer(state, id, dispose);
  }

  state.readiness.markPending(id);
}