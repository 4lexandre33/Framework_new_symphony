import { defineCapability } from "@core";

export interface GameLoopStats {
  readonly fps: number;
  readonly targetFps: number;
  readonly tickRate: number;
  readonly isPaused: boolean;
  readonly runningTimeSeconds: number;
}

export interface GameLoopApi {
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  setTickRate(ticksPerSecond: number): void;
  getStats(): GameLoopStats;
}

export const GameLoopToken = defineCapability<GameLoopApi>("game.loop", "1.0.0");