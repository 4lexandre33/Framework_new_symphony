import { KernelError } from "../errors";
import type { Schema } from "../schema";

export interface CommandDefinition<T extends string = string, P = unknown> {
  readonly type: T;
  readonly __payload?: P;
  readonly schema?: Schema<P>;
  readonly description?: string;
}

export function defineCommand<T extends string, P = unknown>(
  type: T,
  opts?: { schema?: Schema<P>; description?: string },
): CommandDefinition<T, P> {
  return { type, ...(opts ?? {}) } as CommandDefinition<T, P>;
}

interface OwnedDefinition {
  readonly owner: string;
  readonly def: CommandDefinition;
}

export class CommandRegistry {
  private readonly entries = new Map<string, OwnedDefinition>();

  define(owner: string, def: CommandDefinition): void {
    const existing = this.entries.get(def.type);
    if (existing) {
      throw new KernelError(
        "REGISTRY_DUPLICATE",
        `comando "${def.type}" já registrado por "${existing.owner}"`,
        { type: def.type, owner, existingOwner: existing.owner },
      );
    }
    this.entries.set(def.type, { owner, def });
  }

  has(type: string): boolean {
    return this.entries.has(type);
  }

  get(type: string): CommandDefinition | undefined {
    return this.entries.get(type)?.def;
  }

  ownerOf(type: string): string | undefined {
    return this.entries.get(type)?.owner;
  }

  list(): readonly CommandDefinition[] {
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
        `payload inválido para comando "${type}": ${String(err)}`,
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