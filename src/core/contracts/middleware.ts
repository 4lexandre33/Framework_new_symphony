import type { Envelope } from "./envelope";

export type MiddlewareKind = "event" | "command" | "query";

export interface MiddlewareCtx {
  stop(): void;
  /** Substitui o envelope atual. `kind` não pode mudar. */
  replace(env: Envelope): void;
}

export interface Middleware {
  readonly id: string;
  readonly kinds?: readonly MiddlewareKind[];
  readonly types?: readonly string[];
  handle(
    env: Envelope,
    next: () => void | Promise<void>,
    ctx: MiddlewareCtx,
  ): void | Promise<void>;
}