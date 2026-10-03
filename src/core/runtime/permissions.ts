import { KernelError } from "../contracts/errors";
import type { PluginManifest } from "../contracts/plugin-manifest";

/**
 * Regra de permissão de evento.
 *
 * - `internal` / `preloaded`: sem `permissions.events` = sem restrição.
 * - `external`: sem `permissions.events` = sem permissão (deny-all).
 */
export function canEmit(manifest: PluginManifest, type: string): boolean {
  const allow = manifest.permissions?.events;
  if (manifest.kind === "external") {
    return Array.isArray(allow) && allow.includes(type);
  }
  if (!allow) return true;
  return allow.includes(type);
}

/**
 * Regra de permissão de capability.
 *
 * - `internal` / `preloaded`: sem `permissions.capabilities` = sem restrição.
 * - `external`: sem `permissions.capabilities` = sem permissão (deny-all).
 */
export function canUseCapability(
  manifest: PluginManifest,
  capabilityId: string,
): boolean {
  const allow = manifest.permissions?.capabilities;
  if (manifest.kind === "external") {
    return Array.isArray(allow) && allow.includes(capabilityId);
  }
  if (!allow) return true;
  return allow.includes(capabilityId);
}

export function assertCanEmit(manifest: PluginManifest, type: string): void {
  if (canEmit(manifest, type)) return;
  throw new KernelError(
    "PERMISSION_DENIED",
    `plugin "${manifest.id}" (${manifest.kind}) não tem permissão para emitir "${type}"`,
    { pluginId: manifest.id, kind: manifest.kind, eventType: type },
  );
}

export function assertCanUseCapability(
  manifest: PluginManifest,
  capabilityId: string,
): void {
  if (canUseCapability(manifest, capabilityId)) return;
  throw new KernelError(
    "PERMISSION_DENIED",
    `plugin "${manifest.id}" (${manifest.kind}) não tem permissão para acessar "${capabilityId}"`,
    { pluginId: manifest.id, kind: manifest.kind, capabilityId },
  );
}