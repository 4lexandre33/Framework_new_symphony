// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  PluginContext,
} from "@core";

import {
  DeterministicGameLoop,
  GAME_LOOP_DEFAULT_TICK_RATE,
  GAME_LOOP_MAX_FRAME_DELTA_SECONDS,
  GAME_LOOP_MAX_FIXED_STEPS_PER_FRAME,
  GAME_LOOP_MAX_TICK_RATE,
  GAME_LOOP_MIN_TICK_RATE,
  type GameLoopTimingDriver,
} from "../src/engine/game-loop/internal/DeterministicGameLoop";

interface EventRecord {
  readonly type: string;
  readonly payload: unknown;
  readonly snapshot: Readonly<Record<string, number>>;
}

class ManualTimingDriver
implements GameLoopTimingDriver {
  private nowMs = 0;
  private nextId = 1;
  private callback:
    ((timestampMs: number) => Promise<void>) |
    null = null;
  private scheduledId:
    number | null = null;

  public now(): number {
    return this.nowMs;
  }

  public requestFrame(
    callback:
      (timestampMs: number) => Promise<void>,
  ): number {
    if (this.callback !== null) {
      throw new Error(
        "mais de um RAF foi agendado simultaneamente",
      );
    }

    const id =
      this.nextId++;

    this.callback =
      callback;
    this.scheduledId =
      id;

    return id;
  }

  public cancelFrame(
    frameId: number,
  ): void {
    if (
      this.scheduledId ===
      frameId
    ) {
      this.callback =
        null;
      this.scheduledId =
        null;
    }
  }

  public setNow(
    valueMs: number,
  ): void {
    this.nowMs =
      valueMs;
  }

  public hasScheduledFrame(): boolean {
    return this.callback !==
      null;
  }

  public async step(
    deltaMs: number,
  ): Promise<void> {
    const callback =
      this.callback;

    if (
      callback === null
    ) {
      throw new Error(
        "nenhum RAF agendado",
      );
    }

    this.callback =
      null;
    this.scheduledId =
      null;
    this.nowMs +=
      deltaMs;

    await callback(
      this.nowMs,
    );
  }

  public async fireAt(
    timestampMs: number,
  ): Promise<void> {
    const callback =
      this.callback;

    if (
      callback === null
    ) {
      throw new Error(
        "nenhum RAF agendado",
      );
    }

    this.callback =
      null;
    this.scheduledId =
      null;
    this.nowMs =
      timestampMs;

    await callback(
      timestampMs,
    );
  }
}

function createHarness(
  onEmit?: (
    type: string,
    payload: unknown,
  ) => Promise<void>,
): {
  readonly timing: ManualTimingDriver;
  readonly loop: DeterministicGameLoop;
  readonly events: EventRecord[];
} {
  const timing =
    new ManualTimingDriver();
  const events:
    EventRecord[] =
    [];

  const ctx = {
    log: {
      error(): void {
        // Erros de frame são assertados via estado/scheduling nos testes.
      },
    },
    events: {
      async emitAsync(
        type: string,
        payload: unknown,
      ): Promise<void> {
        const numeric =
          payload as
            Record<string, number>;

        events.push({
          type,
          payload,
          snapshot:
            Object.freeze({
              ...numeric,
            }),
        });

        if (
          onEmit !== undefined
        ) {
          await onEmit(
            type,
            payload,
          );
        }
      },
    },
  } as unknown as PluginContext;

  return {
    timing,
    loop:
      new DeterministicGameLoop(
        ctx,
        timing,
      ),
    events,
  };
}

function ticks(
  events: readonly EventRecord[],
): readonly EventRecord[] {
  return events.filter(
    (entry) =>
      entry.type ===
      "game.loop.tick",
  );
}

function renders(
  events: readonly EventRecord[],
): readonly EventRecord[] {
  return events.filter(
    (entry) =>
      entry.type ===
      "game.loop.render",
  );
}

