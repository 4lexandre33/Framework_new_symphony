/**
 * Fonte abstrata de tempo civil para casos de uso e criação de snapshots.
 *
 * O domínio não consulta Date.now(), performance.now() ou relógios da engine
 * diretamente. Adapters concretos são fornecidos pelas camadas superiores.
 */
export interface ClockPort {
  nowEpochMs(): number;
}
