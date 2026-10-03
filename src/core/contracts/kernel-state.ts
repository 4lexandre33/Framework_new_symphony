import type { PluginKind } from "./plugin-kind";

export type KernelStatus =
  | "idle"
  | "booting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed";

export interface KernelPluginSnapshot {
  readonly id: string;
  readonly version: string;
  readonly kind: PluginKind;
  readonly state: "registered" | "setup" | "started" | "disposed" | "failed";
  readonly error?: string;
}

export interface KernelState {
  readonly status: KernelStatus;
  readonly plugins: readonly KernelPluginSnapshot[];
  readonly pendingPlugins: readonly string[];
  readonly bootOrder: readonly string[];
}