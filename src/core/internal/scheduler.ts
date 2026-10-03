import { KernelError } from "../contracts/errors";
import type { Job, Scheduler } from "../contracts/scheduler";

export type SchedulerEvent =
  | { readonly kind: "enqueued"; readonly jobId: string }
  | { readonly kind: "started"; readonly jobId: string }
  | { readonly kind: "completed"; readonly jobId: string }
  | { readonly kind: "failed"; readonly jobId: string; readonly error: unknown }
  | { readonly kind: "cancelled"; readonly jobId: string };

export interface SchedulerOptions {
  readonly maxConcurrent?: number;
  readonly onEvent?: (event: SchedulerEvent) => void;
}

interface QueuedTask {
  readonly job: Job;
  readonly resolve: () => void;
  readonly reject: (err: unknown) => void;
  readonly controller: AbortController;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export class SchedulerImpl implements Scheduler {
  private readonly queue: QueuedTask[] = [];
  private running = 0;
  private readonly maxConcurrent: number;
  private readonly onEvent: ((event: SchedulerEvent) => void) | undefined;
  private _stopped = false;

  constructor(opts: SchedulerOptions = {}) {
    this.maxConcurrent = Math.max(1, opts.maxConcurrent ?? 4);
    this.onEvent = opts.onEvent;
  }

  enqueue(job: Job): Promise<void> {
    if (this._stopped) {
      return Promise.reject(new Error(`scheduler parado; job "${job.id}" rejeitado`));
    }
    return new Promise<void>((resolve, reject) => {
      const controller = new AbortController();
      const task: QueuedTask = { job, resolve, reject, controller, timer: undefined };

      if (job.ttlMs !== undefined && job.ttlMs > 0) {
        task.timer = setTimeout(() => {
          const i = this.queue.indexOf(task);
          if (i >= 0) this.queue.splice(i, 1);
          controller.abort();
          this.emit({ kind: "cancelled", jobId: job.id });
          reject(
            new KernelError(
              "TIMEOUT",
              `job "${job.id}" excedeu ${job.ttlMs}ms na fila sem começar`,
              { jobId: job.id, ttlMs: job.ttlMs },
            ),
          );
        }, job.ttlMs);
      }

      this.queue.push(task);
      this.queue.sort((a, b) => (b.job.priority ?? 0) - (a.job.priority ?? 0));
      this.emit({ kind: "enqueued", jobId: job.id });
      this.pump();
    });
  }

  yield(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  cancel(id: string): boolean {
    const idx = this.queue.findIndex((t) => t.job.id === id);
    if (idx < 0) return false;
    const task = this.queue.splice(idx, 1)[0]!;
    if (task.timer !== undefined) clearTimeout(task.timer);
    task.controller.abort();
    this.emit({ kind: "cancelled", jobId: id });
    task.reject(new Error(`job "${id}" cancelado`));
    return true;
  }

  cancelAll(): number {
    const pending = this.queue.splice(0, this.queue.length);
    for (const task of pending) {
      if (task.timer !== undefined) clearTimeout(task.timer);
      task.controller.abort();
      this.emit({ kind: "cancelled", jobId: task.job.id });
      task.reject(new Error(`job "${task.job.id}" cancelado por cancelAll()`));
    }
    return pending.length;
  }

  stop(): void {
    this._stopped = true;
    this.cancelAll();
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  get runningCount(): number {
    return this.running;
  }

  private pump(): void {
    while (this.running < this.maxConcurrent && this.queue.length > 0) {
      const task = this.queue.shift()!;
      // O job vai rodar agora — desarma o timer de TTL-da-fila.
      if (task.timer !== undefined) {
        clearTimeout(task.timer);
        task.timer = undefined;
      }
      this.running++;
      this.emit({ kind: "started", jobId: task.job.id });
      Promise.resolve()
        .then(() => task.job.run(task.controller.signal))
        .then(
          () => {
            this.emit({ kind: "completed", jobId: task.job.id });
            task.resolve();
          },
          (err) => {
            this.emit({ kind: "failed", jobId: task.job.id, error: err });
            task.reject(err);
          },
        )
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }

  private emit(event: SchedulerEvent): void {
    if (!this.onEvent) return;
    try {
      this.onEvent(event);
    } catch {
      /* observador hostil não derruba o scheduler */
    }
  }
}