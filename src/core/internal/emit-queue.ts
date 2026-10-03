import type { EventEnvelope } from "../contracts/envelope";

export interface EmitQueueOptions {
  readonly concurrency: number;
  readonly handler: (env: EventEnvelope) => Promise<void>;
  readonly onError?: (err: unknown, env: EventEnvelope) => void;
}

/**
 * Fila de `emit()` fire-and-forget com concorrência limitada.
 *
 * - `push()` é síncrono (não bloqueia o caller).
 * - `drain()` espera a fila + execuções em vôo terminarem.
 * - `clear()` descarta o pendente (sem cancelar execuções já iniciadas).
 * - `stop()` marca a fila como fechada — pushes seguintes são ignorados.
 */
export class EmitQueue {
  private queue: EventEnvelope[] = [];
  private inFlight = 0;
  private stopped = false;
  private drainWaiters: Array<() => void> = [];

  constructor(private readonly opts: EmitQueueOptions) {}

  push(env: EventEnvelope): void {
    if (this.stopped) return;
    this.queue.push(env);
    this.pump();
  }

  private pump(): void {
    while (this.inFlight < this.opts.concurrency && this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.inFlight++;
      void this.opts
        .handler(next)
        .catch((err) => {
          try {
            this.opts.onError?.(err, next);
          } catch {
            /* onError hostil */
          }
        })
        .finally(() => {
          this.inFlight--;
          this.maybeFlushDrain();
          this.pump();
        });
    }
  }

  async drain(): Promise<void> {
    if (this.inFlight === 0 && this.queue.length === 0) return;
    await new Promise<void>((resolve) => this.drainWaiters.push(resolve));
  }

  clear(): void {
    this.queue.length = 0;
    this.maybeFlushDrain();
  }

  stop(): void {
    this.stopped = true;
    this.queue.length = 0;
    this.maybeFlushDrain();
  }

  get pending(): number {
    return this.queue.length;
  }

  get running(): number {
    return this.inFlight;
  }

  private maybeFlushDrain(): void {
    if (this.inFlight === 0 && this.queue.length === 0) {
      const waiters = this.drainWaiters;
      this.drainWaiters = [];
      for (const w of waiters) w();
    }
  }
}