import { defineCapability } from "@core";
import type { PauseOptions } from "../contracts/game-loop/types";

export interface GameLoopStats {
  readonly fps: number;
  /** Limite de FPS de render configurado (0 = sem limite, segue o display). */
  readonly targetFps: number;
  readonly tickRate: number;
  readonly isPaused: boolean;
  /** true enquanto a página/janela está oculta (simulação suspensa). */
  readonly isHidden: boolean;
  readonly runningTimeSeconds: number;
}

export interface GameLoopApi {
  start(): void;
  stop(): void;
  /**
   * Congela a simulação (sem `game.loop.tick`). Por padrão o render continua
   * com `isPaused: true` e `deltaSeconds: 0` (menus de pausa sobre a cena).
   * Use `{ freezeRender: true }` para também parar o render.
   */
  pause(options?: PauseOptions): void;
  /** Retoma sem "catch-up" do tempo passado em pausa. */
  resume(): void;
  /**
   * Define ticks por segundo (inteiro ou fracionário em [1, 240]).
   * Retorna false (sem alterar nada) para valores inválidos.
   */
  setTickRate(ticksPerSecond: number): boolean;
  /**
   * Limita a taxa de frames de render. 0 = sem limite (padrão, segue o
   * display). Valores válidos: 0 ou [1, 1000]. Retorna false se inválido.
   * Não afeta a taxa de simulação (fixed tick).
   */
  setTargetFps(framesPerSecond: number): boolean;
  /** Retorna um objeto novo a cada chamada. */
  getStats(): GameLoopStats;
}

export const GameLoopToken = defineCapability<GameLoopApi>("game.loop", "1.0.0");
