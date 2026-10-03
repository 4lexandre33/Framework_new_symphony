import type { EventEnvelope } from "./envelope";
import type { Schema } from "./schema";

export interface EventDefinition<T extends string = string, P = unknown> {
  readonly type: T;
  /** phantom — não existe em runtime. */
  readonly __payload?: P;
  /** Schema opcional para validar payloads. */
  readonly schema?: Schema<P>;
  /** Descrição curta para devtools. */
  readonly description?: string;
}

export function defineEvent<T extends string, P = unknown>(
  type: T,
  opts?: { schema?: Schema<P>; description?: string },
): EventDefinition<T, P> {
  return { type, ...(opts ?? {}) } as EventDefinition<T, P>;
}

export type PayloadOf<D> = D extends EventDefinition<string, infer P> ? P : never;
export type TypeOf<D> = D extends EventDefinition<infer T, unknown> ? T : never;

export type EnvelopeFor<D> = D extends EventDefinition<infer T, infer P>
  ? EventEnvelope<T, P>
  : never;