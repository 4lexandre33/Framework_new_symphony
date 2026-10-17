import { defineEvent, defineCommand } from "@core";

/**
 * Payload de `game.loop.tick`.
 *
 * O objeto é REUTILIZADO entre ticks (regra deliberada de zero alocação no
 * hot path, G31). Ele é válido durante o handler (o loop aguarda todos os
 * handlers antes do próximo tick). NUNCA o mute (é readonly; em DEV a
 * mutação é detectada, logada e revertida) nem guarde a referência: use
 * `copyTickPayload(env.payload, out)`.
 */
export interface GameTickPayload {
  readonly deltaSeconds: number;
  readonly totalTimeSeconds: number;
  readonly tickCount: number;
}

/** Cópia mutável/guardável de um `GameTickPayload`. */
export interface GameTickSnapshot {
  deltaSeconds: number;
  totalTimeSeconds: number;
  tickCount: number;
}

/**
 * G31: copia os números do payload REUTILIZADO do tick. Com `out` não aloca
 * (reuse o mesmo destino por tick); sem `out` cria um objeto novo.
 */
export function copyTickPayload(
  src: GameTickPayload,
  out: GameTickSnapshot = { deltaSeconds: 0, totalTimeSeconds: 0, tickCount: 0 },
): GameTickSnapshot {
  out.deltaSeconds = src.deltaSeconds;
  out.totalTimeSeconds = src.totalTimeSeconds;
  out.tickCount = src.tickCount;
  return out;
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

/** Cópia mutável/guardável de um `GameRenderPayload`. */
export interface GameRenderSnapshot {
  alphaInterpolation: number;
  deltaSeconds: number;
  realDeltaSeconds: number;
  isPaused: boolean;
}

/** G31: como `copyTickPayload`, para o payload reutilizado do render. */
export function copyRenderPayload(
  src: GameRenderPayload,
  out: GameRenderSnapshot = { alphaInterpolation: 0, deltaSeconds: 0, realDeltaSeconds: 0, isPaused: false },
): GameRenderSnapshot {
  out.alphaInterpolation = src.alphaInterpolation;
  out.deltaSeconds = src.deltaSeconds;
  out.realDeltaSeconds = src.realDeltaSeconds;
  out.isPaused = src.isPaused;
  return out;
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
