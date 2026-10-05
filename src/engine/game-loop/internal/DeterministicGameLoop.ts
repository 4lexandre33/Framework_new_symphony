import type { PluginContext } from "@core";
import {
  type GameLoopApi,
  type GameLoopStats,
} from "../../../tokens/game-loop";

export const GAME_LOOP_DEFAULT_TICK_RATE = 60;
export const GAME_LOOP_MIN_TICK_RATE = 1;
export const GAME_LOOP_MAX_TICK_RATE = 240;
export const GAME_LOOP_MAX_FRAME_DELTA_SECONDS = 0.25;
export const GAME_LOOP_MAX_FIXED_STEPS_PER_FRAME = 60;

const GAME_LOOP_TARGET_RENDER_FPS = 60;
const GAME_LOOP_ACCUMULATOR_EPSILON_SECONDS = 1e-10;

type GameLoopFrameCallback = (
  timestampMs: number,
) => Promise<void>;

export interface GameLoopTimingDriver {
  now(): number;
  requestFrame(
    callback: GameLoopFrameCallback,
  ): number;
  cancelFrame(
    frameId: number,
  ): void;
}

interface MutableGameTickPayload {
  deltaSeconds: number;
  totalTimeSeconds: number;
  tickCount: number;
}

interface MutableGameRenderPayload {
  alphaInterpolation: number;
  deltaSeconds: number;
}

const BROWSER_TIMING_DRIVER:
  GameLoopTimingDriver =
  Object.freeze({
    now(): number {
      return performance.now();
    },

    requestFrame(
      callback:
        GameLoopFrameCallback,
    ): number {
      return requestAnimationFrame(
        callback,
      );
    },

    cancelFrame(
      frameId: number,
    ): void {
      cancelAnimationFrame(
        frameId,
      );
    },
  });

/**
 * Fixed-timestep deterministic simulation loop.
 *
 * Invariants:
 * - simulation ticks use a fixed delta;
 * - frame delta is clamped before entering the accumulator;
 * - tick/render dispatch is serialized with emitAsync();
 * - a new RAF is scheduled only after the current frame completes;
 * - tick/render payload objects are reused (no payload allocation per frame);
 * - pause never accumulates wall-clock catch-up time;
 * - invalid tick rates/timestamps cannot poison the accumulator with NaN/∞.
 *
 * This class intentionally remains internal. The public contract is
 * GameLoopApi from src/tokens/game-loop.ts.
 */
