/**
 * Camada do plugin. Determina:
 * - a ordem de boot (internal → preloaded → external);
 * - quem pode depender de quem (`canDependOn`);
 * - o que é permitido sem política explícita (internal/preloaded não
 *   consomem de external).
 */
export type PluginKind = "internal" | "preloaded" | "external";

export const PLUGIN_KINDS: readonly PluginKind[] = [
  "internal",
  "preloaded",
  "external",
] as const;

/** Menor rank = boota primeiro. */
const RANK: Readonly<Record<PluginKind, number>> = {
  internal: 0,
  preloaded: 1,
  external: 2,
};

export function kindRank(kind: PluginKind): number {
  return RANK[kind];
}

/**
 * `from` pode depender de `to`?
 * Uma camada só depende de si mesma ou de camadas mais internas:
 *   internal  → internal
 *   preloaded → internal, preloaded
 *   external  → internal, preloaded, external
 */
export function canDependOn(from: PluginKind, to: PluginKind): boolean {
  return kindRank(to) <= kindRank(from);
}

export function isExternal(kind: PluginKind): boolean {
  return kind === "external";
}