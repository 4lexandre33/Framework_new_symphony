import { KernelError } from "../contracts/errors";
import type { PluginManifest } from "../contracts/plugin-manifest";

/**
 * Regra de permissão de evento (G21).
 *
 * - `internal` / `preloaded`: campo `permissions.events` AUSENTE = sem
 *   restrição.
 * - `external`: campo ausente = sem permissão (deny-all).
 * - Lista presente (qualquer kind) = allow-list EXATA. Em particular
 *   `events: []` significa "este plugin não emite NENHUM evento" — NÃO é
 *   equivalente a omitir o campo. A decisão é deliberada: tratar `[]` como
 *   "sem restrição" alargaria permissões em silêncio. Para emitir, liste os
 *   tipos ou (internal/preloaded) remova o campo.
 * - Eventos `kernel.*` são emitidos pelo próprio kernel e não passam por aqui.
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
  const allow = manifest.permissions?.events;
  let hint: string;
  if (allow === undefined) {
    hint = `plugins "external" precisam declarar manifest.permissions.events; adicione "${type}"`;
  } else if (allow.length === 0) {
    hint =
      manifest.kind === "external"
        ? `manifest.permissions.events é [] (não emite nada); adicione "${type}"`
        : `manifest.permissions.events é [] (não emite nada — [] NÃO equivale a omitir); adicione "${type}" à lista ou remova o campo para emitir sem restrição`;
  } else {
    hint = `adicione "${type}" a manifest.permissions.events (hoje: ${allow.join(", ")})`;
  }
  throw new KernelError(
    "PERMISSION_DENIED",
    `plugin "${manifest.id}" (${manifest.kind}) não tem permissão para emitir "${type}": ${hint}`,
    {
      pluginId: manifest.id,
      kind: manifest.kind,
      eventType: type,
      declared: allow === undefined ? null : [...allow],
      hint,
    },
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