export class DeterministicGameLoop
implements GameLoopApi {
  private running = false;
  private paused = false;
  private animationFrameId:
    number | null = null;

  private lastTimeMs = 0;
  private accumulatorSeconds = 0;
  private targetTickRate =
    GAME_LOOP_DEFAULT_TICK_RATE;
  private fixedDeltaTimeSeconds =
    1 /
    GAME_LOOP_DEFAULT_TICK_RATE;

  private totalRunningTimeSeconds =
    0;
  private tickCount = 0;

  private currentFps =
    GAME_LOOP_TARGET_RENDER_FPS;
  private frameCounter = 0;
  private fpsWindowStartMs = 0;

  private droppedWallTimeSeconds = 0;

  private readonly tickPayload:
    MutableGameTickPayload = {
      deltaSeconds:
        1 /
        GAME_LOOP_DEFAULT_TICK_RATE,
      totalTimeSeconds:
        0,
      tickCount:
        0,
    };

  private readonly renderPayload:
    MutableGameRenderPayload = {
      alphaInterpolation:
        0,
      deltaSeconds:
        0,
    };

  public constructor(
    private readonly ctx:
      PluginContext,
    private readonly timing:
      GameLoopTimingDriver =
      BROWSER_TIMING_DRIVER,
  ) {}

  public start(): void {
    if (
      this.running
    ) {
      return;
    }

    this.running = true;

    const nowMs =
      this.readFiniteNow();

    this.lastTimeMs =
      nowMs;
    this.fpsWindowStartMs =
      nowMs;
    this.frameCounter =
      0;

    this.scheduleNextFrame();
  }

  public stop(): void {
    if (
      !this.running &&
      this.animationFrameId ===
        null
    ) {
      return;
    }

    this.running = false;

    if (
      this.animationFrameId !==
      null
    ) {
      const frameId =
        this.animationFrameId;

      this.animationFrameId =
        null;

      this.timing.cancelFrame(
        frameId,
      );
    }
  }

  public pause(): void {
    if (
      this.paused
    ) {
      return;
    }

    this.paused = true;
  }

  public resume(): void {
    if (
      !this.paused
    ) {
      return;
    }

    this.paused = false;

    const nowMs =
      this.readFiniteNow();

    // Rebase wall-clock time so time spent paused never becomes catch-up.
    this.lastTimeMs =
      nowMs;
    this.fpsWindowStartMs =
      nowMs;
    this.frameCounter =
      0;
  }

  public setTickRate(
    ticksPerSecond: number,
  ): void {
    if (
      !Number.isFinite(
        ticksPerSecond,
      ) ||
      ticksPerSecond <
        GAME_LOOP_MIN_TICK_RATE ||
      ticksPerSecond >
        GAME_LOOP_MAX_TICK_RATE
    ) {
      return;
    }

    this.targetTickRate =
      ticksPerSecond;
    this.fixedDeltaTimeSeconds =
      1 /
      ticksPerSecond;
  }

  public getStats():
    GameLoopStats {
    return {
      fps:
        this.currentFps,
      targetFps:
        GAME_LOOP_TARGET_RENDER_FPS,
      tickRate:
        this.targetTickRate,
      isPaused:
        this.paused,
      runningTimeSeconds:
        this.totalRunningTimeSeconds,
    };
  }

  /**
   * Internal diagnostic used by Stage 75 tests/audits only.
   * Not exported through the public facade/token.
   */
  public getDeterminismDiagnostics(): Readonly<{
    readonly tickCount: number;
    readonly accumulatorSeconds: number;
    readonly droppedWallTimeSeconds: number;
    readonly scheduledFrame: boolean;
  }> {
    return {
      tickCount:
        this.tickCount,
      accumulatorSeconds:
        this.accumulatorSeconds,
      droppedWallTimeSeconds:
        this.droppedWallTimeSeconds,
      scheduledFrame:
        this.animationFrameId !==
        null,
    };
  }

  private readonly onAnimationFrame =
    async (
      currentTimeMs: number,
    ): Promise<void> => {
      this.animationFrameId =
        null;

      if (
        !this.running
      ) {
        return;
      }

      try {
        await this.processFrame(
          currentTimeMs,
        );
      } catch (
        error
      ) {
        this.ctx.log.error(
          "game loop frame falhou; loop será interrompido",
          {
            error:
              String(
                error,
              ),
          },
        );

        this.stop();
        return;
      }

      if (
        this.running
      ) {
        this.scheduleNextFrame();
      }
    };

  private async processFrame(
    currentTimeMs: number,
  ): Promise<void> {
    const frameDeltaSeconds =
      this.computeFrameDeltaSeconds(
        currentTimeMs,
      );

    this.updateFps(
      currentTimeMs,
    );

    if (
      this.paused ||
      !this.running
    ) {
      return;
    }

    this.accumulatorSeconds +=
      frameDeltaSeconds;

    let fixedSteps =
      0;

    while (
      this.running &&
      !this.paused &&
      fixedSteps <
        GAME_LOOP_MAX_FIXED_STEPS_PER_FRAME &&
      this.accumulatorSeconds +
        GAME_LOOP_ACCUMULATOR_EPSILON_SECONDS >=
        this.fixedDeltaTimeSeconds
    ) {
      const stepDeltaSeconds =
        this.fixedDeltaTimeSeconds;

      this.totalRunningTimeSeconds +=
        stepDeltaSeconds;
      this.tickCount +=
        1;

      this.tickPayload.deltaSeconds =
        stepDeltaSeconds;
      this.tickPayload.totalTimeSeconds =
        this.totalRunningTimeSeconds;
      this.tickPayload.tickCount =
        this.tickCount;

      // Determinism rule: the next fixed step cannot begin before every
      // handler of the current step has completed.
      await this.ctx.events.emitAsync(
        "game.loop.tick",
        this.tickPayload,
      );

      this.accumulatorSeconds -=
        stepDeltaSeconds;

      if (
        this.accumulatorSeconds <
        GAME_LOOP_ACCUMULATOR_EPSILON_SECONDS
      ) {
        this.accumulatorSeconds =
          0;
      }

      fixedSteps +=
        1;
    }

    if (
      this.accumulatorSeconds >=
      this.fixedDeltaTimeSeconds
    ) {
      // Safety valve. With the frame clamp + max tick rate this should only
      // be reachable through floating-point edge cases or a future policy
      // change. Never carry an unbounded death spiral into the next frame.
      this.accumulatorSeconds =
        this.accumulatorSeconds %
        this.fixedDeltaTimeSeconds;
    }

    if (
      !this.running ||
      this.paused
    ) {
      return;
    }

    const rawAlpha =
      this.accumulatorSeconds /
      this.fixedDeltaTimeSeconds;

    this.renderPayload.alphaInterpolation =
      rawAlpha <=
      0
        ? 0
        : rawAlpha >=
            1
          ? 1 -
            Number.EPSILON
          : rawAlpha;

    this.renderPayload.deltaSeconds =
      frameDeltaSeconds;

    await this.ctx.events.emitAsync(
      "game.loop.render",
      this.renderPayload,
    );
  }

  private computeFrameDeltaSeconds(
    currentTimeMs: number,
  ): number {
    if (
      !Number.isFinite(
        currentTimeMs,
      )
    ) {
      return 0;
    }

    const deltaMs =
      currentTimeMs -
      this.lastTimeMs;

    // Rebase even after a backward clock jump. The current frame receives
    // zero delta and the next valid timestamp continues from the new base.
    this.lastTimeMs =
      currentTimeMs;

    if (
      !Number.isFinite(
        deltaMs,
      ) ||
      deltaMs <=
        0
    ) {
      return 0;
    }

    const rawSeconds =
      deltaMs /
      1000;

    if (
      rawSeconds <=
      GAME_LOOP_MAX_FRAME_DELTA_SECONDS
    ) {
      return rawSeconds;
    }

    this.droppedWallTimeSeconds +=
      rawSeconds -
      GAME_LOOP_MAX_FRAME_DELTA_SECONDS;

    return GAME_LOOP_MAX_FRAME_DELTA_SECONDS;
  }

  private updateFps(
    currentTimeMs: number,
  ): void {
    if (
      !Number.isFinite(
        currentTimeMs,
      )
    ) {
      return;
    }

    const elapsedMs =
      currentTimeMs -
      this.fpsWindowStartMs;

    if (
      elapsedMs <
      0
    ) {
      this.fpsWindowStartMs =
        currentTimeMs;
      this.frameCounter =
        0;
      return;
    }

    this.frameCounter +=
      1;

    if (
      elapsedMs <
      1000
    ) {
      return;
    }

    this.currentFps =
      Math.round(
        (
          this.frameCounter *
          1000
        ) /
        elapsedMs,
      );

    this.frameCounter =
      0;
    this.fpsWindowStartMs =
      currentTimeMs;
  }

  private scheduleNextFrame(): void {
    if (
      !this.running ||
      this.animationFrameId !==
        null
    ) {
      return;
    }

    this.animationFrameId =
      this.timing.requestFrame(
        this.onAnimationFrame,
      );
  }

  private readFiniteNow(): number {
    const value =
      this.timing.now();

    return Number.isFinite(
      value,
    )
      ? value
      : 0;
  }
}
