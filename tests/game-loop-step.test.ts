// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { PluginContext } from "@core";

import {
  DeterministicGameLoop,
  GAME_LOOP_MAX_MANUAL_STEPS,
  type GameLoopTimingDriver,
} from "../src/engine/game-loop/internal/DeterministicGameLoop";

type FrameCallback = (timestampMs: number) => Promise<void>;

class ManualTiming implements GameLoopTimingDriver {
  public nowMs = 0;
  private callback: FrameCallback | null = null;

  public now(): number {
    return this.nowMs;
  }

  public requestFrame(callback: FrameCallback): number {
    this.callback = callback;
    return 1;
  }

  public cancelFrame(): void {
    this.callback = null;
  }

  public fire(deltaMs: number): Promise<void> {
    const callback = this.callback;
    if (callback === null) throw new Error("nenhum RAF agendado");
    this.callback = null;
    this.nowMs += deltaMs;
    return callback(this.nowMs);
  }
}

interface Recorded {
  readonly type: string;
  readonly snapshot: Readonly<Record<string, number | boolean>>;
}

function createHarness(onEmit?: (type: string) => Promise<void>): {
  timing: ManualTiming;
  loop: DeterministicGameLoop;
  events: Recorded[];
} {
  const timing = new ManualTiming();
  const events: Recorded[] = [];
  const ctx = {
    log: { error(): void {} },
    events: {
      async emitAsync(type: string, payload: Record<string, number | boolean>): Promise<void> {
        events.push({ type, snapshot: Object.freeze({ ...payload }) });
        if (onEmit !== undefined) await onEmit(type);
      },
    },
  } as unknown as PluginContext;
  return { timing, loop: new DeterministicGameLoop(ctx, timing, true), events };
}

const ticks = (events: Recorded[]): Recorded[] => events.filter((e) => e.type === "game.loop.tick");
const renders = (events: Recorded[]): Recorded[] => events.filter((e) => e.type === "game.loop.render");

describe("GameLoopApi.stepTicks", () => {
  it("não faz nada sem pausa ou com n inválido", async () => {
    const { loop, events } = createHarness();
    loop.start();
    expect(await loop.stepTicks(5)).toBe(0);
    loop.pause();
    expect(await loop.stepTicks(Number.NaN)).toBe(0);
    expect(await loop.stepTicks(Number.POSITIVE_INFINITY)).toBe(0);
    expect(await loop.stepTicks("3" as unknown as number)).toBe(0);
    expect(events).toHaveLength(0);
    loop.stop();
  });

  it("pausado: roda n ticks fixos em ordem e um render pausado no fim", async () => {
    const { loop, events } = createHarness();
    loop.setTickRate(50);
    loop.pause();
    expect(await loop.stepTicks(3)).toBe(3);
    expect(ticks(events).map((e) => e.snapshot.tickCount)).toEqual([1, 2, 3]);
    for (const tick of ticks(events)) expect(tick.snapshot.deltaSeconds).toBeCloseTo(0.02, 10);
    expect(ticks(events).at(-1)?.snapshot.totalTimeSeconds).toBeCloseTo(0.06, 10);
    expect(renders(events)).toHaveLength(1);
    expect(events.at(-1)?.type).toBe("game.loop.render");
    expect(renders(events)[0]?.snapshot).toMatchObject({ isPaused: true, deltaSeconds: 0, realDeltaSeconds: 0 });
    expect(loop.getStats().runningTimeSeconds).toBeCloseTo(0.06, 10);
    expect(loop.getStats().isPaused).toBe(true);
  });

  it("limita n a [1, 600] e trunca frações", async () => {
    const { loop, events } = createHarness();
    loop.pause({ freezeRender: true });
    expect(await loop.stepTicks(0)).toBe(1);
    expect(await loop.stepTicks(2.9)).toBe(2);
    events.length = 0;
    expect(await loop.stepTicks(10_000)).toBe(GAME_LOOP_MAX_MANUAL_STEPS);
    expect(ticks(events)).toHaveLength(600);
    // freezeRender não impede o render único do passo manual.
    expect(renders(events)).toHaveLength(1);
  });

  it("aguarda cada tick (handlers assíncronos) e serializa chamadas concorrentes", async () => {
    const order: string[] = [];
    let active = 0;
    const { loop } = createHarness(async (type) => {
      if (type !== "game.loop.tick") return;
      active += 1;
      expect(active).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 1));
      order.push("tick");
      active -= 1;
    });
    loop.pause();
    const [a, b] = await Promise.all([loop.stepTicks(2), loop.stepTicks(3)]);
    expect(a + b).toBe(5);
    expect(order).toHaveLength(5);
  });

  it("espera o frame do RAF em andamento e não roda em paralelo com ele", async () => {
    let releaseRender: (() => void) | null = null;
    const log: string[] = [];
    const { timing, loop } = createHarness(async (type) => {
      log.push(type);
      if (type === "game.loop.render" && releaseRender === null && log.length === 1) {
        await new Promise<void>((resolve) => {
          releaseRender = resolve;
        });
      }
    });
    loop.start();
    loop.pause();
    const frame = timing.fire(16); // render pausado bloqueado
    const step = loop.stepTicks(1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(log).toEqual(["game.loop.render"]);
    (releaseRender as unknown as () => void)();
    await frame;
    expect(await step).toBe(1);
    expect(log).toEqual(["game.loop.render", "game.loop.tick", "game.loop.render"]);
    loop.stop();
  });

  it("depois do resume o loop segue do tick seguinte, sem catch-up", async () => {
    const { timing, loop, events } = createHarness();
    loop.start();
    await timing.fire(17);
    loop.pause();
    await loop.stepTicks(2);
    loop.resume();
    events.length = 0;
    await timing.fire(17);
    expect(ticks(events).map((e) => e.snapshot.tickCount)).toEqual([4]);
    loop.stop();
  });
});
