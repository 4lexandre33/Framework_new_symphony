import type { PluginContext } from "@core";
import type { PauseOptions } from "../../../contracts/game-loop/types";
import {
  type GameLoopApi,
  type GameLoopStats,
} from "../../../tokens/game-loop";

export const GAME_LOOP_DEFAULT_TICK_RATE = 60;
export const GAME_LOOP_MIN_TICK_RATE = 1;
export const GAME_LOOP_MAX_TICK_RATE = 240;
export const GAME_LOOP_MAX_FRAME_DELTA_SECONDS = 0.25;
export const GAME_LOOP_MAX_FIXED_STEPS_PER_FRAME = 60;
export const GAME_LOOP_MAX_TARGET_FPS = 1000;

const GAME_LOOP_INITIAL_FPS_ESTIMATE = 60;
const GAME_LOOP_ACCUMULATOR_EPSILON_SECONDS = 1e-10;
/** Tolerância para o limitador de FPS não pular frames por jitter do vsync. */
const GAME_LOOP_FRAME_CAP_TOLERANCE_MS = 0.5;

type GameLoopFrameCallback = (
  timestampMs: number,
) => Promise<void>;

export type GameLoopVisibilityListener = (
  hidden: boolean,
) => void;

export interface GameLoopTimingDriver {
  now(): number;
  requestFrame(
    callback: GameLoopFrameCallback,
  ): number;
  cancelFrame(
    frameId: number,
  ): void;
  /**
   * Opcional: notifica quando a página/janela fica oculta/visível.
   * Retorna a função que remove o listener.
   */
  subscribeVisibility?(
    listener: GameLoopVisibilityListener,
  ): () => void;
  /** Opcional: estado inicial de visibilidade (true = oculta). */
  isHidden?(): boolean;
}

interface MutableGameTickPayload {
  deltaSeconds: number;
  totalTimeSeconds: number;
  tickCount: number;
}

interface MutableGameRenderPayload {
  alphaInterpolation: number;
  deltaSeconds: number;
  realDeltaSeconds: number;
  isPaused: boolean;
}

