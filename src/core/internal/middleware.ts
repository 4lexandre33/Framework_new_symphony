// @ai-why:  Chain de middleware com cache por (kind,type).
// @ai-link: contracts/middleware.ts
// @ai-keep: use() invalida o cache. Se mudar critério de relevância, ajuste o cache em run().

import { KernelError } from "../contracts/errors";
import type { Envelope } from "../contracts/envelope";
import type { Logger } from "../contracts/logger";
import type {
  Middleware,
  MiddlewareCtx,
  MiddlewareKind,
} from "../contracts/middleware";

export type { Middleware, MiddlewareCtx, MiddlewareKind } from "../contracts/middleware";

interface CachedChain {
  readonly relevant: Middleware[];
}

export class MiddlewareChain {
  private readonly list: Middleware[] = [];
  private cache = new Map<string, CachedChain>();

  constructor(private readonly logger?: Logger) {}

  use(mw: Middleware): () => void {
    this.list.push(mw);
    this.cache.clear();
    return () => {
      const i = this.list.indexOf(mw);
      if (i >= 0) this.list.splice(i, 1);
      this.cache.clear();
    };
  }

  async run(
    env: Envelope,
    terminal: (env: Envelope) => void | Promise<void>,
  ): Promise<void> {
    const key = `${env.kind}:${env.type}`;
    let chain = this.cache.get(key);
    if (!chain) {
      const relevant = this.list.filter((m) => {
        if (m.kinds && !m.kinds.includes(env.kind as MiddlewareKind)) return false;
        if (m.types && !m.types.includes(env.type)) return false;
        return true;
      });
      chain = { relevant };
      this.cache.set(key, chain);
    }
    const { relevant } = chain;

    let current = env;
    let stopped = false;
    let index = -1;

    const ctx: MiddlewareCtx = {
      stop: () => {
        stopped = true;
      },
      replace: (next) => {
        if (next.kind !== current.kind) {
          throw new KernelError(
            "DISPATCH_NO_HANDLER",
            `middleware não pode trocar kind do envelope (de "${current.kind}" para "${next.kind}")`,
            { from: current.kind, to: next.kind },
          );
        }
        current = next;
      },
    };

    const advance = async (): Promise<void> => {
      if (stopped) return;
      index++;
      if (index >= relevant.length) {
        await terminal(current);
        return;
      }
      const mw = relevant[index]!;
      let advanced = false;
      let nextPromise: Promise<void> | undefined;

      const next = (): void | Promise<void> => {
        if (advanced) return nextPromise ?? Promise.resolve();
        advanced = true;
        nextPromise = advance();
        return nextPromise;
      };

      try {
        const result = mw.handle(current, next, ctx);
        if (result && typeof (result as Promise<void>).then === "function") {
          await result;
        }
      } catch (err) {
        this.logError(`middleware "${mw.id}" falhou`, { err: String(err) });
        if (!advanced) await next();
        return;
      }
      if (nextPromise) await nextPromise;
    };

    await advance();
  }

  private logError(message: string, meta?: Record<string, unknown>): void {
    if (this.logger) this.logger.error(message, meta);
    else console.error("[kernel.middleware]", message, meta);
  }
}