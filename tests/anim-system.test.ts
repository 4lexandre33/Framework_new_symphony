import {
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  AnimationStateMachine,
} from "../src/engine/anim/internal/AnimationStateMachine";

import {
  AnimationState,
} from "../src/engine/anim/internal/AnimationState";

import {
  Sprite2DAnimationDriver,
} from "../src/engine/anim/internal/Sprite2DAnimationDriver";

import type {
  SpriteAnimationFrame,
} from "../src/contracts/anim/types";

describe(
  "Camada de Animações & Máquina de Estados (game.anim)",
  (): void => {
    let fsm:
      AnimationStateMachine;

    beforeEach(
      (): void => {
        fsm =
          new AnimationStateMachine();
      },
    );

    it(
      "deve alternar estados de animação via parâmetros e transições FSM",
      (): void => {
        fsm.addState(
          new AnimationState(
            "Idle",
            "clip_idle",
          ),
        );

        fsm.addState(
          new AnimationState(
            "Run",
            "clip_run",
          ),
        );

        const transitionRegistered =
          fsm.addTransition({
            fromState:
              "Idle",

            toState:
              "Run",

            durationSeconds:
              0.1,

            conditionParam:
              "speed",

            conditionOperator:
              ">",

            conditionValue:
              0.5,
          });

        expect(
          transitionRegistered,
        ).toBe(
          true,
        );

        expect(
          fsm.getCurrentStateName(),
        ).toBe(
          "Idle",
        );

        fsm.setParam(
          "speed",
          1.2,
        );

        const updateResult =
          fsm.update(
            0.016,
          );

        expect(
          updateResult.currentState,
        ).toBe(
          "Idle",
        );

        expect(
          updateResult.targetState,
        ).toBe(
          "Run",
        );

        expect(
          updateResult.weight,
        ).toBeGreaterThan(
          0,
        );

        expect(
          updateResult.weight,
        ).toBeLessThan(
          1,
        );

        fsm.update(
          0.1,
        );

        expect(
          fsm.getCurrentStateName(),
        ).toBe(
          "Run",
        );

        expect(
          fsm.getTargetStateName(),
        ).toBeNull();
      },
    );

    it(
      "deve realizar CrossFade manual entre dois estados",
      (): void => {
        fsm.addState(
          new AnimationState(
            "Walk",
            "clip_walk",
          ),
        );

        fsm.addState(
          new AnimationState(
            "Attack",
            "clip_attack",
          ),
        );

        const started =
          fsm.startCrossFade(
            "Attack",
            0.2,
          );

        expect(
          started,
        ).toBe(
          true,
        );

        const step1 =
          fsm.update(
            0.1,
          );

        expect(
          step1.currentState,
        ).toBe(
          "Walk",
        );

        expect(
          step1.targetState,
        ).toBe(
          "Attack",
        );

        expect(
          step1.weight,
        ).toBeCloseTo(
          0.5,
          1,
        );

        const step2 =
          fsm.update(
            0.1,
          );

        expect(
          step2.currentState,
        ).toBe(
          "Attack",
        );

        expect(
          step2.targetState,
        ).toBeNull();

        expect(
          fsm.getCurrentStateName(),
        ).toBe(
          "Attack",
        );
      },
    );

    it(
      "deve realizar troca imediata quando o CrossFade tiver duração zero",
      (): void => {
        fsm.addState(
          new AnimationState(
            "Idle",
            "clip_idle",
          ),
        );

        fsm.addState(
          new AnimationState(
            "Hit",
            "clip_hit",
          ),
        );

        expect(
          fsm.startCrossFade(
            "Hit",
            0,
          ),
        ).toBe(
          true,
        );

        expect(
          fsm.getCurrentStateName(),
        ).toBe(
          "Hit",
        );

        expect(
          fsm.getTargetStateName(),
        ).toBeNull();
      },
    );

    it(
      "deve rejeitar uma transição cujo estado de destino não esteja registrado",
      (): void => {
        fsm.addState(
          new AnimationState(
            "Idle",
            "clip_idle",
          ),
        );

        const registered =
          fsm.addTransition({
            fromState:
              "Idle",

            toState:
              "EstadoInexistente",

            durationSeconds:
              0.2,
          });

        expect(
          registered,
        ).toBe(
          false,
        );
      },
    );

    it(
      "deve aplicar o primeiro quadro UV imediatamente e avançar para o próximo quadro",
      (): void => {
        const driver =
          new Sprite2DAnimationDriver();

        const mockMap = {
          offset: {
            x: 0,
            y: 0,

            set(
              x: number,
              y: number,
            ): void {
              this.x = x;
              this.y = y;
            },
          },

          repeat: {
            x: 1,
            y: 1,

            set(
              x: number,
              y: number,
            ): void {
              this.x = x;
              this.y = y;
            },
          },
        };

        const mockMaterial = {
          map:
            mockMap,
        };

        const frames:
          SpriteAnimationFrame[] = [
            {
              frameIndex:
                0,

              durationMs:
                100,

              uvOffset: {
                x: 0,
                y: 0,
              },

              uvScale: {
                x: 0.25,
                y: 1,
              },
            },

            {
              frameIndex:
                1,

              durationMs:
                100,

              uvOffset: {
                x: 0.25,
                y: 0,
              },

              uvScale: {
                x: 0.25,
                y: 1,
              },
            },
          ];

        driver.register(
          "hero_2d",
          mockMaterial,
          frames,
        );

        /*
         * Primeiro frame precisa ser aplicado
         * durante o register().
         */
        expect(
          mockMap.offset.x,
        ).toBe(
          0,
        );

        expect(
          mockMap.repeat.x,
        ).toBe(
          0.25,
        );

        expect(
          driver.getCurrentFrameIndex(
            "hero_2d",
          ),
        ).toBe(
          0,
        );

        driver.update(
          0.11,
        );

        expect(
          mockMap.offset.x,
        ).toBe(
          0.25,
        );

        expect(
          driver.getCurrentFrameIndex(
            "hero_2d",
          ),
        ).toBe(
          1,
        );

        driver.dispose();
      },
    );

    it(
      "deve recuperar corretamente múltiplos frames quando houver um delta grande",
      (): void => {
        const driver =
          new Sprite2DAnimationDriver();

        const mockMap = {
          offset: {
            x: 0,
            y: 0,

            set(
              x: number,
              y: number,
            ): void {
              this.x = x;
              this.y = y;
            },
          },

          repeat: {
            x: 1,
            y: 1,

            set(
              x: number,
              y: number,
            ): void {
              this.x = x;
              this.y = y;
            },
          },
        };

        const frames:
          SpriteAnimationFrame[] = [
            {
              frameIndex:
                0,

              durationMs:
                100,

              uvOffset: {
                x: 0,
                y: 0,
              },

              uvScale: {
                x: 0.25,
                y: 1,
              },
            },

            {
              frameIndex:
                1,

              durationMs:
                100,

              uvOffset: {
                x: 0.25,
                y: 0,
              },

              uvScale: {
                x: 0.25,
                y: 1,
              },
            },

            {
              frameIndex:
                2,

              durationMs:
                100,

              uvOffset: {
                x: 0.5,
                y: 0,
              },

              uvScale: {
                x: 0.25,
                y: 1,
              },
            },
          ];

        driver.register(
          "enemy_2d",
          {
            map:
              mockMap,
          },
          frames,
        );

        /*
         * 250ms:
         *
         * frame 0 = 0-100
         * frame 1 = 100-200
         * frame 2 = 200-300
         */
        driver.update(
          0.25,
        );

        expect(
          driver.getCurrentFrameIndex(
            "enemy_2d",
          ),
        ).toBe(
          2,
        );

        expect(
          mockMap.offset.x,
        ).toBe(
          0.5,
        );

        driver.dispose();
      },
    );
  },
);