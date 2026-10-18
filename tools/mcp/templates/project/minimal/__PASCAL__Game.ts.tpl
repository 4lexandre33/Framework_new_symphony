/**
 * Lógica do jogo: classe pura, sem kernel, Three.js nem DOM (testável com fakes).
 * O plugin só compõe e chama `tick` a cada `game.loop.tick` (passo fixo).
 * Não aloque objetos por tick.
 */
export class __PASCAL__Game {
  private elapsedSeconds = 0;
  private ticks = 0;
  private disposed = false;

  public tick(deltaSeconds: number): void {
    if (this.disposed) return;
    this.elapsedSeconds += deltaSeconds;
    this.ticks += 1;
  }

  /** Tempo de jogo acumulado (segundos). */
  public get elapsed(): number {
    return this.elapsedSeconds;
  }

  /** Quantidade de ticks processados. */
  public get tickCount(): number {
    return this.ticks;
  }

  public get isDisposed(): boolean {
    return this.disposed;
  }

  public dispose(): void {
    this.disposed = true;
  }
}
