import type {
  KernelState as KernelStatePublic,
  KernelPluginSnapshot,
} from "../contracts/kernel-state";
import type { KernelState } from "./state";

export function snapshot(state: KernelState): KernelStatePublic {
  return {
    status: state.status,
    bootOrder: [...state.bootOrder],
    pendingPlugins: [...state.readiness.pendingList()],
    plugins: state.registry.all().map<KernelPluginSnapshot>((p) => ({
      id: p.manifest.id,
      version: p.manifest.version,
      kind: p.manifest.kind,
      state: p.state,
      error: p.error ? String(p.error) : undefined,
    })),
  };
}