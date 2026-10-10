// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { PluginContext } from "@core";

import {
  DeterministicGameLoop,
  type GameLoopTimingDriver,
  type GameLoopVisibilityListener,
} from "../src/engine/game-loop/internal/DeterministicGameLoop";

type FrameCallback = (timestampMs: number) => Promise<void>;

class TestTimingDriver implements GameLoopTimingDriver {
  public nowMs = 0;
  public listener: GameLoopVisibilityListener | null = null;
  public unsubscribed = 0;
  public initiallyHidden = false;
  private callback: FrameCallback | null = null;
  private nextId = 1;
  private scheduledId: number | null = null;

  public now(): number {
    return this.nowMs;
  }

  public requestFrame(callback: FrameCallback): number {
    if (this.callback !== null) {
      throw new Error("mais de um RAF agendado simultaneamente");
    }
    this.callback = callback;
    this.scheduledId = this.nextId++;
    return this.scheduledId;
  }

  public cancelFrame(frameId: number): void {
    if (this.scheduledId === frameId) {
      this.callback = null;
      this.scheduledId = null;
    }
  }

  public subscribeVisibility(listener: GameLoopVisibilityListener): () => void {
    this.listener = listener;
    return () => {
      this.listener = null;
      this.unsubscribed += 1;
    };
  }

  public isHidden(): boolean {
    return this.initiallyHidden;
  }

  public hasScheduledFrame(): boolean {
    return this.callback !== null;
  }

  /** Dispara o RAF agendado SEM aguardar (para simular frames sobrepostos). */
  public fire(deltaMs: number): Promise<void> {
    const callback = this.callback;
    if (callback === null) {
      throw new Error("nenhum RAF agendado");
    }
    this.callback = null;
    this.scheduledId = null;
    this.nowMs += deltaMs;
    return callback(this.nowMs);
  }

  public async step(deltaMs: number): Promise<void> {
    await this.fire(deltaMs);
  }
}

interface Recorded {
  readonly type: string;
  readonly snapshot: Readonly<Record<string, number | boolean>>;
}

function createHarness(
  onEmit?: (type: string) => Promise<void>,
): { timing: TestTimingDriver; loop: DeterministicGameLoop; events: Recorded[] } {
  const timing = new TestTimingDriver();
  const events: Recorded[] = [];
  const ctx = {
    log: { error(): void {} },
    events: {
      async emitAsync(type: string, payload: Record<string, number | boolean>): Promise<void> {
        events.push({ type, snapshot: Object.freeze({ ...payload }) });
        if (onEmit !== undefined) {
          await onEmit(type);
        }
      },
    },
  } as unknown as PluginContext;

  return { timing, loop: new DeterministicGameLoop(ctx, timing), events };
}

const ticks = (events: Recorded[]): Recorded[] => events.filter((event) => event.type === "game.loop.tick");
const renders = (events: Recorded[]): Recorded[] => events.filter((event) => event.type === "game.loop.render");

