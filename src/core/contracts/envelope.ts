// @ai-why:  Envelope genérico. makeEnvelope propaga correlationId/causationId/trace do parent.
// @ai-link: runtime/pipeline.ts
// @ai-keep: pickTrace só popula trace se houver correlationId E parent. Campos explícitos em meta sempre vencem.

export type EnvelopeKind = "event" | "command" | "query" | "response" | "signal";

export interface EnvelopeMeta {
  readonly timestamp: number;
  /** id do plugin emissor. */
  readonly source: string;
  /** sequência global monotônica dentro do kernel. */
  readonly seq: number;
  /** id de correlação — estável por toda a operação encadeada. */
  readonly correlationId?: string;
  /** id do envelope que CAUSOU este (parent direto). */
  readonly causationId?: string;
  /** endereço de resposta para queries/commands que esperam resposta dedicada. */
  readonly replyTo?: string;
  /** tempo de vida em ms; kernel usa para timeout de send/ask/emitAsync. */
  readonly ttlMs?: number;
  /**
   * Cadeia de `source`s por onde a operação passou, do mais antigo ao
   * mais recente. Sempre presente quando `correlationId` está presente;
   * populado por `makeEnvelope` a partir do parent.
   */
  readonly trace?: readonly string[];
}

export interface Envelope<
  K extends EnvelopeKind = EnvelopeKind,
  T extends string = string,
  P = unknown,
> {
  readonly id: string;
  readonly kind: K;
  readonly type: T;
  readonly payload: P;
  readonly meta: EnvelopeMeta;
}

export type EventEnvelope<T extends string = string, P = unknown> = Envelope<"event", T, P>;
export type CommandEnvelope<T extends string = string, P = unknown> = Envelope<"command", T, P>;
export type QueryEnvelope<T extends string = string, P = unknown> = Envelope<"query", T, P>;
export type ResponseEnvelope<T extends string = string, P = unknown> = Envelope<"response", T, P>;
export type SignalEnvelope<T extends string = string, P = unknown> = Envelope<"signal", T, P>;

export interface MakeEnvelopeArgs<
  K extends EnvelopeKind,
  T extends string,
  P,
> {
  kind: K;
  type: T;
  payload: P;
  source?: string;
  id?: string;
  /**
   * Envelope pai. Quando presente, `makeEnvelope` propaga:
   * - `correlationId`: herdado do parent (ou do id do parent, se ausente)
   * - `causationId`: id do parent
   * - `trace`: trace do parent + `source` do parent
   *
   * Nada disso é aplicado se o chamador passar o campo correspondente em
   * `meta` — o explícito sempre vence.
   */
  parent?: Envelope;
  meta?: Partial<Omit<EnvelopeMeta, "timestamp" | "source" | "seq">> & {
    source?: string;
    seq?: number;
    timestamp?: number;
  };
}

function pickTrace(
  explicit: readonly string[] | undefined,
  parent: EnvelopeMeta | undefined,
  correlationId: string | undefined,
): readonly string[] | undefined {
  if (explicit !== undefined) return explicit;
  if (parent === undefined || correlationId === undefined) return undefined;
  return [...(parent.trace ?? []), parent.source];
}

export function makeEnvelope<K extends EnvelopeKind, T extends string, P>(
  args: MakeEnvelopeArgs<K, T, P>,
): Envelope<K, T, P> {
  const parent = args.parent;
  const parentMeta = parent?.meta;
  const explicitMeta = args.meta;

  const source =
    explicitMeta?.source ?? args.source ?? parentMeta?.source ?? "unknown";
  const timestamp = explicitMeta?.timestamp ?? Date.now();
  const seq = explicitMeta?.seq ?? 0;

  // Correlation: explícito > parent.correlationId > id do parent (como raiz de cadeia)
  const correlationId =
    explicitMeta?.correlationId ?? parentMeta?.correlationId ?? parent?.id;

  // Causation: sempre o id do parent, se houver parent.
  const causationId = explicitMeta?.causationId ?? parent?.id;

  const trace = pickTrace(explicitMeta?.trace, parentMeta, correlationId);

  const replyTo = explicitMeta?.replyTo;
  const ttlMs = explicitMeta?.ttlMs;

  const meta: EnvelopeMeta = {
    timestamp,
    source,
    seq,
    ...(correlationId !== undefined ? { correlationId } : {}),
    ...(causationId !== undefined ? { causationId } : {}),
    ...(replyTo !== undefined ? { replyTo } : {}),
    ...(ttlMs !== undefined ? { ttlMs } : {}),
    ...(trace !== undefined ? { trace } : {}),
  };

  return {
    id: args.id ?? crypto.randomUUID(),
    kind: args.kind,
    type: args.type,
    payload: args.payload,
    meta,
  };
}