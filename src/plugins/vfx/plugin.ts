import type { Plugin, PluginContext } from "@core";
import { VfxToken } from "../../tokens/vfx";
import { RenderToken } from "../../tokens/render";
import { AssetsToken } from "../../tokens/assets";
import { VFXSpawnedEvent, DecalProjectedEvent, PostFXStateChangedEvent, SpawnParticleEmitterCommand, ProjectDecalCommand, SetPostFXConfigCommand, TriggerVFXPresetCommand, type GPUParticleEmitterConfig, type DecalConfig, type PostProcessingConfig, type VFXPresetDescriptor } from "../../contracts/vfx/types";
import { VFXService } from "../../engine/vfx/internal/VFXService";

export const vfxManifest: Plugin["manifest"] = {
  id: "game.vfx",
  name: "GPU Particle System, Decals & PostProcessing Plugin",
  version: "1.0.0",
  kind: "preloaded",
  authority: "game",
  permissions: {
    capabilities: [VfxToken.id, RenderToken.id, AssetsToken.id],
    events: [
      "game.vfx.spawned",
      "game.vfx.decal-projected",
      "game.vfx.postfx-changed",
      "game.loop.render",
    ],
  },
  capabilities: {
    provides: [
      {
        id: VfxToken.id,
        version: "1.0.0",
      },
    ],
    consumes: [
      {
        id: RenderToken.id,
        range: "^1.0.0",
        optional: false,
      },
      {
        id: AssetsToken.id,
        range: "^1.0.0",
        optional: false,
      },
    ],
    conflicts: [],
  },
};

export function createVFXPlugin(): Plugin {
  return {
    manifest: vfxManifest,

    setup(ctx: PluginContext) {
      const vfxService = new VFXService(ctx);

      ctx.caps.provide(VfxToken, vfxService);

      ctx.events.define(VFXSpawnedEvent);
      ctx.events.define(DecalProjectedEvent);
      ctx.events.define(PostFXStateChangedEvent);

      ctx.commands.define(SpawnParticleEmitterCommand);
      ctx.commands.define(ProjectDecalCommand);
      ctx.commands.define(SetPostFXConfigCommand);
      ctx.commands.define(TriggerVFXPresetCommand);

      const unbindRender = ctx.events.on("game.loop.render", (env) => {
        const payload = env.payload as { deltaSeconds: number };
        vfxService.update(payload.deltaSeconds || 0.016);
      });

      const unbindSpawnEmitter = ctx.commands.handle("game.vfx.spawn-emitter", (env) => {
        const p = env.payload as { config: GPUParticleEmitterConfig };
        vfxService.spawnParticleEmitter(p.config);
      });

      const unbindProjectDecal = ctx.commands.handle("game.vfx.project-decal", (env) => {
        const p = env.payload as { config: DecalConfig };
        vfxService.projectDecal(p.config);
      });

      const unbindSetPostFX = ctx.commands.handle("game.vfx.set-postfx-config", (env) => {
        const p = env.payload as { config: Partial<PostProcessingConfig> };
        vfxService.configurePostProcessing(p.config);
      });

      const unbindPreset = ctx.commands.handle("game.vfx.trigger-preset", (env) => {
        const p = env.payload as { preset: VFXPresetDescriptor };
        vfxService.triggerVFXPreset(p.preset);
      });

      ctx.lifecycle.onDispose(() => {
        unbindRender();
        unbindSpawnEmitter();
        unbindProjectDecal();
        unbindSetPostFX();
        unbindPreset();
        vfxService.clear();
      });

      ctx.lifecycle.ready();
    },
  };
}