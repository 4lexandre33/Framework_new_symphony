import type { Plugin, PluginContext } from "../../core/contracts/plugin-context";
import { InputToken } from "../../tokens/input";
import { InputActionEvent, InputDeviceChangedEvent } from "../../contracts/input/types";
import { InputManager } from "../../engine/input/InputManager";

export const inputManifest: Plugin["manifest"] = {
  id: "game.input",
  name: "Input Manager & Abstraction Plugin",
  version: "1.0.0",
  kind: "preloaded",
  authority: "game",
  permissions: {
    capabilities: [InputToken.id],
    events: ["game.input.action", "game.input.device-changed"],
  },
  capabilities: {
    provides: [
      {
        id: InputToken.id,
        version: "1.0.0",
      },
    ],
  },
};

export function createInputPlugin(): Plugin {
  return {
    manifest: inputManifest,

    setup(ctx: PluginContext) {
      const inputManager = new InputManager();

      ctx.caps.provide(InputToken, inputManager);

      ctx.events.define(InputActionEvent);
      ctx.events.define(InputDeviceChangedEvent);

      ctx.lifecycle.onDispose(() => {
        inputManager.dispose();
      });

      ctx.lifecycle.ready();
    },
  };
}