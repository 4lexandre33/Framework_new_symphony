// @ai-why:  Gate de readiness. markPending() reabre o gate mesmo após resolve.
// @ai-link: runtime/replace.ts
// @ai-keep: replace() chama markPending no novo plugin; sem reabrir, whenReady() retornaria imediato.

import { kernelErrors } from "./errors";

export interface WhenReadyOptions {
  /** Se > 0, rejeita após esse tempo com READY_TIMEOUT. */
  readonly timeoutMs?: number;
  /** Chamado quando o timeout estoura, antes da rejeição. */
  readonly onTimeout?: (pending: readonly string[]) => void;
}

interface Waiter {
  readonly resolve: () => void;
  readonly reject: (err: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Gate de readiness reutilizável.
 *
 * Diferença do design anterior: `markPending()` reabre o gate mesmo após
 * um `resolve()` anterior. Isso é necessário para `kernel.replace()` —
 * o kernel já está `running` (logo `_resolved === true`) e o novo plugin
 * precisa poder registrar pending de novo.
 */
export class ReadinessGate {
  private readonly pending = new Set<string>();
  private waiters: Waiter[] = [];

  markPending(pluginId: string): void {
    this.pending.add(pluginId);
  }

  markReady(pluginId: string): void {
    if (!this.pending.has(pluginId)) return;
    this.pending.delete(pluginId);
    if (this.pending.size === 0) this.flush();
  }

  /**
   * Igual a markReady(), mas semanticamente explícito: o plugin falhou
   * e não vai mais chamar ctx.lifecycle.ready(). Remove do pending.
   */
  markFailed(pluginId: string): void {
    this.markReady(pluginId);
  }

  whenReady(opts: WhenReadyOptions = {}): Promise<void> {
    if (this.pending.size === 0) return Promise.resolve();

    const { timeoutMs = 0, onTimeout } = opts;

    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject };

      if (timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          const pendingNow = [...this.pending];
          this.waiters = this.waiters.filter((w) => w !== waiter);
          try {
            onTimeout?.(pendingNow);
          } catch {
            /* handler hostil */
          }
          reject(kernelErrors.readyTimeout(timeoutMs, pendingNow));
        }, timeoutMs);
      }

      this.waiters.push(waiter);
    });
  }

  /** Lista de plugins pendentes, em ordem de inserção. */
  pendingList(): readonly string[] {
    return [...this.pending];
  }

  /** Snapshot imutável (compatível com o kernel). */
  snapshot(): { readonly pending: readonly string[] } {
    return { pending: [...this.pending] };
  }

  /** True se não há pendentes. Não trava após o primeiro resolve. */
  get resolved(): boolean {
    return this.pending.size === 0;
  }

  private flush(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) {
      if (w.timer !== undefined) clearTimeout(w.timer);
      w.resolve();
    }
  }
}