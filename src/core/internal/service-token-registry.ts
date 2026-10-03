// src/core/internal/service-token-registry.ts
//
// ─────────────────────────────────────────────────────────────────────
// SERVICE TOKEN REGISTRY — a peça central do Service Locator
// ─────────────────────────────────────────────────────────────────────
//
// Um "token" é um identificador tipado de capability (`CapabilityToken`
// ou `AsyncCapabilityToken`). Este registry é a única fonte de verdade
// sobre QUAIS tokens existem no sistema.
//
// Diferença vs. `manifest.capabilities.provides/consumes`:
//   - manifest → metadados (range, priority, optional)
//   - registry → o token em si (id, version, schema, __async)
//
// Com os dois, um consumidor pode:
//   (a) `ctx.services.require(StorageToken)` — tipado, importa o token
//   (b) `ctx.services.requireById<StorageApi>("lume.storage")` — sem import
//
// É a peça que torna o "resolve by name" possível sem quebrar tipo.

import type {
  CapabilityToken,
  AsyncCapabilityToken,
} from "../contracts/capability-token";
import { KernelError } from "../contracts/errors";

type AnyToken<T = unknown> = CapabilityToken<T> | AsyncCapabilityToken<T>;

interface TokenEntry<T> {
  readonly token: AnyToken<T>;
  readonly owner: string;
}

export class ServiceTokenRegistry {
  private readonly byId = new Map<string, TokenEntry<unknown>>();
  private readonly byOwner = new Map<string, Set<string>>();

  /**
   * Registra um token sob um dono.
   *
   * - Mesmo owner redeclarando → idempotente (dispose no-op).
   * - Outro owner tentando o mesmo id → REGISTRY_DUPLICATE.
   *
   * Devolve dispose. O kernel chama no dispose do plugin.
   */
  declare(owner: string, token: AnyToken<unknown>): () => void {
    const existing = this.byId.get(token.id);
    if (existing && existing.owner !== owner) {
      throw new KernelError(
        "REGISTRY_DUPLICATE",
        `token "${token.id}" já declarado por "${existing.owner}"; ` +
          `plugin "${owner}" não pode redeclarar`,
        {
          capabilityId: token.id,
          existingOwner: existing.owner,
          newOwner: owner,
        },
      );
    }
    if (existing) {
      // mesmo owner — idempotente
      return () => {};
    }
    this.byId.set(token.id, { token: token as AnyToken, owner });
    const set = this.byOwner.get(owner) ?? new Set<string>();
    set.add(token.id);
    this.byOwner.set(owner, set);
    return () => {
      const current = this.byId.get(token.id);
      if (current?.owner !== owner) return;
      this.byId.delete(token.id);
      set.delete(token.id);
      if (set.size === 0) this.byOwner.delete(owner);
    };
  }

  get<T>(id: string): AnyToken<T> | undefined {
    return this.byId.get(id)?.token as AnyToken<T> | undefined;
  }

  ownerOf(id: string): string | undefined {
    return this.byId.get(id)?.owner;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  list(): readonly AnyToken[] {
    return [...this.byId.values()].map((entry) => entry.token);
  }

  /** Remove todos os tokens de um owner. Usa-se em `disposePlugin`. */
  disposeOwner(owner: string): void {
    const ids = this.byOwner.get(owner);
    if (!ids) return;
    for (const id of ids) this.byId.delete(id);
    this.byOwner.delete(owner);
  }

  clear(): void {
    this.byId.clear();
    this.byOwner.clear();
  }
}

/**
 * Type-guard runtime: distingue um token de outros objetos exportados
 * por `@tokens/*` (interfaces, constantes, etc.).
 */
export function isCapabilityToken(
  value: unknown,
): value is AnyToken<unknown> {
  if (value === null || typeof value !== "object") return false;
  const v = value as { id?: unknown; version?: unknown };
  return typeof v.id === "string" && typeof v.version === "string";
}