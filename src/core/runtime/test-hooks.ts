// src/core/runtime/test-hooks.ts
import type { Envelope, EventEnvelope } from "../contracts/envelope";
import type { KernelState } from "./state";
import { emitThroughPipeline } from "./pipeline";

export interface TestHooks {
  /** Assina o fluxo de envelopes. Devolve cancelador. */
  subscribe(cb: (env: Envelope) => void): () => void;

  /**
   * Injeta um envelope no pipeline de testes.
   *
   * Desde a correção de 09/2026, `push` passa pelo MESMO pipeline canônico
   * de produção: validação de schema + middleware + subscribers. O caller
   * recebe uma Promise; quem não esperar, dispara fire-and-forget.
   *
   * @ai-why: alinha com o que api/testing.ts sempre documentou.
   * @ai-keep: só eventos. Commands/queries usam os métodos próprios.
   */
  push(env: Envelope): Promise<void>;
}

export function createTestHooks(state: KernelState): TestHooks {
  return {
    subscribe(cb) {
      state.testSubscribers.add(cb);
      return () => {
        state.testSubscribers.delete(cb);
      };
    },
    async push(env) {
      // O pipeline canônico é o único responsável por notificar
      // testSubscribers. Notificar aqui duplicaria cada evento.
      if (env.kind === "event") {
        await emitThroughPipeline(state, env as EventEnvelope);
      }
      // commands/queries possuem APIs de teste próprias; push é event-only.
    },
  };
}