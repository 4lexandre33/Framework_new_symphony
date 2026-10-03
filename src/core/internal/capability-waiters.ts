// src/core/internal/capability-waiters.ts
//
// Substitui o busy-wait de 25ms do `caps.await` por notificação pura.
// Quando o provider chama `caps.provide`, `notify(capabilityId, value)`
// resolve todos os waiters pendentes. Custo O(1) por operação.

import { KernelError } from "../contracts/errors";

interface Waiter {
  readonly pluginId: string;
  readonly capabilityId: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (err: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class CapabilityWaiters {
  private readonly waiters = new Map<string, Set<Waiter>>();

  waitFor<T>(
    pluginId: string,
    capabilityId: string,
    timeoutMs: number,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const waiter: Waiter = {
        pluginId,
        capabilityId,
        resolve: resolve as (value: unknown) => void,
        reject,
      };
      if (timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          this.remove(waiter);
          reject(
            new KernelError(
              "CAPABILITY_TIMEOUT",
              `plugin "${pluginId}" aguardou capability "${capabilityId}" por ${timeoutMs}ms sem provide`,
              { pluginId, capabilityId, ms: timeoutMs },
            ),
          );
        }, timeoutMs);
      }
      const set = this.waiters.get(capabilityId) ?? new Set<Waiter>();
      set.add(waiter);
      this.waiters.set(capabilityId, set);
    });
  }

  /** Chamado depois que `caps.provide` anexa o valor. */
  notifyAvailable(capabilityId: string, value: unknown): void {
    const set = this.waiters.get(capabilityId);
    if (!set) return;
    for (const waiter of [...set]) {
      this.remove(waiter);
      waiter.resolve(value);
    }
  }

  /** Capability desapareceu sem substituto: await pendente falha, nunca resolve undefined. */
  notifyUnavailable(capabilityId: string): void {
    const set = this.waiters.get(capabilityId);
    if (!set) return;
    for (const waiter of [...set]) {
      this.remove(waiter);
      waiter.reject(new KernelError(
        "CAPABILITY_MISSING",
        `capability "${capabilityId}" ficou indisponível enquanto "${waiter.pluginId}" aguardava`,
        { pluginId: waiter.pluginId, capabilityId },
      ));
    }
  }

  /** Chamado no dispose do plugin: cancela todos os seus awaits pendentes. */
  disposePlugin(pluginId: string): void {
    for (const set of this.waiters.values()) {
      for (const waiter of [...set]) {
        if (waiter.pluginId !== pluginId) continue;
        this.remove(waiter);
        waiter.reject(
          new Error(
            `plugin "${pluginId}" desmontado enquanto aguardava capability "${waiter.capabilityId}"`,
          ),
        );
      }
    }
  }

  /** Chamado no stop do kernel. Rejeita todos os waiters pendentes. */
  clear(): void {
    for (const set of this.waiters.values()) {
      for (const waiter of set) {
        if (waiter.timer !== undefined) clearTimeout(waiter.timer);
        waiter.reject(new Error("kernel parado durante await de capability"));
      }
    }
    this.waiters.clear();
  }

  private remove(waiter: Waiter): void {
    if (waiter.timer !== undefined) clearTimeout(waiter.timer);
    const set = this.waiters.get(waiter.capabilityId);
    if (!set) return;
    set.delete(waiter);
    if (set.size === 0) this.waiters.delete(waiter.capabilityId);
  }
}