// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  addDomainDurations,
  addSimulationTicks,
  createDomainDuration,
  createSimulationTick,
  DomainDurationError,
  SimulationTickError,
  SimulationTimer,
  SimulationTimerError,
  subtractDomainDurations,
} from "../src/domain/time";

describe(
  "Etapa 48 — SimulationTick",
  () => {
    it(
      "cria e soma ticks inteiros seguros",
      () => {
        const tick =
          createSimulationTick(10);

        expect(tick).toBe(10);

        expect(
          addSimulationTicks(
            tick,
            5,
          ),
        ).toBe(15);
      },
    );

    it(
      "rejeita ticks inválidos e overflow",
      () => {
        expect(() =>
          createSimulationTick(
            -1,
          ),
        ).toThrow(
          SimulationTickError,
        );

        expect(() =>
          createSimulationTick(
            1.5,
          ),
        ).toThrow(
          SimulationTickError,
        );

        const nearMax =
          createSimulationTick(
            Number.MAX_SAFE_INTEGER,
          );

        expect(() =>
          addSimulationTicks(
            nearMax,
            1,
          ),
        ).toThrow(
          SimulationTickError,
        );
      },
    );
  },
);

describe(
  "Etapa 48 — DomainDuration",
  () => {
    it(
      "soma e subtrai durações deterministicamente",
      () => {
        const a =
          createDomainDuration(10);

        const b =
          createDomainDuration(5);

        expect(
          addDomainDurations(
            a,
            b,
          ),
        ).toBe(15);

        expect(
          subtractDomainDurations(
            a,
            b,
          ),
        ).toBe(5);

        expect(
          subtractDomainDurations(
            b,
            a,
          ),
        ).toBe(0);
      },
    );

    it(
      "rejeita duração negativa/fracionária e overflow",
      () => {
        expect(() =>
          createDomainDuration(
            -1,
          ),
        ).toThrow(
          DomainDurationError,
        );

        expect(() =>
          createDomainDuration(
            0.25,
          ),
        ).toThrow(
          DomainDurationError,
        );

        expect(() =>
          addDomainDurations(
            createDomainDuration(
              Number.MAX_SAFE_INTEGER,
            ),
            createDomainDuration(
              1,
            ),
          ),
        ).toThrow(
          DomainDurationError,
        );
      },
    );
  },
);

