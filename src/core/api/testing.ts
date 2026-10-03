import { Kernel } from "../kernel";
import { makeEnvelope, type Envelope, type EventEnvelope } from "../contracts/envelope";
import type { Plugin } from "../contracts/plugin-context";
import type { KernelOptions } from "../kernel-types";

export interface TestKernel {
  readonly kernel: Kernel;
  waitForEvent<T extends string, P>(
    type: T,
    timeoutMs?: number,
  ): Promise<EventEnvelope<T, P>>;
  emit<T extends string, P>(type: T, payload: P): void;
  stop(): Promise<void>;
}

export interface CreateTestKernelOptions extends KernelOptions {
  /** Se setado, registra esses plugins antes de `boot()`. */
  readonly plugins?: readonly Plugin[];
}

/**
 * Cria um kernel para testes. Aceita tanto a lista de plugins (retrocompat)
 * quanto um objeto de opções.
 *
 * O kernel é criado com `tolerant: false` por padrão — falhas de setup
 * estouram em vez de virar estado "failed".
 */
export async function createTestKernel(
  pluginsOrOptions: readonly Plugin[] | CreateTestKernelOptions = [],
): Promise<TestKernel> {
  const opts: CreateTestKernelOptions = Array.isArray(pluginsOrOptions)
    ? { plugins: pluginsOrOptions as readonly Plugin[] }
    : (pluginsOrOptions as CreateTestKernelOptions);

  const plugins = opts.plugins ?? [];
  const kernel = new Kernel({ tolerant: false, ...opts });
  for (const p of plugins) kernel.register(p);
  await kernel.boot();

  interface Pending {
    readonly type: string;
    readonly resolve: (env: EventEnvelope) => void;
    readonly timer: ReturnType<typeof setTimeout>;
  }
  const pending: Pending[] = [];

  const off = kernel.__testSubscribe((env: Envelope) => {
    if (env.kind !== "event") return;
    // Itera sobre uma cópia para permitir splice seguro durante o loop.
    for (const p of [...pending]) {
      if (p.type !== env.type) continue;
      const idx = pending.indexOf(p);
      if (idx >= 0) pending.splice(idx, 1);
      clearTimeout(p.timer);
      p.resolve(env as EventEnvelope);
      break;
    }
  });

  return {
    kernel,
    waitForEvent(type, timeoutMs = 1000) {
      return new Promise<EventEnvelope>((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = pending.findIndex((p) => p.timer === timer);
          if (idx >= 0) pending.splice(idx, 1);
          reject(new Error(`timeout esperando evento "${type}"`));
        }, timeoutMs);
        pending.push({
          type,
          resolve: resolve as (env: EventEnvelope) => void,
          timer,
        });
      }) as Promise<never>;
    },
    emit(type, payload) {
      // Passa pela fila de emit e middleware — mesmo caminho de produção.
      kernel.__testSubscribeEmit(
        makeEnvelope({
          kind: "event",
          type,
          payload,
          id: "test",
          source: "__test__",
          meta: { timestamp: Date.now(), source: "__test__", seq: 0 },
        }),
      );
    },
    async stop() {
      off();
      await kernel.stop();
    },
  };
}