import { KernelError } from "../contracts/errors";
import type { PluginManifest } from "../contracts/plugin-manifest";
import { canDependOn, kindRank } from "../contracts/plugin-kind";
import { satisfies } from "./semver";

/**
 * Ordena manifests por dependência (topological sort), respeitando a
 * camada (`PluginKind`): internal → preloaded → external.
 *
 * Regras:
 * - `internal` não depende de `preloaded` nem de `external`.
 * - `preloaded` não depende de `external`.
 * - `external` pode depender de qualquer camada.
 * - Dependência opcional ausente é ignorada.
 * - Ciclos lançam PLUGIN_CYCLE.
 */
export function computeBootOrder(manifests: readonly PluginManifest[]): PluginManifest[] {
  const byId = new Map(manifests.map((m) => [m.id, m]));
  const order: PluginManifest[] = [];
  const state = new Map<string, "visiting" | "done">();

  // Partição estável por camada: independentes saem em ordem de camada.
  const sorted = [...manifests].sort(
    (a, b) => kindRank(a.kind) - kindRank(b.kind),
  );

  function visit(m: PluginManifest, stack: string[]) {
    if (state.get(m.id) === "done") return;
    if (state.get(m.id) === "visiting") {
      throw new KernelError(
        "PLUGIN_CYCLE",
        `ciclo detectado: ${[...stack, m.id].join(" -> ")}`,
        { cycle: [...stack, m.id] },
      );
    }
    state.set(m.id, "visiting");
    for (const dep of m.dependsOn ?? []) {
      const target = byId.get(dep.id);
      if (!target) {
        if (dep.optional) continue;
        throw new KernelError(
          "PLUGIN_MISSING",
          `plugin "${m.id}" depende de "${dep.id}" que não foi registrado`,
          { from: m.id, missing: dep.id },
        );
      }
      if (!canDependOn(m.kind, target.kind)) {
        throw new KernelError(
          "PLUGIN_KIND_MISMATCH",
          `plugin "${m.id}" (${m.kind}) não pode depender de "${dep.id}" (${target.kind}); camadas mais internas não dependem de mais externas`,
          {
            from: m.id,
            fromKind: m.kind,
            to: dep.id,
            toKind: target.kind,
          },
        );
      }
      if (!satisfies(target.version, dep.range)) {
        throw new KernelError(
          "CAPABILITY_VERSION_MISMATCH",
          `plugin "${m.id}" requer "${dep.id}@${dep.range}", mas encontrou ${target.version}`,
          { from: m.id, required: dep.range, found: target.version },
        );
      }
      visit(target, [...stack, m.id]);
    }
    state.set(m.id, "done");
    order.push(m);
  }

  for (const m of sorted) visit(m, []);
  return order;
}