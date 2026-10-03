import { KernelError } from "../errors";
import type { EventDefinition } from "../typed-event";

interface OwnedDefinition {
  readonly owner: string;
  readonly def: EventDefinition;
}

/**
 * Registro de definições de eventos. Plugins registram seus tipos em
 * `setup()` via `ctx.events.define(...)`. O kernel usa este registro para
 * validar payloads e para devtools.
 *
 * Regras:
 * - Um tipo só pode ser definido uma vez (REGISTRY_DUPLICATE se duplicado).
 * - O kernel limpa definições do plugin em `disposePlugin`.
 * - Se o tipo não tem schema, `validate` é no-op (retorna o payload).
 */
export class EventRegistry {
  private readonly entries = new Map<string, OwnedDefinition>();

  define(owner: string, def: EventDefinition): void {
    const existing = this.entries.get(def.type);
    if (existing) {
      throw new KernelError(
        "REGISTRY_DUPLICATE",
        `evento "${def.type}" já registrado por "${existing.owner}"`,
        { type: def.type, owner, existingOwner: existing.owner },
      );
    }
    this.entries.set(def.type, { owner, def });
  }

  has(type: string): boolean {
    return this.entries.has(type);
  }

  get(type: string): EventDefinition | undefined {
    return this.entries.get(type)?.def;
  }

  ownerOf(type: string): string | undefined {
    return this.entries.get(type)?.owner;
  }

  list(): readonly EventDefinition[] {
    return [...this.entries.values()].map((e) => e.def);
  }

  /**
   * Valida payload se houver schema registrado para o tipo. Sem schema,
   * retorna o payload inalterado. Lança ENVELOPE_INVALID se o schema rejeitar.
   */
  validate(type: string, payload: unknown): unknown {
    const def = this.entries.get(type)?.def;
    if (!def?.schema) return payload;
    try {
      return def.schema.parse(payload);
    } catch (err) {
      throw new KernelError(
        "ENVELOPE_INVALID",
        `payload inválido para evento "${type}": ${String(err)}`,
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