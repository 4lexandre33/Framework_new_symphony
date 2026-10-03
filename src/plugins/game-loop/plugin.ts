import type { Plugin, PluginContext } from "../../core/contracts/plugin-context";
import { GameLoopToken, type GameLoopApi, type GameLoopStats } from "../../tokens/game-loop";
import {
  GameTickEvent,
  GameRenderEvent,
  PauseGameCommand,
  ResumeGameCommand,
} from "../../contracts/game-loop/types";

export const gameLoopManifest: Plugin["manifest"] = {
  id: "game.loop",
  name: "Deterministic Game Loop Plugin",
  version: "1.0.0",
  kind: "preloaded",
  authority: "game",
  permissions: {
    capabilities: [GameLoopToken.id],
    events: ["game.loop.tick", "game.loop.render", "kernel.booted"],
  },
  capabilities: {
    provides: [
      {
        id: GameLoopToken.id,
        version: "1.0.0",
      },
    ],
  },
};

export class DeterministicGameLoop implements GameLoopApi {
  private running = false;
  private paused = false;
  private animationFrameId: number | null = null;
  private lastTime = 0;
  private accumulator = 0;
  private targetTickRate = 60;
  private fixedDeltaTime = 1 / 60;
  private totalRunningTime = 0;
  private tickCount = 0;
  private currentFps = 60;
  private frameCounter = 0;
  private fpsTimer = 0;

  private readonly tickPayload = {
    deltaSeconds: 1 / 60,
    totalTimeSeconds: 0,
    tickCount: 0,
  };

  private readonly renderPayload = {
    alphaInterpolation: 0,
    deltaSeconds: 0,
  };

  constructor(private readonly ctx: PluginContext) {}

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.fpsTimer = this.lastTime;
    this.loop(this.lastTime);
  }

  public stop(): void {
    this.running = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  public pause(): void {
    this.paused = true;
  }

  public resume(): void {
    this.paused = false;
    this.lastTime = performance.now();
  }

  public setTickRate(ticksPerSecond: number): void {
    if (ticksPerSecond <= 0) return;
    this.targetTickRate = ticksPerSecond;
    this.fixedDeltaTime = 1 / ticksPerSecond;
    (this.tickPayload as any).deltaSeconds = this.fixedDeltaTime;
  }

  public getStats(): GameLoopStats {
    return {
      fps: this.currentFps,
      targetFps: 60,
      tickRate: this.targetTickRate,
      isPaused: this.paused,
      runningTimeSeconds: this.totalRunningTime,
    };
  }

  private readonly loop = (currentTime: number): void => {
    if (!this.running) return;

    let frameTime = (currentTime - this.lastTime) / 1000;
    if (frameTime > 0.25) {
      frameTime = 0.25;
    }
    this.lastTime = currentTime;

    this.frameCounter++;
    if (currentTime - this.fpsTimer >= 1000) {
      this.currentFps = this.frameCounter;
      this.frameCounter = 0;
      this.fpsTimer = currentTime;
    }

    if (!this.paused) {
      this.accumulator += frameTime;

      while (this.accumulator >= this.fixedDeltaTime) {
        this.totalRunningTime += this.fixedDeltaTime;
        this.tickCount++;

        (this.tickPayload as any).totalTimeSeconds = this.totalRunningTime;
        (this.tickPayload as any).tickCount = this.tickCount;

        this.ctx.events.emit("game.loop.tick", this.tickPayload);

        this.accumulator -= this.fixedDeltaTime;
      }

      (this.renderPayload as any).alphaInterpolation = this.accumulator / this.fixedDeltaTime;
      (this.renderPayload as any).deltaSeconds = frameTime;

      this.ctx.events.emit("game.loop.render", this.renderPayload);
    }

    this.animationFrameId = requestAnimationFrame(this.loop);
  };
}

export function createGameLoopPlugin(): Plugin {
  return {
    manifest: gameLoopManifest,

    setup(ctx: PluginContext) {
      const gameLoop = new DeterministicGameLoop(ctx);

      // 1. Prover Capability
      ctx.caps.provide(GameLoopToken, gameLoop);

      // 2. Registrar Eventos e Comandos
      ctx.events.define(GameTickEvent);
      ctx.events.define(GameRenderEvent);
      ctx.commands.define(PauseGameCommand);
      ctx.commands.define(ResumeGameCommand);

      // 3. Handlers de Comandos
      const unbindPause = ctx.commands.handle("game.loop.pause", () => {
        gameLoop.pause();
      });

      const unbindResume = ctx.commands.handle("game.loop.resume", () => {
        gameLoop.resume();
      });

      // 4. O loop só pode começar depois que TODOS os plugins
      // concluíram setup, resolução de capabilities e lifecycle.onBoot.
      // O Kernel emite "kernel.booted" somente após state.phase = "running".
      const unbindKernelBooted = ctx.events.on("kernel.booted", () => {
        gameLoop.start();
      });

      // 5. Configurar Desalocação
      ctx.lifecycle.onDispose(() => {
        unbindKernelBooted();
        gameLoop.stop();
        unbindPause();
        unbindResume();
      });

      // 6. Notificar o Kernel que a fase de setup foi concluída com sucesso
      ctx.lifecycle.ready();
    },
  };
}