describe(
  "Etapa 75 — Deterministic Game Loop",
  () => {
    it(
      "usa fixed timestep, accumulator e interpolação",
      async () => {
        const {
          timing,
          loop,
          events,
        } =
          createHarness();

        loop.start();

        expect(
          timing.hasScheduledFrame(),
        ).toBe(true);

        await timing.step(8);

        expect(
          ticks(events),
        ).toHaveLength(0);

        expect(
          renders(events),
        ).toHaveLength(1);

        expect(
          renders(events)[0]
            ?.snapshot
            .alphaInterpolation,
        ).toBeCloseTo(
          0.48,
          10,
        );

        await timing.step(9);

        expect(
          ticks(events),
        ).toHaveLength(1);

        expect(
          ticks(events)[0]
            ?.snapshot
            .deltaSeconds,
        ).toBeCloseTo(
          1 / 60,
          12,
        );

        expect(
          ticks(events)[0]
            ?.snapshot
            .tickCount,
        ).toBe(1);

        expect(
          loop.getStats()
            .runningTimeSeconds,
        ).toBeCloseTo(
          1 / 60,
          12,
        );

        const alpha =
          renders(events)[1]
            ?.snapshot
            .alphaInterpolation ??
          -1;

        expect(alpha)
          .toBeGreaterThanOrEqual(0);
        expect(alpha)
          .toBeLessThan(1);
      },
    );

    it(
      "clampa frame spike e descarta wall time além de 250ms",
      async () => {
        const {
          timing,
          loop,
          events,
        } =
          createHarness();

        loop.start();
        await timing.step(1000);

        expect(
          ticks(events),
        ).toHaveLength(15);

        expect(
          renders(events)[0]
            ?.snapshot
            .deltaSeconds,
        ).toBe(
          GAME_LOOP_MAX_FRAME_DELTA_SECONDS,
        );

        expect(
          loop.getStats()
            .runningTimeSeconds,
        ).toBeCloseTo(
          0.25,
          12,
        );

        expect(
          loop
            .getDeterminismDiagnostics()
            .droppedWallTimeSeconds,
        ).toBeCloseTo(
          0.75,
          12,
        );

        expect(
          loop
            .getDeterminismDiagnostics()
            .tickCount,
        ).toBe(15);
      },
    );

    it(
      "pause/resume não acumula catch-up de wall clock",
      async () => {
        const {
          timing,
          loop,
          events,
        } =
          createHarness();

        loop.start();
        await timing.step(17);

        expect(
          ticks(events),
        ).toHaveLength(1);

        loop.pause();
        await timing.step(5000);

        expect(
          ticks(events),
        ).toHaveLength(1);
        expect(
          loop.getStats()
            .isPaused,
        ).toBe(true);

        loop.resume();
        await timing.step(17);

        expect(
          ticks(events),
        ).toHaveLength(2);
        expect(
          loop.getStats()
            .isPaused,
        ).toBe(false);
      },
    );

    it(
      "rejeita tick rates inválidos sem envenenar fixed delta",
      async () => {
        const {
          timing,
          loop,
          events,
        } =
          createHarness();

        expect(
          GAME_LOOP_DEFAULT_TICK_RATE,
        ).toBe(60);
        expect(
          GAME_LOOP_MIN_TICK_RATE,
        ).toBe(1);
        expect(
          GAME_LOOP_MAX_TICK_RATE,
        ).toBe(240);
        expect(
          GAME_LOOP_MAX_FIXED_STEPS_PER_FRAME,
        ).toBe(60);

        loop.setTickRate(120);
        expect(
          loop.getStats()
            .tickRate,
        ).toBe(120);

        loop.setTickRate(0);
        loop.setTickRate(-1);
        loop.setTickRate(
          Number.NaN,
        );
        loop.setTickRate(
          Number.POSITIVE_INFINITY,
        );
        loop.setTickRate(241);

        expect(
          loop.getStats()
            .tickRate,
        ).toBe(120);

        loop.start();
        await timing.step(25);

        expect(
          ticks(events),
        ).toHaveLength(3);

        for (
          const tick of
          ticks(events)
        ) {
          expect(
            tick.snapshot
              .deltaSeconds,
          ).toBeCloseTo(
            1 / 120,
            12,
          );
        }
      },
    );

    it(
      "normaliza timestamps regressivos/NaN sem alpha negativo ou NaN",
      async () => {
        const {
          timing,
          loop,
          events,
        } =
          createHarness();

        timing.setNow(100);
        loop.start();

        await timing.fireAt(90);
        await timing.fireAt(
          Number.NaN,
        );
        await timing.fireAt(110);

        for (
          const render of
          renders(events)
        ) {
          expect(
            Number.isFinite(
              render.snapshot
                .alphaInterpolation,
            ),
          ).toBe(true);
          expect(
            render.snapshot
              .alphaInterpolation,
          ).toBeGreaterThanOrEqual(0);
          expect(
            render.snapshot
              .alphaInterpolation,
          ).toBeLessThan(1);
          expect(
            render.snapshot
              .deltaSeconds,
          ).toBeGreaterThanOrEqual(0);
        }
      },
    );

    it(
      "serializa fixed ticks e mantém payload estável durante handler assíncrono",
      async () => {
        let concurrent =
          0;
        let maxConcurrent =
          0;
        const observed:
          number[] =
          [];

        const {
          timing,
          loop,
          events,
        } =
          createHarness(
            async (
              type,
              payload,
            ) => {
              if (
                type !==
                "game.loop.tick"
              ) {
                return;
              }

              concurrent +=
                1;
              maxConcurrent =
                Math.max(
                  maxConcurrent,
                  concurrent,
                );

              const tick =
                payload as {
                  readonly tickCount:
                    number;
                };

              const before =
                tick.tickCount;

              await Promise.resolve();
              await Promise.resolve();

              const after =
                tick.tickCount;

              expect(after)
                .toBe(before);

              observed.push(after);
              concurrent -=
                1;
            },
          );

        loop.start();
        await timing.step(50);

        expect(maxConcurrent)
          .toBe(1);
        expect(observed)
          .toEqual([
            1,
            2,
            3,
          ]);

        const tickEvents =
          ticks(events);

        expect(
          tickEvents[0]
            ?.payload,
        ).toBe(
          tickEvents[1]
            ?.payload,
        );
        expect(
          tickEvents[1]
            ?.payload,
        ).toBe(
          tickEvents[2]
            ?.payload,
        );
      },
    );

    it(
      "não agenda frames sobrepostos e stop cancela o único RAF pendente",
      async () => {
        const {
          timing,
          loop,
        } =
          createHarness();

        loop.start();
        loop.start();

        expect(
          timing.hasScheduledFrame(),
        ).toBe(true);

        await timing.step(16);

        expect(
          timing.hasScheduledFrame(),
        ).toBe(true);

        loop.stop();
        loop.stop();

        expect(
          timing.hasScheduledFrame(),
        ).toBe(false);

        expect(
          loop
            .getDeterminismDiagnostics()
            .scheduledFrame,
        ).toBe(false);
      },
    );
  },
);
