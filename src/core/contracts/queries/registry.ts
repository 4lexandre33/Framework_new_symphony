import { KernelError } from "../errors";
import type { Schema } from "../schema";

export interface QueryDefinition<T extends string = string, P = unknown, R = unknown> {
  readonly type: T;
  readonly __payload?: P;
  readonly __result?: R;
  readonly schema?: Schema<P>;
  readonly resultSchema?: Schema<R>;
  readonly description?: string;
}

export function defineQuery<T extends string, P = unknown, R = unknown>(
  type: T,
  opts?: {
    schema?: Schema<P>;
    resultSchema?: Schema<R>;
    description?: string;
  },
): QueryDefinition<T, P, R> {
  return { type, ...(opts ?? {}) } as QueryDefinition<T, P, R>;
}

interface OwnedDefinition {
  readonly owner: string;
  readonly def: QueryDefinition;
}

export class QueryRegistry {
  private readonly entries = new Map<string, OwnedDefinition>();

  define(owner: string, def: QueryDefinition): void {
    const existing = this.entries.get(def.type);
    if (existing) {
      throw new KernelError(
        "REGISTRY_DUPLICATE",
        `query "${def.type}" já registrada por "${existing.owner}"`,
        { type: def.type, owner, existingOwner: existing.owner },
      );
    }
    this.entries.set(def.type, { owner, def });
  }

  has(type: string): boolean {
    return this.entries.has(type);
  }

  get(type: string): QueryDefinition | undefined {
    return this.entries.get(type)?.def;
  }

  ownerOf(type: string): string | undefined {
    return this.entries.get(type)?.owner;
  }

  list(): readonly QueryDefinition[] {
    return [...this.entries.values()].map((e) => e.def);
  }

  validate(type: string, payload: unknown): unknown {
    const def = this.entries.get(type)?.def;
    if (!def?.schema) return payload;
    try {
      return def.schema.parse(payload);
    } catch (err) {
      throw new KernelError(
        "ENVELOPE_INVALID",
        `payload inválido para query "${type}": ${String(err)}`,
        { type, err: String(err) },
      );
    }
  }

  disposePlugin(owner: string): void {
    for (const [type, entry] of this.entries) {
      if (entry.owner === owner) this.entries.delete(type);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}