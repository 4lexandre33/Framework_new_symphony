import * as THREE from "three";

import type {
  PluginContext,
} from "@core";

import type {
  VfxApi,
} from "../../../tokens/vfx";

import {
  AssetsToken,
} from "../../../tokens/assets";

import type {
  AssetsApi,
} from "../../../tokens/assets";

import {
  RenderToken,
} from "../../../tokens/render";

import type {
  Render3DApi,
} from "../../../tokens/render";

import {
  AddCameraTraumaCommand,
} from "../../../contracts/camera/types";

import type {
  DecalConfig,
  GPUParticleEmitterConfig,
  PostProcessingConfig,
  VFXPresetDescriptor,
} from "../../../contracts/vfx/types";

import {
  DecalManager,
} from "./DecalManager";

import {
  GPUParticleSystem,
} from "./GPUParticleSystem";

import {
  PostProcessingPipeline,
} from "./PostProcessingPipeline";

import {
  VFXEffectManager,
} from "./VFXEffectManager";

import type {
  VFXEffectSink,
} from "./VFXEffectManager";

const PRESENTATION_OWNED_TEXTURE_FLAG =
  "presentationOwned";

export class VFXService
  implements
    VfxApi,
    VFXEffectSink {
  private readonly particleSystem =
    new GPUParticleSystem();

  private readonly decalManager =
    new DecalManager();

  private readonly postProcessing =
    new PostProcessingPipeline();

  private readonly effectManager:
    VFXEffectManager;

  private readonly emitterRenderKeys =
    new Map<
      string,
      string
    >();

  private disposed =
    false;

  public constructor(
    private readonly ctx:
      PluginContext,
  ) {
    this.effectManager =
      new VFXEffectManager(
        this,
      );
  }

  public spawnParticleEmitter(
    config:
      GPUParticleEmitterConfig,
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.stopParticleEmitter(
      config.emitterId,
    );

    const texture =
      config.textureUrl !==
        undefined
        ? this.cloneOwnedTexture(
            config.textureUrl,
          )
        : null;

    const pointsMesh =
      this.particleSystem
        .spawnEmitter(
          config,
          texture,
        );

    const render =
      this.getRender();

    if (
      render !==
      null
    ) {
      const key =
        `vfx_emitter_${config.emitterId}`;

      render.addMeshToScene(
        key,
        pointsMesh,
      );

      this.emitterRenderKeys
        .set(
          config.emitterId,
          key,
        );
    }

    this.ctx.events.emit(
      "game.vfx.spawned",
      {
        emitterId:
          config.emitterId,

        position: {
          x:
            config.position.x,
          y:
            config.position.y,
          z:
            config.position.z,
        },

        totalActiveParticles:
          this.particleSystem
            .getTotalActiveParticles(),
      },
    );
  }

  public stopParticleEmitter(
    emitterId:
      string,
  ): boolean {
    if (
      this.disposed
    ) {
      return false;
    }

    const key =
      this.emitterRenderKeys
        .get(
          emitterId,
        );

    const render =
      this.getRender();

    if (
      key !==
        undefined &&
      render !==
        null
    ) {
      render.removeMeshFromScene(
        key,
      );

      this.emitterRenderKeys
        .delete(
          emitterId,
        );

      return this.particleSystem
        .stopEmitter(
          emitterId,
          false,
        );
    }

    this.emitterRenderKeys
      .delete(
        emitterId,
      );

    return this.particleSystem
      .stopEmitter(
        emitterId,
        true,
      );
  }

  public projectDecal(
    config:
      DecalConfig,
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    const render =
      this.getRender();

    if (
      render ===
      null
    ) {
      return;
    }

    const texture =
      this.cloneOwnedTexture(
        config.textureUrl,
      ) ??
      this.createOwnedFallbackTexture();

    this.decalManager
      .projectDecal(
        config,
        texture,
        render.getScene(),
      );

    this.ctx.events.emit(
      "game.vfx.decal-projected",
      {
        decalId:
          config.decalId,

        position: {
          x:
            config.position.x,
          y:
            config.position.y,
          z:
            config.position.z,
        },
      },
    );
  }

  public clearDecals(): void {
    this.decalManager
      .clear(
        this.getRender()
          ?.getScene(),
      );
  }

  public configurePostProcessing(
    config:
      Partial<PostProcessingConfig>,
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.postProcessing
      .updateConfig(
        config,
      );

    const state =
      this.postProcessing
        .getConfig();

    const activePasses:
      string[] =
        [];

    if (
      state.enableBloom ===
      true
    ) {
      activePasses.push(
        "bloom",
      );
    }

    if (
      state.enableSSAO ===
      true
    ) {
      activePasses.push(
        "ssao",
      );
    }

    if (
      state.enableColorGrading ===
      true
    ) {
      activePasses.push(
        "color-grading",
      );
    }

    this.ctx.events.emit(
      "game.vfx.postfx-changed",
      {
        activePasses,

        isBloomActive:
          state.enableBloom ===
          true,

        isSSAOActive:
          state.enableSSAO ===
          true,
      },
    );
  }

  public triggerVFXPreset(
    preset:
      VFXPresetDescriptor,
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.effectManager
      .triggerPreset(
        preset,
      );
  }

  public pulseBloom(
    strength:
      number,
    durationSeconds:
      number,
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.postProcessing
      .triggerBloomPulse(
        strength,
        durationSeconds,
      );
  }

  public triggerCameraTrauma(
    traumaAmount:
      number,
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    void this.ctx.commands
      .send(
        AddCameraTraumaCommand.type,
        {
          traumaAmount,
        },
      )
      .catch(
        (): void => {
          // Câmera é integração opcional para presets compostos.
        },
      );
  }

  public getActiveParticleCount():
    number {
    return this.particleSystem
      .getTotalActiveParticles();
  }

  public getActiveDecalCount():
    number {
    return this.decalManager
      .getActiveDecalCount();
  }

  public update(
    deltaSeconds:
      number,
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    const safeDelta =
      this.sanitizeDelta(
        deltaSeconds,
      );

    this.particleSystem
      .update(
        safeDelta,
      );

    this.decalManager
      .update(
        safeDelta,
        this.getRender()
          ?.getScene(),
      );

    this.postProcessing
      .update(
        safeDelta,
      );
  }

  public clear(): void {
    if (
      this.disposed
    ) {
      return;
    }

    const render =
      this.getRender();

    if (
      render !==
      null
    ) {
      for (
        const key of
        this.emitterRenderKeys
          .values()
      ) {
        render.removeMeshFromScene(
          key,
        );
      }

      this.particleSystem
        .clear(
          false,
        );
    } else {
      this.particleSystem
        .clear(
          true,
        );
    }

    this.emitterRenderKeys
      .clear();

    this.clearDecals();

    this.postProcessing
      .reset();
  }

  public dispose(): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.clear();

    this.disposed =
      true;
  }

  private getAssets():
    AssetsApi | null {
    return (
      this.ctx.caps.get(
        AssetsToken,
      ) ??
      null
    );
  }

  private getRender():
    Render3DApi | null {
    return (
      this.ctx.caps.get(
        RenderToken,
      ) ??
      null
    );
  }

  private cloneOwnedTexture(
    url:
      string,
  ): THREE.Texture | null {
    const source =
      this.getAssets()
        ?.getAsset<
          THREE.Texture
        >(
          url,
        );

    if (
      source ===
        null ||
      source ===
        undefined
    ) {
      return null;
    }

    const clone =
      source.clone();

    clone.userData[
      PRESENTATION_OWNED_TEXTURE_FLAG
    ] =
      true;

    clone.needsUpdate =
      true;

    return clone;
  }

  private createOwnedFallbackTexture():
    THREE.Texture {
    const texture =
      new THREE.Texture();

    texture.userData[
      PRESENTATION_OWNED_TEXTURE_FLAG
    ] =
      true;

    return texture;
  }

  private sanitizeDelta(
    deltaSeconds:
      number,
  ): number {
    if (
      !Number.isFinite(
        deltaSeconds,
      ) ||
      deltaSeconds <=
        0
    ) {
      return 0;
    }

    return Math.min(
      deltaSeconds,
      0.25,
    );
  }
}
