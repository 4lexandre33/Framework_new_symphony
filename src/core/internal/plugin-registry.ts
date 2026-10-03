import { KernelError } from "../contracts/errors";
import type { Plugin } from "../contracts/plugin-context";
import type { PluginManifest } from "../contracts/plugin-manifest";
import { PLUGIN_KINDS, type PluginKind } from "../contracts/plugin-kind";

export interface RegisteredPlugin {
  readonly plugin: Plugin;
  readonly manifest: PluginManifest;
  state: "registered" | "setup" | "started" | "disposed" | "failed";
  error?: unknown;
}

export class PluginRegistry {
  private readonly byId = new Map<string, RegisteredPlugin>();
  private readonly insertionOrder: string[] = [];

  register(plugin: Plugin): RegisteredPlugin {
    const { id } = plugin.manifest;
    if (this.byId.has(id)) {
      throw new KernelError("PLUGIN_DUPLICATE", `plugin "${id}" já registrado`);
    }
    const entry: RegisteredPlugin = {
      plugin,
      manifest: plugin.manifest,
      state: "registered",
    };
    this.byId.set(id, entry);
    this.insertionOrder.push(id);
    return entry;
  }

  unregister(id: string): RegisteredPlugin | undefined {
    const entry = this.byId.get(id);
    if (!entry) return undefined;
    this.byId.delete(id);
    const i = this.insertionOrder.indexOf(id);
    if (i >= 0) this.insertionOrder.splice(i, 1);
    return entry;
  }

  dependentsOf(id: string): readonly string[] {
    const out: string[] = [];
    for (const [otherId, entry] of this.byId) {
      if (otherId === id) continue;
      for (const dep of entry.manifest.dependsOn ?? []) {
        if (dep.id === id && !dep.optional) {
          out.push(otherId);
          break;
        }
      }
    }
    return out;
  }

  get(id: string): RegisteredPlugin | undefined {
    return this.byId.get(id);
  }

  mustGet(id: string): RegisteredPlugin {
    const p = this.byId.get(id);
    if (!p) throw new KernelError("PLUGIN_MISSING", `plugin "${id}" não encontrado`);
    return p;
  }

  all(): readonly RegisteredPlugin[] {
    return this.insertionOrder.map((id) => this.byId.get(id)!);
  }

  setState(id: string, state: RegisteredPlugin["state"], error?: unknown): void {
    const p = this.mustGet(id);
    p.state = state;
    if (error !== undefined) p.error = error;
  }
}

const KNOWN_KINDS = new Set<string>(PLUGIN_KINDS);

function assertKind(m: PluginManifest): PluginKind {
  const raw = (m as { kind?: unknown }).kind;
  if (typeof raw !== "string" || !KNOWN_KINDS.has(raw)) {
    throw new KernelError(
      "PLUGIN_MISSING",
      `manifest.kind ausente ou inválido em "${m.id}" (esperado: ${PLUGIN_KINDS.join(" | ")})`,
      { pluginId: m.id, received: raw },
    );
  }
  return raw as PluginKind;
}

export function assertManifestShape(m: PluginManifest): void {
  if (!m.id || !/^[a-z0-9][a-z0-9._-]*$/i.test(m.id)) {
    throw new KernelError("PLUGIN_MISSING", `manifest.id inválido: "${m.id}"`);
  }
  if (!m.version) {
    throw new KernelError("PLUGIN_MISSING", `manifest.version ausente em "${m.id}"`);
  }
  if (!m.name) {
    throw new KernelError("PLUGIN_MISSING", `manifest.name ausente em "${m.id}"`);
  }
  const kind = assertKind(m);

  if (kind !== "external" && m.sandbox !== undefined) {
    throw new KernelError(
      "PLUGIN_KIND_MISMATCH",
      `manifest.sandbox só é válido para kind "external" (plugin "${m.id}" é "${kind}")`,
      { pluginId: m.id, kind },
    );
  }

  if (kind === "external" && m.permissions === undefined) {
    throw new KernelError(
      "PLUGIN_MISSING",
      `plugin external "${m.id}" precisa declarar permissions`,
      { pluginId: m.id },
    );
  }
}