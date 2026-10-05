import type {
  Plugin,
  PluginContext,
} from "@core";

import {
  InputActionEvent,
  InputDeviceChangedEvent,
} from "../../contracts/input/types";

import type {
  InputActionPayload,
  InputDeviceChangedPayload,
} from "../../contracts/input/types";

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
        "kernel.booted",
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
        };

      const inputManager =
        new InputManager(
          eventSink,
        );

      const framePump =
        new InputFramePump(
          inputManager,
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

          framePump.dispose();
          inputManager.dispose();
        },
      );

      ctx.lifecycle.ready();
    },
  };
}
