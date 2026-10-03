import type { Kernel } from "../kernel";
import type { SlotDescriptor } from "../contracts/slot";
import type { PluginKind } from "../contracts/plugin-kind";
import { KERNEL_API_VERSION } from "../contracts/kernel-version";
import type { KernelOptions } from "../kernel-types";

export interface KernelInspectionPlugin {
  readonly id: string;
  readonly version: string;
  readonly kind: PluginKind;
  readonly state: string;
  readonly provides: readonly string[];
  readonly consumes: readonly string[];
  readonly definesSlots: readonly string[];
  readonly contributesTo: readonly string[];
  readonly error?: string;
}

export interface KernelInspectionCapability {
  readonly id: string;
  readonly providers: readonly {
    pluginId: string;
    kind: PluginKind;
    version: string;
    priority: number;
  }[];
  readonly consumedBy: readonly string[];
}

export interface KernelInspection {
  readonly status: string;
  readonly apiVersion: string;
  readonly bootOrder: readonly string[];
  readonly pendingPlugins: readonly string[];
  readonly options: KernelOptions;
  readonly plugins: readonly KernelInspectionPlugin[];
  readonly capabilities: readonly KernelInspectionCapability[];
  readonly slots: readonly SlotDescriptor[];
}

export function inspect(kernel: Kernel): KernelInspection {
  const snap = kernel.snapshot();
  const internal = kernel.__internal();
  const registry = internal.registry;
  const capabilities = internal.capabilities;
  const slots = internal.slots;

  const capabilityIds = capabilities.allCapabilityIds();

  return {
    status: snap.status,
    apiVersion: KERNEL_API_VERSION,
    bootOrder: snap.bootOrder,
    pendingPlugins: snap.pendingPlugins,
    options: internal.options,
    plugins: snap.plugins.map((p) => {
      const entry = registry.mustGet(p.id);
      const m = entry.manifest;
      return {
        id: p.id,
        version: p.version,
        kind: p.kind,
        state: p.state,
        provides: (m.capabilities?.provides ?? []).map((x) => `${x.id}@${x.version}`),
        consumes: (m.capabilities?.consumes ?? []).map(
          (x) => `${x.id}@${x.range}${x.optional ? "?" : ""}`,
        ),
        definesSlots: (m.definesSlots ?? []).map((x) => x.id),
        contributesTo: (m.contributesTo ?? []).map((x) => x.slot),
        error: entry.error ? String(entry.error) : undefined,
      };
    }),
    capabilities: capabilityIds.map((id) => ({
      id,
      providers: capabilities.providersOf(id).map((p) => ({
        pluginId: p.pluginId,
        kind: p.kind,
        version: p.provision.version,
        priority: p.provision.priority ?? 0,
      })),
      consumedBy: snap.plugins
        .filter((p) =>
          registry
            .mustGet(p.id)
            .manifest.capabilities?.consumes?.some((c) => c.id === id),
        )
        .map((p) => p.id),
    })),
    slots: slots.list(),
  };
}