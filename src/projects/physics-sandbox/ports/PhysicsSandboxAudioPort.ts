/**
 * Porta de áudio pertencente ao projeto consumidor.
 *
 * A lógica do sandbox conhece somente intenções semânticas:
 * - salto;
 * - impacto.
 *
 * Ela não conhece Web Audio, AssetsApi, URLs de assets ou implementação
 * interna da engine.
 */
export interface PhysicsSandboxAudioPort {
  initialize(): Promise<void>;

  playJump(): void;

  playImpact(): void;

  dispose(): void;
}
