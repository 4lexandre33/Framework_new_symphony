/**
 * Batch transacional do pipeline do kernel.
 *
 * Semântica deliberada:
 * - emit/send são bufferizados até commit();
 * - rollback() antes do commit descarta o buffer;
 * - commit() despacha sequencialmente pelo pipeline canônico;
 * - NÃO é ACID e NÃO desfaz efeitos que já foram publicados se um item
 *   posterior falhar durante commit(). Transação de domínio/World deve
 *   ser implementada pelo respectivo plugin (ex.: MutationGateway).
 */
export interface Transaction {
  readonly id: string;
  readonly label?: string;
  emit<T extends string, P>(type: T, payload: P): void;
  send<T extends string, P>(type: T, payload: P): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface TransactionApi {
  /** Abre um batch para o plugin atual. Não aninha. */
  begin(label?: string): Transaction;
  current(): Transaction | undefined;
  /** rollback automático apenas enquanto o batch ainda não produziu efeitos irreversíveis. */
  with<T>(label: string, fn: (tx: Transaction) => Promise<T> | T): Promise<T>;
}
