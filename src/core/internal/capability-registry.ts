import { KernelError } from "../contracts/errors";
import type {
  CapabilityProvision,
  CapabilityRequirement,
} from "../contracts/capability-token";
import type { PluginKind } from "../contracts/plugin-kind";
import { satisfies } from "./semver";

interface Provider {
  readonly pluginId: string;
  readonly kind: PluginKind;
  readonly provision: CapabilityProvision;
  value: unknown;
  hasValue: boolean;
}

interface RequirementRecord {
  readonly pluginId: string;
  readonly kind: PluginKind;
  readonly requirement: CapabilityRequirement;
}

export interface Binding {
  readonly requirement: CapabilityRequirement;
  readonly provider: Provider | undefined;
}

export interface SnapshotDiff {
  readonly provided: readonly string[];
  readonly replaced: readonly string[];
  readonly removed: readonly string[];
}

export interface CapabilityRegistryOptions {
  /**
   * Se `true`, um plugin internal/preloaded pode consumir capability
   * provida por external. Default `false`.
   */
  readonly allowInternalConsumeExternal?: boolean;
}

export class CapabilityRegistry {
  private readonly byCapability = new Map<string, Provider[]>();
  private readonly provisionsOf = new Map<string, CapabilityProvision[]>();
  private readonly requirementsOf = new Map<string, RequirementRecord[]>();
  private readonly policy: { allowInternalConsumeExternal: boolean };

  constructor(opts: CapabilityRegistryOptions = {}) {
    this.policy = {
      allowInternalConsumeExternal: opts.allowInternalConsumeExternal ?? false,
    };
  }

  declareProvider(
    pluginId: string,
    kind: PluginKind,
    provision: CapabilityProvision,
  ): void {
    const list = this.byCapability.get(provision.id) ?? [];
    const filtered = list.filter((p) => p.pluginId !== pluginId);
    filtered.push({ pluginId, kind, provision, value: undefined, hasValue: false });
    filtered.sort((a, b) => (b.provision.priority ?? 0) - (a.provision.priority ?? 0));
    this.byCapability.set(provision.id, filtered);

    const own = this.provisionsOf.get(pluginId) ?? [];
    own.push(provision);
    this.provisionsOf.set(pluginId, own);
  }

  declareRequirement(
    pluginId: string,
    kind: PluginKind,
    requirement: CapabilityRequirement,
  ): void {
    const own = this.requirementsOf.get(pluginId) ?? [];
    own.push({ pluginId, kind, requirement });
    this.requirementsOf.set(pluginId, own);
  }

  resolveFor(pluginId: string): Binding[] {
    const reqs = this.requirementsOf.get(pluginId) ?? [];
    return reqs.map(({ requirement, kind }) => {
      const all = (this.byCapability.get(requirement.id) ?? []).filter((p) =>
        satisfies(p.provision.version, requirement.range),
      );
      const eligible = all.filter((p) => this.canConsume(kind, p.kind));

      if (eligible.length === 0) {
        if (all.length > 0) {
          throw new KernelError(
            "PLUGIN_KIND_MISMATCH",
            `plugin "${pluginId}" (${kind}) requer "${requirement.id}@${requirement.range}" mas só há providers de camada proibida (${[
              ...new Set(all.map((p) => p.kind)),
            ].join(", ")})`,
            {
              pluginId,
              consumerKind: kind,
              capabilityId: requirement.id,
              providers: all.map((p) => ({ id: p.pluginId, kind: p.kind })),
            },
          );
        }
        if (requirement.optional) return { requirement, provider: undefined };
        throw new KernelError(
          "CAPABILITY_MISSING",
          `plugin "${pluginId}" requer capability "${requirement.id}@${requirement.range}" e nenhum provider satisfaz`,
          { pluginId, capabilityId: requirement.id, range: requirement.range },
        );
      }

      const top = eligible[0]!.provision.priority ?? 0;
      const topCount = eligible.filter(
        (p) => (p.provision.priority ?? 0) === top,
      ).length;
      if (topCount > 1) {
        throw new KernelError(
          "CAPABILITY_AMBIGUOUS",
          `múltiplos providers para "${requirement.id}@${requirement.range}": ${eligible
            .map((p) => p.pluginId)
            .join(", ")}`,
          {
            pluginId,
            capabilityId: requirement.id,
            providers: eligible.map((p) => p.pluginId),
          },
        );
      }
      return { requirement, provider: eligible[0] };
    });
  }

