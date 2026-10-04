import type { Plugin, PluginContext } from "@core";
import { AnimationToken } from "../../tokens/anim";
import { AnimationStateChangedEvent, AnimationTriggeredEvent, PlayAnimationCommand, CrossFadeCommand, SetAnimParamCommand, type CrossFadeRequest, type PlayAnimationRequest, type SetAnimParamRequest } from "../../contracts/anim/types";
import type { GameRenderPayload, GameTickPayload } from "../../contracts/game-loop/types";
import { AnimationService } from "../../engine/anim/internal/AnimationService";

export const animManifest:
  Plugin["manifest"] = {
    id:
      "game.anim",

    name:
      "Animation Pipeline & State Machine Plugin",

    version:
      "1.0.0",

    kind:
      "preloaded",

    authority:
      "game",

    dependsOn: [
      {
        id:
          "game.loop",

        range:
          "^1.0.0",
      },
    ],

    permissions: {
      capabilities: [
        AnimationToken.id,
      ],

      events: [
        "game.anim.state-changed",
        "game.anim.event-triggered",
      ],
    },

    capabilities: {
      provides: [
        {
          id:
            AnimationToken.id,

          version:
            "1.0.0",
        },
      ],
      conflicts: [],
    },
  };

export function createAnimationPlugin():
  Plugin {
  return {
    manifest:
      animManifest,

    setup(
      ctx: PluginContext,
    ): void {
      const animService =
        new AnimationService(
          ctx,
        );

      ctx.caps.provide(
        AnimationToken,
        animService,
      );

      ctx.events.define(
        AnimationStateChangedEvent,
      );

      ctx.events.define(
        AnimationTriggeredEvent,
      );

      ctx.commands.define(
        PlayAnimationCommand,
      );

      ctx.commands.define(
        CrossFadeCommand,
      );

      ctx.commands.define(
        SetAnimParamCommand,
      );

      const unbindTick =
        ctx.events.on(
          "game.loop.tick",
          (
            envelope,
          ): void => {
            const payload =
              envelope.payload as
                GameTickPayload;

            animService.tick(
              payload.deltaSeconds,
            );
          },
        );

      const unbindRender =
        ctx.events.on(
          "game.loop.render",
          (
            envelope,
          ): void => {
            const payload =
              envelope.payload as
                GameRenderPayload;

            animService.render(
              payload.deltaSeconds,
            );
          },
        );

      const unbindPlay =
        ctx.commands.handle(
          "game.anim.play",
          (
            envelope,
          ) => {
            const payload =
              envelope.payload as
                PlayAnimationRequest;

            return animService
              .playAnimation(
                payload.entityId,
                payload.stateName,
                payload.fadeDurationSeconds,
              );
          },
        );

      const unbindCrossFade =
        ctx.commands.handle(
          "game.anim.cross-fade",
          (
            envelope,
          ) => {
            const payload =
              envelope.payload as
                CrossFadeRequest;

            return animService
              .crossFade(
                payload.entityId,
                payload.fromState,
                payload.toState,
                payload.durationSeconds,
              );
          },
        );

      const unbindSetParam =
        ctx.commands.handle(
          "game.anim.set-param",
          (
            envelope,
          ) => {
            const payload =
              envelope.payload as
                SetAnimParamRequest;

            animService.setParam(
              payload.entityId,
              payload.paramName,
              payload.value,
            );
          },
        );

      ctx.lifecycle.onDispose(
        (): void => {
          unbindTick();
          unbindRender();
          unbindPlay();
          unbindCrossFade();
          unbindSetParam();

          animService.dispose();
        },
      );

      ctx.lifecycle.ready();
    },
  };
}