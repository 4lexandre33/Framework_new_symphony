import type {
  Plugin,
  PluginContext,
} from "@core";

import {
  AssetsToken,
} from "../../tokens/assets";

import {
  RenderToken,
} from "../../tokens/render";

import {
  VfxToken,
} from "../../tokens/vfx";

import type {
  GameRenderPayload,
} from "../../contracts/game-loop/types";

import {
  DecalProjectedEvent,
  PostFXStateChangedEvent,
  ProjectDecalCommand,
  SetPostFXConfigCommand,
  SpawnParticleEmitterCommand,
  TriggerVFXPresetCommand,
  VFXSpawnedEvent,
} from "../../contracts/vfx/types";

import type {
  ProjectDecalRequest,
  SetPostFXConfigRequest,
  SpawnParticleEmitterRequest,
  TriggerVFXPresetRequest,
} from "../../contracts/vfx/types";

import {
  VFXService,
} from "../../engine/vfx/internal/VFXService";

export const vfxManifest:
  Plugin["manifest"] = {
    id:
      "game.vfx",

    name:
      "GPU Particle System, Decals & PostProcessing Plugin",

    version:
      "1.0.0",

    kind:
      "preloaded",

    authority:
      "game",

    permissions: {
      capabilities: [
        VfxToken.id,
        RenderToken.id,
        AssetsToken.id,
      ],

      events: [
        VFXSpawnedEvent.type,
        DecalProjectedEvent.type,
        PostFXStateChangedEvent.type,
        "game.loop.render",
      ],
    },

    capabilities: {
      provides: [
        {
          id:
            VfxToken.id,
          version:
            "1.0.0",
        },
      ],

      consumes: [
        {
          id:
            RenderToken.id,
          range:
            "^1.0.0",
          optional:
            false,
        },
        {
          id:
            AssetsToken.id,
          range:
            "^1.0.0",
          optional:
            false,
        },
      ],

      conflicts:
        [],
    },
  };

export function createVFXPlugin():
  Plugin {
  return {
    manifest:
      vfxManifest,

    setup(
      ctx:
        PluginContext,
    ): void {
      const vfxService =
        new VFXService(
          ctx,
        );

      ctx.caps.provide(
        VfxToken,
        vfxService,
      );

      ctx.events.define(
        VFXSpawnedEvent,
      );

      ctx.events.define(
        DecalProjectedEvent,
      );

      ctx.events.define(
        PostFXStateChangedEvent,
      );

      ctx.commands.define(
        SpawnParticleEmitterCommand,
      );

      ctx.commands.define(
        ProjectDecalCommand,
      );

      ctx.commands.define(
        SetPostFXConfigCommand,
      );

      ctx.commands.define(
        TriggerVFXPresetCommand,
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

            vfxService.update(
              payload.deltaSeconds,
            );
          },
        );

      const unbindSpawnEmitter =
        ctx.commands.handle(
          SpawnParticleEmitterCommand.type,
          (
            envelope,
          ): void => {
            const payload =
              envelope.payload as
                SpawnParticleEmitterRequest;

            vfxService
              .spawnParticleEmitter(
                payload.config,
              );
          },
        );

      const unbindProjectDecal =
        ctx.commands.handle(
          ProjectDecalCommand.type,
          (
            envelope,
          ): void => {
            const payload =
              envelope.payload as
                ProjectDecalRequest;

            vfxService
              .projectDecal(
                payload.config,
              );
          },
        );

      const unbindSetPostFX =
        ctx.commands.handle(
          SetPostFXConfigCommand.type,
          (
            envelope,
          ): void => {
            const payload =
              envelope.payload as
                SetPostFXConfigRequest;

            vfxService
              .configurePostProcessing(
                payload.config,
              );
          },
        );

      const unbindPreset =
        ctx.commands.handle(
          TriggerVFXPresetCommand.type,
          (
            envelope,
          ): void => {
            const payload =
              envelope.payload as
                TriggerVFXPresetRequest;

            vfxService
              .triggerVFXPreset(
                payload.preset,
              );
          },
        );

      ctx.lifecycle.onDispose(
        (): void => {
          unbindRender();
          unbindSpawnEmitter();
          unbindProjectDecal();
          unbindSetPostFX();
          unbindPreset();

          vfxService.dispose();
        },
      );

      ctx.lifecycle.ready();
    },
  };
}