describe(
  "Etapa 48 — SimulationTimer",
  () => {
    it(
      "executa idle -> running -> completed por advance",
      () => {
        const timer =
          new SimulationTimer({
            duration:
              createDomainDuration(
                10,
              ),
          });

        expect(timer.status).toBe(
          "idle",
        );

        timer.start();

        expect(
          timer.advance(
            createDomainDuration(
              4,
            ),
          ),
        ).toBe(4);

        expect(timer.elapsed).toBe(
          4,
        );

        expect(
          timer.remaining,
        ).toBe(6);

        expect(
          timer.progress01,
        ).toBe(0.4);

        expect(
          timer.advance(
            createDomainDuration(
              100,
            ),
          ),
        ).toBe(6);

        expect(timer.elapsed).toBe(
          10,
        );

        expect(
          timer.remaining,
        ).toBe(0);

        expect(timer.status).toBe(
          "completed",
        );

        expect(
          timer.isCompleted,
        ).toBe(true);
      },
    );

    it(
      "pause impede consumo de elapsed e resume continua",
      () => {
        const timer =
          new SimulationTimer({
            duration:
              createDomainDuration(
                20,
              ),
            autoStart: true,
          });

        timer.advance(
          createDomainDuration(5),
        );

        timer.pause();

        expect(
          timer.advance(
            createDomainDuration(
              10,
            ),
          ),
        ).toBe(0);

        expect(timer.elapsed).toBe(
          5,
        );

        timer.resume();

        expect(
          timer.advance(
            createDomainDuration(
              3,
            ),
          ),
        ).toBe(3);

        expect(timer.elapsed).toBe(
          8,
        );
      },
    );

    it(
      "complete é explícito e funciona em running/paused",
      () => {
        const running =
          new SimulationTimer({
            duration:
              createDomainDuration(
                10,
              ),
            autoStart: true,
          });

        running.complete();

        expect(
          running.status,
        ).toBe("completed");

        expect(
          running.elapsed,
        ).toBe(10);

        const paused =
          new SimulationTimer({
            duration:
              createDomainDuration(
                7,
              ),
            autoStart: true,
          });

        paused.pause();
        paused.complete();

        expect(
          paused.status,
        ).toBe("completed");

        expect(paused.elapsed).toBe(
          7,
        );
      },
    );

    it(
      "reset restaura estado sem recriar timer",
      () => {
        const timer =
          new SimulationTimer({
            duration:
              createDomainDuration(
                12,
              ),
            autoStart: true,
          });

        timer.advance(
          createDomainDuration(6),
        );

        timer.reset();

        expect(timer.status).toBe(
          "idle",
        );

        expect(timer.elapsed).toBe(
          0,
        );

        timer.reset(true);

        expect(timer.status).toBe(
          "running",
        );

        expect(timer.elapsed).toBe(
          0,
        );
      },
    );

    it(
      "faz round-trip de snapshot running/paused/completed",
      () => {
        const timer =
          new SimulationTimer({
            duration:
              createDomainDuration(
                30,
              ),
            autoStart: true,
          });

        timer.advance(
          createDomainDuration(9),
        );

        timer.pause();

        const snapshot =
          timer.toSnapshot();

        const restored =
          SimulationTimer.fromSnapshot(
            snapshot,
          );

        expect(
          restored.toSnapshot(),
        ).toEqual(snapshot);

        restored.resume();

        restored.advance(
          createDomainDuration(21),
        );

        expect(
          restored.status,
        ).toBe("completed");
      },
    );

    it(
      "rejeita snapshots inconsistentes",
      () => {
        expect(() =>
          SimulationTimer.fromSnapshot({
            durationTicks: 10,
            elapsedTicks: 10,
            status: "running",
          }),
        ).toThrow(
          SimulationTimerError,
        );

        expect(() =>
          SimulationTimer.fromSnapshot({
            durationTicks: 10,
            elapsedTicks: 3,
            status: "completed",
          }),
        ).toThrow(
          SimulationTimerError,
        );

        expect(() =>
          SimulationTimer.fromSnapshot({
            durationTicks: 10,
            elapsedTicks: 2,
            status: "idle",
          }),
        ).toThrow(
          SimulationTimerError,
        );
      },
    );

    it(
      "rejeita duração zero para timer",
      () => {
        expect(() =>
          new SimulationTimer({
            duration:
              createDomainDuration(
                0,
              ),
          }),
        ).toThrow(
          SimulationTimerError,
        );
      },
    );

    it(
      "rejeita transições inválidas",
      () => {
        const timer =
          new SimulationTimer({
            duration:
              createDomainDuration(
                10,
              ),
          });

        expect(() =>
          timer.pause(),
        ).toThrow(
          SimulationTimerError,
        );

        expect(() =>
          timer.resume(),
        ).toThrow(
          SimulationTimerError,
        );

        timer.start();

        expect(() =>
          timer.start(),
        ).toThrow(
          SimulationTimerError,
        );

        timer.complete();

        expect(() =>
          timer.resume(),
        ).toThrow(
          SimulationTimerError,
        );
      },
    );

    it(
      "é determinístico para a mesma sequência de elapsed",
      () => {
        const left =
          new SimulationTimer({
            duration:
              createDomainDuration(
                100,
              ),
            autoStart: true,
          });

        const right =
          new SimulationTimer({
            duration:
              createDomainDuration(
                100,
              ),
            autoStart: true,
          });

        const sequence = [
          1,
          4,
          3,
          7,
          11,
          2,
          9,
        ];

        for (
          const ticks of sequence
        ) {
          const elapsed =
            createDomainDuration(
              ticks,
            );

          left.advance(elapsed);
          right.advance(elapsed);
        }

        expect(
          left.toSnapshot(),
        ).toEqual(
          right.toSnapshot(),
        );
      },
    );
  },
);
