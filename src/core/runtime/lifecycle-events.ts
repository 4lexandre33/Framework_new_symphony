// src/core/runtime/lifecycle-events.ts
import type { KernelState } from "./state";
import { buildEventEnvelope } from "./pipeline";

/**
 * Emite um evento de sistema (kernel.*). Uma falha num handler de
 * sistema vira log — nunca rejeição.
 */
export async function emitLifecycle(
  state: KernelState,
  type: string,
  payload: unknown,
): Promise<void> {
  const env = buildEventEnvelope(state, type, payload, "kernel");
  try {
    await state.events.emitAsync(env);
  } catch {
    /* sistema nunca derruba o kernel */
  }
}

/**
 * Conveniência: `kernel.capability.changed`.
 */
export async function emitCapabilityChanged(
  state: KernelState,
  capabilityId: string,
  pluginId: string,
  reason: "provided" | "replaced" | "removed",
): Promise<void> {
  await emitLifecycle(state, "kernel.capability.changed", {
    capabilityId,
    pluginId,
    reason,
    version: "1.0.0",
  });
}