export interface Job {
  readonly id: string;
  /** maior = mais cedo. default 0. */
  readonly priority?: number;
  /** rótulo humano para logs/devtools. */
  readonly label?: string;
  /**
   * TTL do job. Se definido e o job ainda não iniciou até esse tempo
   * (contado do enqueue), o scheduler cancela com `AbortSignal` e rejeita
   * a promise de enqueue com erro de timeout.
   */
  readonly ttlMs?: number;
  run(signal: AbortSignal): Promise<void> | void;
}

export interface Scheduler {
  enqueue(job: Job): Promise<void>;
  /** cede o controle pro próximo job. */
  yield(): Promise<void>;
  /** cancela por id. true se removido. */
  cancel(id: string): boolean;
}