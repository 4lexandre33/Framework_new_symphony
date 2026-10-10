import type {
  Plugin,
  PluginContext,
} from "@core";

import {
  GamepadConnectionEvent,
  InputActionEvent,
  InputDeviceChangedEvent,
  PointerLockChangedEvent,
} from "../../contracts/input/types";

import type {
  GamepadConnectionPayload,
  InputActionEventOptions,
  InputActionPayload,
  InputDeviceChangedPayload,
  InputFilterOptions,
  PointerLockChangedPayload,
} from "../../contracts/input/types";

import {
  GameRenderEvent,
  GameTickEvent,
} from "../../contracts/game-loop/types";

import type {
  GameRenderPayload,
} from "../../contracts/game-loop/types";

import {
  InputFramePump,
} from "../../engine/input/internal/InputFramePump";

import type {
  InputFrameScheduler,
} from "../../engine/input/internal/InputFramePump";

import {
  InputManager,
} from "../../engine/input/internal/InputManager";

import type {
  InputEventSink,
} from "../../engine/input/internal/InputManager";

import {
  InputToken,
} from "../../tokens/input";

export interface InputPluginOptions {
  readonly frameScheduler?:
    InputFrameScheduler;
  /** Zona morta inicial dos eixos do gamepad (0 <= v < 1; padrão 0,15). */
  readonly gamepadDeadZone?: number;
  /** Filtros de foco/alvo do DOM (ver InputFilterOptions). */
  readonly filters?: InputFilterOptions;
  /** Emissão de `game.input.action` (ex.: `{ emitHeld: false }`). */
  readonly actionEvents?: InputActionEventOptions;
}

export const inputManifest:
  Plugin["manifest"] = {
    id:
      "game.input",

    name:
      "Desktop Input Runtime Plugin",

    version:
      "1.0.0",

    kind:
      "preloaded",

    authority:
      "game",

    permissions: {
      capabilities: [
        InputToken.id,
      ],

      events: [
        InputActionEvent.type,
        InputDeviceChangedEvent.type,
        PointerLockChangedEvent.type,
        GamepadConnectionEvent.type,
        "kernel.booted",
        // Assinados (opcionais): sincronizam as bordas por tick. Sem o
        // game loop o input continua funcionando sozinho (bordas por frame).
        GameTickEvent.type,
        GameRenderEvent.type,
      ],
    },

    capabilities: {
      provides: [
        {
          id:
            InputToken.id,

          version:
            "1.0.0",
        },
      ],

      conflicts:
        [],
    },
  };

export function createInputPlugin(
  options:
    InputPluginOptions =
      {},
): Plugin {
  return {
    manifest:
      inputManifest,

    setup(
      ctx:
        PluginContext,
    ): void {
      const eventSink:
        InputEventSink = {
          onAction(
            payload:
              InputActionPayload,
          ): void {
            ctx.events.emit(
              InputActionEvent.type,
              payload,
            );
          },

          onDeviceChanged(
            payload:
              InputDeviceChangedPayload,
          ): void {
            ctx.events.emit(
              InputDeviceChangedEvent.type,
              payload,
            );
          },

          onPointerLockChanged(
            payload:
              PointerLockChangedPayload,
          ): void {
            ctx.events.emit(
              PointerLockChangedEvent.type,
              payload,
            );
          },

          onGamepadConnection(
            payload:
              GamepadConnectionPayload,
          ): void {
            ctx.events.emit(
              GamepadConnectionEvent.type,
              payload,
            );
          },
        };

      const inputManager =
        new InputManager(
          eventSink,
        );

      if (
        options.gamepadDeadZone !==
        undefined
      ) {
        inputManager.setGamepadDeadZone(
          options.gamepadDeadZone,
        );
      }

      if (
        options.filters !==
        undefined
      ) {
        inputManager.setFilterOptions(
          options.filters,
        );
      }

      if (
        options.actionEvents !==
        undefined
      ) {
        inputManager.setActionEventOptions(
          options.actionEvents,
        );
      }

      // O pump é o único dono do frame de input: InputApi.update() vira
      // no-op para o jogo (G49).
      const framePump =
        new InputFramePump(
          inputManager.claimFramePump(),
          options.frameScheduler,
        );

      ctx.caps.provide(
        InputToken,
        inputManager,
      );

      ctx.events.define(
        InputActionEvent,
      );

      ctx.events.define(
        InputDeviceChangedEvent,
      );

      ctx.events.define(
        PointerLockChangedEvent,
      );

      ctx.events.define(
        GamepadConnectionEvent,
      );

      // Bordas por tick fixo: cada tick publica o que chegou desde o
      // anterior (exatamente uma vez por pressão). Pausado (render com
      // isPaused), descarta o acumulado para a pressão que despausa não
      // reaparecer no primeiro tick.
      const unbindTick =
        ctx.events.on(
          GameTickEvent.type,
          (): void => {
            inputManager.advanceTick();
          },
        );

      const unbindRender =
        ctx.events.on(
          GameRenderEvent.type,
          (
            envelope,
          ): void => {
            const payload =
              envelope.payload as
                GameRenderPayload |
                undefined;

            if (
              payload?.isPaused ===
              true
            ) {
              inputManager.discardPendingTickEdges();
            }
          },
        );

      const unbindKernelBooted =
        ctx.events.on(
          "kernel.booted",
          (): void => {
            framePump.start();
          },
        );

      ctx.lifecycle.onDispose(
        (): void => {
          unbindKernelBooted();
          unbindTick();
          unbindRender();

          framePump.dispose();
          inputManager.dispose();
        },
      );

      ctx.lifecycle.ready();
    },
  };
}