  private canConsume(fromKind: PluginKind, toKind: PluginKind): boolean {
    if (fromKind === "external") return true;
    if (this.policy.allowInternalConsumeExternal) return true;
    return toKind !== "external";
  }

  attachValue(pluginId: string, capabilityId: string, value: unknown): void {
    const list = this.byCapability.get(capabilityId);
    if (!list) {
      throw new KernelError(
        "CAPABILITY_MISSING",
        `plugin "${pluginId}" chamou ctx.caps.provide("${capabilityId}") mas nenhum plugin declarou provides para essa capability`,
      );
    }
    const found = list.find((p) => p.pluginId === pluginId);
    if (!found) {
      throw new KernelError(
        "CAPABILITY_MISSING",
        `plugin "${pluginId}" chamou ctx.caps.provide("${capabilityId}") mas não declarou esse provides no manifest`,
        { pluginId, capabilityId },
      );
    }
    found.value = value;
    found.hasValue = true;
  }

  hasValue(pluginId: string, capabilityId: string): boolean {
    const list = this.byCapability.get(capabilityId);
    if (!list) return false;
    const found = list.find((p) => p.pluginId === pluginId);
    return found !== undefined && found.hasValue;
  }

  pendingProvisionsOf(pluginId: string): readonly string[] {
    const provisions = this.provisionsOf.get(pluginId) ?? [];
    return provisions
      .filter((p) => !this.hasValue(pluginId, p.id))
      .map((p) => p.id);
  }

  detachProvider(pluginId: string): void {
    for (const [capId, list] of this.byCapability) {
      const filtered = list.filter((p) => p.pluginId !== pluginId);
      if (filtered.length === 0) this.byCapability.delete(capId);
      else this.byCapability.set(capId, filtered);
    }
    this.provisionsOf.delete(pluginId);
    this.requirementsOf.delete(pluginId);
  }

  providersOf(capabilityId: string): readonly Provider[] {
    return this.byCapability.get(capabilityId) ?? [];
  }

  allCapabilityIds(): string[] {
    return [...this.byCapability.keys()];
  }

  // ────────────────────────── replace ──────────────────────────

  snapshotValues(pluginId: string): ReadonlyMap<string, unknown> {
    const out = new Map<string, unknown>();
    for (const [capId, list] of this.byCapability) {
      for (const p of list) {
        if (p.pluginId === pluginId && p.hasValue) {
          out.set(capId, p.value);
        }
      }
    }
    return out;
  }

  restoreValues(
    pluginId: string,
    kind: PluginKind,
    provisions: readonly CapabilityProvision[],
    values: ReadonlyMap<string, unknown>,
  ): void {
    for (const p of provisions) this.declareProvider(pluginId, kind, p);
    for (const [capId, val] of values) {
      try {
        this.attachValue(pluginId, capId, val);
      } catch {
        /* best-effort */
      }
    }
  }

  diffSnapshots(
    before: ReadonlyMap<string, unknown>,
    after: ReadonlyMap<string, unknown>,
  ): SnapshotDiff {
    const replaced: string[] = [];
    const removed: string[] = [];
    for (const [id, val] of before) {
      if (!after.has(id)) removed.push(id);
      else if (after.get(id) !== val) replaced.push(id);
    }
    const provided: string[] = [];
    for (const id of after.keys()) if (!before.has(id)) provided.push(id);
    return { provided, replaced, removed };
  }
}