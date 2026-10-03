export interface Clock {
  now(): number;
  /**
   * Devolve cancelador. O handle do timer NÃO é exposto — quem chamou
   * guarda o cancelador e chama quando quiser. Isso isola o consumidor
   * da representação do timer (browser, Node, fake).
   */
  setTimeout(fn: () => void, ms: number): () => void;
  /**
   * Mesma convenção: devolve cancelador. `setInterval` é necessário para
   * plugins de longa duração (polling de ai-runtime, heartbeats, timers
   * de sessão do notebook).
   */
  setInterval(fn: () => void, ms: number): () => void;
  /**
   * Compat retroativa com `window.clearTimeout`/`setTimeout` do DOM, que
   * expõem handle cru. Prefira o cancelador devolvido por `setTimeout`/
   * `setInterval` — este método é no-op na implementação de sistema.
   */
  clearTimeout(handle: unknown): void;
}