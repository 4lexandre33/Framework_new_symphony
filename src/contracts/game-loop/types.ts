import { defineEvent, defineCommand } from "../../core/contracts";

export interface GameTickPayload {
  readonly deltaSeconds: number;
  readonly totalTimeSeconds: number;
  readonly tickCount: number;
}

export const GameTickEvent = defineEvent<"game.loop.tick", GameTickPayload>(
  "game.loop.tick"
);

export interface GameRenderPayload {
  readonly alphaInterpolation: number;
  readonly deltaSeconds: number;
}

export const GameRenderEvent = defineEvent<"game.loop.render", GameRenderPayload>(
  "game.loop.render"
);

export const PauseGameCommand = defineCommand<
  "game.loop.pause",
  Record<string, never>
>("game.loop.pause");

export const ResumeGameCommand = defineCommand<
  "game.loop.resume",
  Record<string, never>
>("game.loop.resume");