function readDocumentHidden(): boolean {
  return typeof document !==
      "undefined" &&
    document.visibilityState ===
      "hidden";
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

    subscribeVisibility(
      listener:
        GameLoopVisibilityListener,
    ): () => void {
      if (
        typeof document ===
        "undefined"
      ) {
        return (): void => {};
      }

      const onVisibilityChange =
        (): void => {
          listener(
            readDocumentHidden(),
          );
        };

      document.addEventListener(
        "visibilitychange",
        onVisibilityChange,
      );

      return (): void => {
        document.removeEventListener(
          "visibilitychange",
          onVisibilityChange,
        );
      };
    },

    isHidden(): boolean {
      return readDocumentHidden();
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
 * - pause freezes simulation ticks; render keeps running with deltaSeconds 0
 *   and isPaused=true unless pause({ freezeRender: true });
 * - a hidden page/window suspends the simulation and, on return, the clock
 *   is rebased (no burst of catch-up ticks);
 * - stop()+start() during an in-flight frame never runs two frames at once;
 * - invalid tick rates/timestamps cannot poison the accumulator with NaN/∞.
 *
 * This class intentionally remains internal. The public contract is
 * GameLoopApi from src/tokens/game-loop.ts.
 */
export class DeterministicGameLoop
implements GameLoopApi {
  private running = false;
  private paused = false;
  private freezeRenderWhilePaused = false;
  private hidden = false;
  private frameInFlight = false;
  /** Incrementa em start/stop: frames de uma geração antiga não continuam. */
  private generation = 0;
  private unsubscribeVisibility:
    (() => void) | null = null;
  private animationFrameId:
    number | null = null;

  private lastTimeMs = 0;
  private accumulatorSeconds = 0;
  private targetTickRate =
    GAME_LOOP_DEFAULT_TICK_RATE;
  private fixedDeltaTimeSeconds =
    1 /
    GAME_LOOP_DEFAULT_TICK_RATE;

  /** 0 = sem limite (segue o display). */
  private targetFps = 0;
  private nextFrameDueMs = 0;

  private totalRunningTimeSeconds =
    0;
  private tickCount = 0;

  private currentFps =
    GAME_LOOP_INITIAL_FPS_ESTIMATE;
  private frameCounter = 0;
  private fpsWindowStartMs = 0;

  private droppedWallTimeSeconds = 0;
  private hiddenSinceMs = 0;

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
      realDeltaSeconds:
        0,
      isPaused:
        false,
    };

  private readonly onVisibilityChange =
    (
      hidden: boolean,
    ): void => {
      this.setHidden(
        hidden,
      );
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
    this.generation += 1;

    this.rebaseClock();

    if (
      this.unsubscribeVisibility ===
        null &&
      this.timing.subscribeVisibility !==
        undefined
    ) {
      this.unsubscribeVisibility =
        this.timing.subscribeVisibility(
          this.onVisibilityChange,
        );
    }

    this.hidden =
      this.timing.isHidden !==
        undefined &&
      this.timing.isHidden();

    if (
      this.hidden
    ) {
      this.hiddenSinceMs =
        this.readFiniteNow();
    }

    this.scheduleNextFrame();
  }

  public stop(): void {
    if (
      this.unsubscribeVisibility !==
      null
    ) {
      const unsubscribe =
        this.unsubscribeVisibility;

      this.unsubscribeVisibility =
        null;

      unsubscribe();
    }

    if (
      !this.running &&
      this.animationFrameId ===
        null
    ) {
      return;
    }

    this.running = false;
    this.generation += 1;

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

  /**
   * Congela a simulação. O render continua (isPaused=true, deltaSeconds=0)
   * a menos que `freezeRender` seja true. Chamar de novo atualiza a opção.
   */
  public pause(
    options?: PauseOptions,
  ): void {
    this.freezeRenderWhilePaused =
      options?.freezeRender ===
      true;

    this.paused = true;
  }

  public resume(): void {
    if (
      !this.paused
    ) {
      return;
    }

    this.paused = false;
    this.freezeRenderWhilePaused =
      false;

    this.rebaseClock();
  }

  /**
   * Página/janela oculta: suspende a simulação e o render. Ao voltar, o
   * relógio é rebaseado (o tempo oculto vira droppedWallTime, não catch-up).
   * Chamado pelo driver de timing (visibilitychange) ou manualmente.
   */
  public setHidden(
    hidden: boolean,
  ): void {
    if (
      this.hidden ===
      hidden
    ) {
      return;
    }

    if (
      hidden
    ) {
      this.hidden = true;
      this.hiddenSinceMs =
        this.readFiniteNow();
      return;
    }

    this.hidden = false;

    const hiddenSeconds =
      (
        this.readFiniteNow() -
        this.hiddenSinceMs
      ) /
      1000;

    if (
      Number.isFinite(
        hiddenSeconds,
      ) &&
      hiddenSeconds >
        0
    ) {
      this.droppedWallTimeSeconds +=
        hiddenSeconds;
    }

    this.rebaseClock();
  }

  public setTickRate(
    ticksPerSecond: number,
  ): boolean {
    if (
      typeof ticksPerSecond !==
        "number" ||
      !Number.isFinite(
        ticksPerSecond,
      ) ||
      ticksPerSecond <
        GAME_LOOP_MIN_TICK_RATE ||
      ticksPerSecond >
        GAME_LOOP_MAX_TICK_RATE
    ) {
      return false;
    }

    this.targetTickRate =
      ticksPerSecond;
    this.fixedDeltaTimeSeconds =
      1 /
      ticksPerSecond;

    return true;
  }

  public setTargetFps(
    framesPerSecond: number,
  ): boolean {
    if (
      typeof framesPerSecond !==
        "number" ||
      !Number.isFinite(
        framesPerSecond,
      ) ||
      framesPerSecond <
        0 ||
      (
        framesPerSecond >
          0 &&
        framesPerSecond <
          1
      ) ||
      framesPerSecond >
        GAME_LOOP_MAX_TARGET_FPS
    ) {
      return false;
    }

    this.targetFps =
      framesPerSecond;
    this.nextFrameDueMs =
      this.readFiniteNow();

    return true;
  }

  public getStats():
    GameLoopStats {
    return {
      fps:
        this.currentFps,
      targetFps:
        this.targetFps,
      tickRate:
        this.targetTickRate,
      isPaused:
        this.paused,
      isHidden:
        this.hidden,
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
    readonly frameInFlight: boolean;
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
      frameInFlight:
        this.frameInFlight,
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

      // Um frame de uma geração anterior (stop()+start() durante um await)
      // ainda está em andamento: nunca rode dois frames concorrentes.
      if (
        this.frameInFlight ||
        this.shouldSkipForFrameCap(
          currentTimeMs,
        )
      ) {
        this.scheduleNextFrame();
        return;
      }

      const generation =
        this.generation;

      this.frameInFlight = true;

      try {
        await this.processFrame(
          currentTimeMs,
        );
      } catch (
        error
      ) {
        this.frameInFlight = false;

        this.ctx.log.error(
          "game loop frame falhou; loop será interrompido",
          {
            error:
              String(
                error,
              ),
          },
        );

        if (
          generation ===
          this.generation
        ) {
          this.stop();
        }

        return;
      }

      this.frameInFlight = false;

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

    const generation =
      this.generation;

    if (
      !this.running ||
      this.hidden
    ) {
      return;
    }

    if (
      !this.paused
    ) {
      this.accumulatorSeconds +=
        frameDeltaSeconds;
    }

    let fixedSteps =
      0;

    while (
      this.running &&
      generation ===
        this.generation &&
      !this.paused &&
      !this.hidden &&
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
      generation !==
        this.generation ||
      this.hidden ||
      (
        this.paused &&
        this.freezeRenderWhilePaused
      )
    ) {
      return;
    }

    if (
      !this.paused
    ) {
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
    }

    // Pausado: a cena continua sendo desenhada, mas sistemas que usam o
    // delta (animação, partículas, câmera) ficam parados.
    this.renderPayload.deltaSeconds =
      this.paused
        ? 0
        : frameDeltaSeconds;

    this.renderPayload.realDeltaSeconds =
      frameDeltaSeconds;

    this.renderPayload.isPaused =
      this.paused;

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

  /**
   * Limitador de FPS (setTargetFps). Frames pulados não perdem tempo: o
   * delta do próximo frame processado cobre o intervalo inteiro.
   */
  private shouldSkipForFrameCap(
    currentTimeMs: number,
  ): boolean {
    if (
      this.targetFps <=
        0 ||
      !Number.isFinite(
        currentTimeMs,
      )
    ) {
      return false;
    }

    if (
      currentTimeMs +
        GAME_LOOP_FRAME_CAP_TOLERANCE_MS <
      this.nextFrameDueMs
    ) {
      return true;
    }

    const intervalMs =
      1000 /
      this.targetFps;

    this.nextFrameDueMs +=
      intervalMs;

    if (
      this.nextFrameDueMs <=
      currentTimeMs
    ) {
      // Atrasou mais de um intervalo (travada): realinha sem rajada.
      this.nextFrameDueMs =
        currentTimeMs +
        intervalMs;
    }

    return false;
  }

  private rebaseClock(): void {
    const nowMs =
      this.readFiniteNow();

    // Rebase wall-clock time so time spent paused/hidden never becomes catch-up.
    this.lastTimeMs =
      nowMs;
    this.fpsWindowStartMs =
      nowMs;
    this.nextFrameDueMs =
      nowMs;
    this.frameCounter =
      0;
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
