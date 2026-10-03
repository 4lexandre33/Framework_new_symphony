// src/core/internal/plugin-storage.ts
import type { PluginStorage } from "../contracts/plugin-storage";
import type { PluginManifest } from "../contracts/plugin-manifest";

/**
 * Storage isolado por plugin. Cada instância tem seu próprio Map — nada
 * atravessa a fronteira do plugin. Sem persistência por default; isso
 * é responsabilidade do host (via `StorageToken`).
 */
export function createPluginStorage(): PluginStorage {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
    clear: () => {
      map.clear();
    },
  };
}

/**
 * Variante read-only. `set`/`remove`/`clear` lançam. Usada quando o
 * manifest declara `permissions.storage: "read"`.
 */
export function createReadOnlyStorage(): PluginStorage {
  const map = new Map<string, string>();
  const deny = (): never => {
    throw new Error("storage é read-only para este plugin");
  };
  return {
    get: (key) => map.get(key) ?? null,
    set: deny,
    remove: deny,
    clear: deny,
  };
}

/**
 * Variante no-op. Usada quando o plugin não tem permissão de storage:
 *   - `permissions.storage: "none"` em internal/preloaded;
 *   - `kind: "external"` sem `permissions.storage` declarado (deny-all).
 */
export function createNoopStorage(): PluginStorage {
  return {
    get: () => null,
    set: () => {},
    remove: () => {},
    clear: () => {},
  };
}

// CHANGED: nova função — decide a variante conforme o manifest. Era o
// elo que faltava: as três fábricas existiam, mas ninguém as escolhia.
/**
 * Escolhe a implementação conforme `manifest.permissions.storage` e
 * `manifest.kind`. Espelha as regras de `runtime/permissions.ts`:
 *
 *   - `kind: "external"` sem `permissions.storage`: deny-all → no-op.
 *   - `"none"`: no-op.
 *   - `"read"`: leitura apenas.
 *   - `"write"` ou ausente em internal/preloaded: leitura+escrita.
 */
export function createStorageForManifest(
  manifest: PluginManifest,
): PluginStorage {
  const mode = manifest.permissions?.storage;
  if (manifest.kind === "external" && mode === undefined) {
    return createNoopStorage();
  }
  if (mode === "none") return createNoopStorage();
  if (mode === "read") return createReadOnlyStorage();
  return createPluginStorage();
}