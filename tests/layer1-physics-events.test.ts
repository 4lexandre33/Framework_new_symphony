// @vitest-environment node

import type RAPIER from "@dimforge/rapier3d-compat";

import type {
  PluginContext,
} from "@core";

import {
  describe,
  expect,
  it,
} from "vitest";

import { CollisionEventManager } from "../src/engine/physics/internal/CollisionEventManager";

interface RecordedEvent {
  readonly type:
    string;
  readonly payload:
    unknown;
}

function createContext(
  queued:
    RecordedEvent[],
  serial:
    RecordedEvent[],
): PluginContext {
  return {
    events: {
      emit(
        type:
          string,
        payload:
          unknown,
      ): void {
        queued.push({
          type,
          payload,
        });
      },

      async emitAsync(
        type:
          string,
        payload:
          unknown,
      ): Promise<void> {
        serial.push({
          type,
          payload,
        });
      },
    },
  } as unknown as
    PluginContext;
}

function createEventQueue(
  started:
    boolean,
): RAPIER.EventQueue {
  return {
    drainCollisionEvents(
      callback:
        (
          handle1:
            number,
          handle2:
            number,
          started:
            boolean,
        ) => void,
    ): void {
      callback(
        10,
        20,
        started,
      );
    },

    drainContactForceEvents(
      callback:
        (...args:
          readonly unknown[]) =>
            void,
    ): void {
      void callback;
    },
  } as unknown as
    RAPIER.EventQueue;
}

describe(
  "Etapa 77 — collision/trigger event manager",
  () => {
    it(
      "classifica sensor como trigger-enter e entrega serialmente",
      async (): Promise<void> => {
        const queued:
          RecordedEvent[] =
          [];

        const serial:
          RecordedEvent[] =
          [];

        const manager =
          new CollisionEventManager(
            createContext(
              queued,
              serial,
            ),
          );

        manager.processEvents(
          createEventQueue(
            true,
          ),
          new Map([
            [
              10,
              "player",
            ],
            [
              20,
              "trigger",
            ],
          ]),
          new Map([
            [
              10,
              false,
            ],
            [
              20,
              true,
            ],
          ]),
        );

        await manager
          .flushSerial();

        expect(queued)
          .toEqual([]);

        expect(serial)
          .toEqual([
            {
              type:
                "game.physics.trigger-enter",
              payload: {
                entityIdA:
                  "player",
                entityIdB:
                  "trigger",
                isStarted:
                  true,
                isTrigger:
                  true,
              },
            },
          ]);
      },
    );

    it(
      "classifica collider normal como collision-exit na fila síncrona",
      (): void => {
        const queued:
          RecordedEvent[] =
          [];

        const serial:
          RecordedEvent[] =
          [];

        const manager =
          new CollisionEventManager(
            createContext(
              queued,
              serial,
            ),
          );

        manager.processEvents(
          createEventQueue(
            false,
          ),
          new Map([
            [
              10,
              "a",
            ],
            [
              20,
              "b",
            ],
          ]),
          new Map([
            [
              10,
              false,
            ],
            [
              20,
              false,
            ],
          ]),
        );

        manager.flushQueued();

        expect(serial)
          .toEqual([]);

        expect(queued)
          .toEqual([
            {
              type:
                "game.physics.collision-exit",
              payload: {
                entityIdA:
                  "a",
                entityIdB:
                  "b",
                isStarted:
                  false,
                isTrigger:
                  false,
              },
            },
          ]);
      },
    );
  },
);