describe("game-loop gaps (G23, G38, G39)", () => {
  it("G23: pause congela ticks mas mantém render com deltaSeconds 0 e isPaused", async () => {
    const { timing, loop, events } = createHarness();
    loop.start();
    await timing.step(17);
    expect(ticks(events)).toHaveLength(1);
    const alphaBefore = renders(events).at(-1)?.snapshot.alphaInterpolation;

    loop.pause();
    events.length = 0;
    await timing.step(17);
    await timing.step(17);

    expect(ticks(events)).toHaveLength(0);
    expect(renders(events)).toHaveLength(2);
    for (const render of renders(events)) {
      expect(render.snapshot.isPaused).toBe(true);
      expect(render.snapshot.deltaSeconds).toBe(0);
      expect(render.snapshot.realDeltaSeconds).toBeCloseTo(0.017, 6);
      expect(render.snapshot.alphaInterpolation).toBe(alphaBefore);
    }

    loop.resume();
    events.length = 0;
    await timing.step(17);
    expect(ticks(events)).toHaveLength(1);
    expect(renders(events)[0]?.snapshot.isPaused).toBe(false);
    expect(renders(events)[0]?.snapshot.deltaSeconds).toBeCloseTo(0.017, 6);
  });

  it("G23: pause({ freezeRender: true }) também congela o render", async () => {
    const { timing, loop, events } = createHarness();
    loop.start();
    await timing.step(17);
    loop.pause({ freezeRender: true });
    events.length = 0;
    await timing.step(17);
    expect(events).toHaveLength(0);
    expect(loop.getStats().isPaused).toBe(true);
    loop.resume();
    await timing.step(17);
    expect(ticks(events)).toHaveLength(1);
  });

  it("G38: aba oculta suspende e, ao voltar, não há rajada de catch-up", async () => {
    const { timing, loop, events } = createHarness();
    loop.start();
    expect(timing.listener).not.toBeNull();
    await timing.step(17);
    expect(ticks(events)).toHaveLength(1);

    timing.listener?.(true);
    expect(loop.getStats().isHidden).toBe(true);
    events.length = 0;
    // Alguns hosts continuam entregando frames ocultos: nada é simulado.
    await timing.step(1000);
    expect(events).toHaveLength(0);

    timing.nowMs += 30_000;
    timing.listener?.(false);
    expect(loop.getStats().isHidden).toBe(false);
    await timing.step(17);
    expect(ticks(events)).toHaveLength(1);
    expect(loop.getDeterminismDiagnostics().droppedWallTimeSeconds).toBeGreaterThan(30);

    loop.stop();
    expect(timing.unsubscribed).toBe(1);
    expect(timing.listener).toBeNull();
  });

  it("G38: inicia oculto quando o driver informa", async () => {
    const { timing, loop, events } = createHarness();
    timing.initiallyHidden = true;
    loop.start();
    await timing.step(17);
    expect(events).toHaveLength(0);
    timing.listener?.(false);
    await timing.step(17);
    expect(ticks(events)).toHaveLength(1);
    loop.stop();
  });

  it("G39: setTickRate informa sucesso/falha", () => {
    const { loop } = createHarness();
    expect(loop.setTickRate(30)).toBe(true);
    expect(loop.getStats().tickRate).toBe(30);
    expect(loop.setTickRate(0)).toBe(false);
    expect(loop.setTickRate(241)).toBe(false);
    expect(loop.setTickRate(Number.NaN)).toBe(false);
    expect(loop.getStats().tickRate).toBe(30);
  });

  it("G39: targetFps real limita frames de render sem afetar o tick fixo", async () => {
    const { timing, loop, events } = createHarness();
    expect(loop.getStats().targetFps).toBe(0);
    expect(loop.setTargetFps(30)).toBe(true);
    expect(loop.setTargetFps(-1)).toBe(false);
    expect(loop.setTargetFps(0.5)).toBe(false);
    expect(loop.setTargetFps(5000)).toBe(false);
    expect(loop.getStats().targetFps).toBe(30);

    loop.start();
    // Display a ~120 Hz durante 1 s.
    for (let frame = 0; frame < 120; frame += 1) {
      await timing.step(1000 / 120);
    }
    const renderCount = renders(events).length;
    expect(renderCount).toBeGreaterThanOrEqual(29);
    expect(renderCount).toBeLessThanOrEqual(31);
    // Simulação continua a 60 Hz: ~60 ticks em 1 s.
    expect(ticks(events).length).toBeGreaterThanOrEqual(58);
    expect(ticks(events).length).toBeLessThanOrEqual(60);

    expect(loop.setTargetFps(0)).toBe(true);
    events.length = 0;
    for (let frame = 0; frame < 12; frame += 1) {
      await timing.step(1000 / 120);
    }
    expect(renders(events)).toHaveLength(12);
  });

  it("G39: stop()+start() durante um frame em andamento não roda frames concorrentes", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let release: (() => void) | null = null;
    let blockNext = true;

    const { timing, loop, events } = createHarness(async (type) => {
      if (type !== "game.loop.tick") {
        return;
      }
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (blockNext) {
        blockNext = false;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      inFlight -= 1;
    });

    loop.start();
    const firstFrame = timing.fire(17);
    await Promise.resolve();
    expect(loop.getDeterminismDiagnostics().frameInFlight).toBe(true);

    loop.stop();
    loop.start();
    expect(timing.hasScheduledFrame()).toBe(true);

    // O novo RAF chega enquanto o frame antigo ainda aguarda: é adiado.
    await timing.step(17);
    expect(maxInFlight).toBe(1);
    expect(ticks(events)).toHaveLength(1);

    (release as (() => void) | null)?.();
    await firstFrame;
    expect(loop.getDeterminismDiagnostics().frameInFlight).toBe(false);

    await timing.step(17);
    expect(maxInFlight).toBe(1);
    expect(ticks(events).length).toBeGreaterThanOrEqual(2);
    expect(timing.hasScheduledFrame()).toBe(true);
    loop.stop();
  });

  it("getStats devolve objeto novo", () => {
    const { loop } = createHarness();
    expect(loop.getStats()).not.toBe(loop.getStats());
  });
});
