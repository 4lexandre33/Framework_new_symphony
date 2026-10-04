// @ai-why:  TransactionImpl é por-transação. TransactionManager é multi-plugin.
// @ai-link: contracts/transaction.ts, runtime/pipeline.ts
// @ai-keep: TransactionManager NÃO implements TransactionApi (assinaturas diferem:
//   current(source) vs current()). Interface é a visão do plugin.
//   commit() DEVE passar pelo pipeline canônico (validate + middleware).
//   NÃO é ACID: rollback não desfaz efeitos já despachados por commit().

import type { Transaction } from "../contracts/transaction";
import type {
  Envelope,
  EventEnvelope,
  CommandEnvelope,
} from "../contracts/envelope";
import { makeEnvelope } from "../contracts/envelope";
import { newId } from "./ids";

/** Dependências de commit injetadas por state.ts. */
export interface TxManagerDeps {
  readonly signal: AbortSignal;
  readonly nextSeq: () => number;
  readonly freeze: <E extends Envelope>(env: E) => E;
  /** Passa por validate + middleware + EventBus. */
  readonly emit: (env: EventEnvelope) => Promise<void>;
  /** Passa por validate + middleware + Dispatcher. */
  readonly send: (env: CommandEnvelope) => Promise<void>;
}

export class TransactionImpl implements Transaction {
  readonly id: string;
  readonly label?: string;
  private closed = false;
  private readonly events: Array<{ type: string; payload: unknown }> = [];
  private readonly commands: Array<{ type: string; payload: unknown }> = [];

  constructor(
    label: string | undefined,
    private readonly source: string,
    private readonly deps: TxManagerDeps,
  ) {
    this.id = newId("tx");
    this.label = label;
  }

  emit<T extends string, P>(type: T, payload: P): void {
    if (this.closed) throw new Error(`transação ${this.id} já fechada`);
    this.events.push({ type, payload });
  }

  async send<T extends string, P>(type: T, payload: P): Promise<void> {
    if (this.closed) throw new Error(`transação ${this.id} já fechada`);
    this.commands.push({ type, payload });
  }

  async commit(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    // Ordem: eventos primeiro, comandos depois. Ambos passam pelo pipeline
    // canônico (validação de schema + middleware + permissão).
    for (const e of this.events) {
      const env = this.deps.freeze(
        makeEnvelope({
          kind: "event",
          type: e.type,
          payload: e.payload,
          source: this.source,
          meta: { seq: this.deps.nextSeq(), correlationId: this.id },
        }),
      ) as EventEnvelope;
      await this.deps.emit(env);
    }
    for (const c of this.commands) {
      const env = this.deps.freeze(
        makeEnvelope({
          kind: "command",
          type: c.type,
          payload: c.payload,
          source: this.source,
          meta: { seq: this.deps.nextSeq(), correlationId: this.id },
        }),
      ) as CommandEnvelope;
      await this.deps.send(env);
    }
  }

  async rollback(): Promise<void> {
    this.closed = true;
    this.events.length = 0;
    this.commands.length = 0;
  }
}

export class TransactionManager {
  private readonly currentBySource = new Map<string, TransactionImpl>();

  constructor(private readonly deps: TxManagerDeps) {}

  begin(source: string, label?: string): Transaction {
    if (this.currentBySource.has(source)) {
      throw new Error(
        `plugin "${source}" já está em uma transação; transações não são aninháveis`,
      );
    }
    const tx = new TransactionImpl(label, source, this.deps);
    this.currentBySource.set(source, tx);
    return tx;
  }

  current(source: string): Transaction | undefined {
    return this.currentBySource.get(source);
  }

  async with<T>(
    source: string,
    label: string,
    fn: (tx: Transaction) => Promise<T> | T,
  ): Promise<T> {
    const tx = this.begin(source, label);
    try {
      const result = await fn(tx);
      await tx.commit();
      return result;
    } catch (err) {
      await tx.rollback();
      throw err;
    } finally {
      this.currentBySource.delete(source);
    }
  }

  /** Chamado no dispose do plugin — nunca deixa uma transação pendurada. */
  forget(source: string): void {
    const tx = this.currentBySource.get(source);
    if (tx) {
      void tx.rollback();
      this.currentBySource.delete(source);
    }
  }
}