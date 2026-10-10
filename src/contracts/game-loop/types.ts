import { defineEvent, defineCommand } from "@core";

/**
 * Payload de `game.loop.tick`.
 *
 * O objeto é REUTILIZADO entre ticks (zero alocação no hot path). Ele é
 * válido durante o handler (o loop aguarda todos os handlers antes do
 * próximo tick); copie os números se precisar guardá-los.
 */
export interface GameTickPayload {
  readonly deltaSeconds: number;
  readonly totalTimeSeconds: number;
  readonly tickCount: number;
}

export const GameTickEvent = defineEvent<"game.loop.tick", GameTickPayload>(
  "game.loop.tick"
);

/**
 * Payload de `game.loop.render` (também reutilizado entre frames).
 *
 * Durante `pause()` o render CONTINUA (menus de pausa sobre a cena 3D):
 * `isPaused` é true, `deltaSeconds` é 0 (animações/partículas que usam o
 * delta congelam) e `realDeltaSeconds` traz o tempo de parede do frame
 * (para animar UI/menus). `alphaInterpolation` fica congelado no último valor.
 */
export interface GameRenderPayload {
  readonly alphaInterpolation: number;
  /** Delta de simulação visual do frame. 0 enquanto pausado. */
  readonly deltaSeconds: number;
  /** Delta de relógio de parede do frame (limitado a 0,25 s), mesmo pausado. */
  readonly realDeltaSeconds: number;
  readonly isPaused: boolean;
}

export const GameRenderEvent = defineEvent<"game.loop.render", GameRenderPayload>(
  "game.loop.render"
);

export interface PauseOptions {
  /**
   * true = também para de emitir `game.loop.render` (imagem congelada, sem
   * custo de GPU). Padrão false: só a simulação (ticks) para.
   */
  readonly freezeRender?: boolean;
}

export const PauseGameCommand = defineCommand<
  "game.loop.pause",
  PauseOptions
>("game.loop.pause");

export const ResumeGameCommand = defineCommand<
  "game.loop.resume",
  Record<string, never>
>("game.loop.resume");
