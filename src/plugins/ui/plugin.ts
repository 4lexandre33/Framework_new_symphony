import type { Plugin, PluginContext } from "@core";
import { UIToken } from "../../tokens/ui";
import { ScreenChangedEvent, ModalPushedEvent, LocaleChangedEvent, HUDUpdatedEvent, OpenScreenCommand, PushModalCommand, PopModalCommand, SetLocaleCommand, BindHUDValueCommand, type OpenScreenRequest, type PushModalRequest, type SetLocaleRequest, type BindHUDValueRequest } from "../../contracts/ui/types";
import { UIService } from "../../engine/ui/internal/UIService";

export const uiManifest:
  Plugin["manifest"] = {
    id:
      "game.ui",

    name:
      "Reactive User Interface & HUD Plugin",

    version:
      "1.0.0",

    kind:
      "preloaded",

    authority:
      "game",

    permissions: {
      capabilities: [
        UIToken.id,
      ],

      events: [
        "game.ui.screen-changed",
        "game.ui.modal-pushed",
        "game.ui.locale-changed",
        "game.ui.hud-updated",
      ],
    },

    capabilities: {
      provides: [
        {
          id:
            UIToken.id,

          version:
            "1.0.0",
        },
      ],
      conflicts: [],
    },
  };

export function createUIPlugin():
  Plugin {
  return {
    manifest:
      uiManifest,

    setup(
      ctx: PluginContext,
    ): void {
      const uiService =
        new UIService(
          ctx,
        );

      ctx.caps.provide(
        UIToken,
        uiService,
      );

      ctx.events.define(
        ScreenChangedEvent,
      );

      ctx.events.define(
        ModalPushedEvent,
      );

      ctx.events.define(
        LocaleChangedEvent,
      );

      ctx.events.define(
        HUDUpdatedEvent,
      );

      ctx.commands.define(
        OpenScreenCommand,
      );

      ctx.commands.define(
        PushModalCommand,
      );

      ctx.commands.define(
        PopModalCommand,
      );

      ctx.commands.define(
        SetLocaleCommand,
      );

      ctx.commands.define(
        BindHUDValueCommand,
      );

      const unbindOpen =
        ctx.commands.handle(
          "game.ui.open-screen",
          (
            envelope,
          ) => {
            const payload =
              envelope.payload as
                OpenScreenRequest;

            uiService.openScreen(
              payload.screenId,
            );
          },
        );

      const unbindPush =
        ctx.commands.handle(
          "game.ui.push-modal",
          (
            envelope,
          ) => {
            const payload =
              envelope.payload as
                PushModalRequest;

            uiService.pushModal(
              payload.config,
            );
          },
        );

      const unbindPop =
        ctx.commands.handle(
          "game.ui.pop-modal",
          () => {
            return uiService
              .popModal();
          },
        );

      const unbindLocale =
        ctx.commands.handle(
          "game.ui.set-locale",
          (
            envelope,
          ) => {
            const payload =
              envelope.payload as
                SetLocaleRequest;

            uiService.setLocale(
              payload.locale,
            );
          },
        );

      const unbindBind =
        ctx.commands.handle(
          "game.ui.bind-hud-value",
          (
            envelope,
          ) => {
            const payload =
              envelope.payload as
                BindHUDValueRequest;

            uiService.updateHUD(
              payload.key,
              payload.value,
            );
          },
        );

      ctx.lifecycle.onDispose(
        (): void => {
          unbindOpen();
          unbindPush();
          unbindPop();
          unbindLocale();
          unbindBind();

          uiService.dispose();
        },
      );

      ctx.lifecycle.ready();
    },
  };
}