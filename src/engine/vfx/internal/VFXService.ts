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
  StopParticleEmitterOptions,
  Vector3VFX,
  VFXPresetDescriptor,
  VFXPresetInstance,
  VFXPresetTriggerOptions,
} from "../../../contracts/vfx/types";

import {
  DecalManager,
} from "./DecalManager";

import {
  GPUParticleSystem,
} from "./GPUParticleSystem";

import {
  PostFXComposer,
} from "./PostFXComposer";

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

const EMITTER_KEY_PREFIX =
  "vfx_emitter_";

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

  private readonly presets =
    new Map<
      string,
      VFXPresetDescriptor
    >();

  // Tokens de carga assíncrona: resultado só é aplicado se o dono ainda for o mesmo.
  private readonly pendingTextureLoads =
    new Map<
      string,
      number
    >();

  private loadGeneration =
    0;

  private presetInstanceCounter =
    0;

  private readonly finishedEmitters:
    string[] =
      [];

  private postFxComposer:
    PostFXComposer | null =
      null;

  private frameRendererInstalled =
    false;

  private lutTexture:
    THREE.Texture | null =
      null;

  private lutUrl:
    string | null =
      null;

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

  // ── PARTÍCULAS (G88, G89, G19, G28) ─────────────────────────────────────

  public spawnParticleEmitter(
    config:
      GPUParticleEmitterConfig,
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    // G89: o anterior com o mesmo id é liberado por inteiro.
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
        `${EMITTER_KEY_PREFIX}${config.emitterId}`;

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

    if (
      config.textureUrl !==
        undefined &&
      texture ===
        null
    ) {
      const emitter =
        this.particleSystem
          .getEmitter(
            config.emitterId,
          );

      this.loadOwnedTextureLater(
        `emitter:${config.emitterId}`,
        config.textureUrl,
        (
          loaded:
            THREE.Texture,
        ): boolean => {
          if (
            emitter ===
              null ||
            this.particleSystem
              .getEmitter(
                config.emitterId,
              ) !==
              emitter
          ) {
            return false;
          }

          emitter.setTexture(
            loaded,
          );
          return true;
        },
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
    options?:
      StopParticleEmitterOptions,
  ): boolean {
    if (
      this.disposed
    ) {
      return false;
    }

    if (
      options?.graceful ===
      true
    ) {
      const emitter =
        this.particleSystem
          .getEmitter(
            emitterId,
          );

      if (
        emitter ===
        null
      ) {
        return false;
      }

      emitter.stopEmitting();
      return true;
    }

    return this.removeEmitter(
      emitterId,
    );
  }

  public setEmitterPosition(
    emitterId:
      string,
    position:
      Vector3VFX,
  ): boolean {
    const emitter =
      this.particleSystem
        .getEmitter(
          emitterId,
        );

    if (
      emitter ===
      null
    ) {
      return false;
    }

    emitter.setPosition(
      position.x,
      position.y,
      position.z,
    );

    return true;
  }

  public burstParticles(
    emitterId:
      string,
    count:
      number,
  ): boolean {
    const emitter =
      this.particleSystem
        .getEmitter(
          emitterId,
        );

    if (
      emitter ===
      null
    ) {
      return false;
    }

    emitter.burst(
      count,
    );

    return true;
  }

  public hasParticleEmitter(
    emitterId:
      string,
  ): boolean {
    return this.particleSystem
      .hasEmitter(
        emitterId,
      );
  }

  // ── DECALS (G90) ────────────────────────────────────────────────────────

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
      );

    this.decalManager
      .projectDecal(
        config,
        texture,
        render.getScene(),
      );

    if (
      texture ===
      null
    ) {
      const mesh =
        this.decalManager
          .getDecal(
            config.decalId,
          )
          ?.mesh ??
        null;

      this.loadOwnedTextureLater(
        `decal:${config.decalId}`,
        config.textureUrl,
        (
          loaded:
            THREE.Texture,
        ): boolean =>
          mesh !==
            null &&
          this.decalManager
            .getDecal(
              config.decalId,
            )
            ?.mesh ===
            mesh &&
          this.decalManager
            .setDecalTexture(
              config.decalId,
              loaded,
            ),
      );
    }

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

  public removeDecal(
    decalId:
      string,
  ): boolean {
    this.pendingTextureLoads.delete(
      `decal:${decalId}`,
    );

    return this.decalManager
      .removeDecal(
        decalId,
        this.getRender()
          ?.getScene(),
      );
  }

  public setMaxDecals(
    maxDecals:
      number,
  ): void {
    this.decalManager
      .setMaxDecals(
        maxDecals,
        this.getRender()
          ?.getScene(),
      );
  }

  public clearDecals(): void {
    this.decalManager
      .clear(
        this.getRender()
          ?.getScene(),
      );
  }

  // ── PÓS-PROCESSAMENTO (G9) ──────────────────────────────────────────────

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

    this.syncLutTexture(
      state.lutTextureUrl,
    );

    this.syncFrameRenderer();

    const activePasses:
      string[] =
        [];

    if (
      this.postProcessing
        .isBloomEffective
    ) {
      activePasses.push(
        "bloom",
      );
    }

    if (
      this.postProcessing
        .isSSAOEffective
    ) {
      activePasses.push(
        "ssao",
      );
    }

    if (
      this.postProcessing
        .isColorGradingRequested
    ) {
      activePasses.push(
        "color-grading",
      );
    }

    if (
      this.postProcessing
        .isVignetteEffective
    ) {
      activePasses.push(
        "vignette",
      );
    }

    if (
      this.postProcessing
        .isChromaticAberrationEffective
    ) {
      activePasses.push(
        "chromatic-aberration",
      );
    }

    this.ctx.events.emit(
      "game.vfx.postfx-changed",
      {
        activePasses,

        isBloomActive:
          this.postProcessing
            .isBloomEffective,

        isSSAOActive:
          this.postProcessing
            .isSSAOEffective,
      },
    );
  }

  public isPostProcessingActive():
    boolean {
    return this.frameRendererInstalled;
  }

  /** Composer interno (diagnóstico/testes). */
  public getPostFXComposer():
    PostFXComposer | null {
    return this.postFxComposer;
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

    this.syncFrameRenderer();
  }

  // ── PRESETS (G91) ───────────────────────────────────────────────────────

  public triggerVFXPreset(
    preset:
      VFXPresetDescriptor,
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    const isReference =
      preset.particleEmitter ===
        undefined &&
      preset.decal ===
        undefined &&
      preset.screenShakeTrauma ===
        undefined &&
      preset.postFXPulseBloomStrength ===
        undefined;

    const registered =
      isReference
        ? this.presets.get(
            preset.presetId,
          )
        : undefined;

    this.effectManager
      .triggerPreset(
        registered ??
          preset,
      );
  }

  public registerVFXPreset(
    preset:
      VFXPresetDescriptor,
  ): void {
    if (
      preset.presetId.trim()
        .length ===
      0
    ) {
      throw new RangeError(
        "presetId não pode ser vazio.",
      );
    }

    this.presets.set(
      preset.presetId,
      preset,
    );
  }

  public unregisterVFXPreset(
    presetId:
      string,
  ): boolean {
    return this.presets.delete(
      presetId,
    );
  }

  public triggerVFXPresetById(
    presetId:
      string,
    options?:
      VFXPresetTriggerOptions,
  ): VFXPresetInstance | null {
    if (
      this.disposed
    ) {
      return null;
    }

    const preset =
      this.presets.get(
        presetId,
      );

    if (
      preset ===
      undefined
    ) {
      return null;
    }

    this.presetInstanceCounter +=
      1;

    const suffix =
      options?.instanceId ??
      String(
        this.presetInstanceCounter,
      );

    const position =
      options?.position;

    const emitter =
      preset.particleEmitter ===
      undefined
        ? undefined
        : {
            ...preset.particleEmitter,
            emitterId:
              `${preset.particleEmitter.emitterId}@${suffix}`,
            position:
              position ??
              preset.particleEmitter
                .position,
          };

    const decal =
      preset.decal ===
      undefined
        ? undefined
        : {
            ...preset.decal,
            decalId:
              `${preset.decal.decalId}@${suffix}`,
            position:
              position ??
              preset.decal.position,
          };

    this.effectManager
      .triggerPreset({
        ...preset,
        particleEmitter:
          emitter,
        decal,
      });

    return {
      presetId,
      emitterId:
        emitter?.emitterId ??
        null,
      decalId:
        decal?.decalId ??
        null,
    };
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

    if (
      this.particleSystem
        .collectFinished(
          this.finishedEmitters,
        ) >
      0
    ) {
      this.reapFinishedEmitters();
    }

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

    // Pulso de bloom terminou → desinstala o composer se nada mais pede.
    if (
      this.frameRendererInstalled !==
      this.postProcessing.isActive
    ) {
      this.syncFrameRenderer();
    }
  }

  public clear(): void {
    if (
      this.disposed
    ) {
      return;
    }

    const render =
      this.getRender();

    for (
      const key of
      this.emitterRenderKeys
        .values()
    ) {
      // A VFX é dona dos recursos: o render só tira da cena.
      render?.removeMeshFromScene(
        key,
        {
          disposeResources:
            false,
        },
      );
    }

    this.particleSystem
      .clear(
        true,
      );

    this.emitterRenderKeys
      .clear();

    this.pendingTextureLoads
      .clear();

    this.clearDecals();

    this.postProcessing
      .reset();

    this.syncFrameRenderer();
  }

  public dispose(): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.clear();

    if (
      this.frameRendererInstalled
    ) {
      this.getRender()
        ?.setFrameRenderer(
          null,
        );
      this.frameRendererInstalled =
        false;
    }

    this.postFxComposer
      ?.dispose();

    this.postFxComposer =
      null;

    this.lutTexture
      ?.dispose();

    this.lutTexture =
      null;

    this.lutUrl =
      null;

    this.presets.clear();

    this.disposed =
      true;
  }

  private removeEmitter(
    emitterId:
      string,
  ): boolean {
    const key =
      this.emitterRenderKeys
        .get(
          emitterId,
        );

    if (
      key !==
      undefined
    ) {
      this.getRender()
        ?.removeMeshFromScene(
          key,
          {
            disposeResources:
              false,
          },
        );

      this.emitterRenderKeys
        .delete(
          emitterId,
        );
    }

    this.pendingTextureLoads.delete(
      `emitter:${emitterId}`,
    );

    // G89: geometria, material e textura própria sempre liberados aqui.
    return this.particleSystem
      .stopEmitter(
        emitterId,
        true,
      );
  }

  private reapFinishedEmitters(): void {
    for (
      const emitterId of
      this.finishedEmitters
    ) {
      this.removeEmitter(
        emitterId,
      );

      this.ctx.events.emit(
        "game.vfx.emitter-finished",
        {
          emitterId,
        },
      );
    }

    this.finishedEmitters.length =
      0;
  }

  /** Instala/remove o composer no render conforme o pipeline (G9). */
  private syncFrameRenderer(): void {
    const render =
      this.getRender();

    if (
      render ===
        null ||
      typeof render.setFrameRenderer !==
        "function"
    ) {
      return;
    }

    const shouldBeActive =
      !this.disposed &&
      this.postProcessing.isActive;

    if (
      shouldBeActive ===
      this.frameRendererInstalled
    ) {
      return;
    }

    if (
      shouldBeActive
    ) {
      render.setFrameRenderer(
        this.ensurePostFxComposer(),
      );
    } else {
      render.setFrameRenderer(
        null,
      );
    }

    this.frameRendererInstalled =
      shouldBeActive;
  }

  private ensurePostFxComposer():
    PostFXComposer {
    if (
      this.postFxComposer ===
      null
    ) {
      this.postFxComposer =
        new PostFXComposer(
          this.postProcessing,
          (): THREE.Texture | null =>
            this.lutTexture,
        );
    }

    return this.postFxComposer;
  }

  private syncLutTexture(
    url:
      string | undefined,
  ): void {
    const nextUrl =
      url ??
      null;

    if (
      nextUrl ===
      this.lutUrl
    ) {
      return;
    }

    this.lutTexture
      ?.dispose();

    this.lutTexture =
      null;

    this.lutUrl =
      nextUrl;

    if (
      nextUrl ===
      null
    ) {
      return;
    }

    const prepare =
      (
        texture:
          THREE.Texture,
      ): THREE.Texture => {
        // Cópia própria: filtro do LUT não altera a textura do cache.
        texture.magFilter =
          THREE.LinearFilter;
        texture.minFilter =
          THREE.LinearFilter;
        texture.generateMipmaps =
          false;
        texture.wrapS =
          THREE.ClampToEdgeWrapping;
        texture.wrapT =
          THREE.ClampToEdgeWrapping;
        texture.colorSpace =
          THREE.NoColorSpace;
        texture.needsUpdate =
          true;
        return texture;
      };

    const cached =
      this.cloneOwnedTexture(
        nextUrl,
      );

    if (
      cached !==
      null
    ) {
      this.lutTexture =
        prepare(
          cached,
        );
      return;
    }

    this.loadOwnedTextureLater(
      "lut",
      nextUrl,
      (
        loaded:
          THREE.Texture,
      ): boolean => {
        if (
          this.lutUrl !==
          nextUrl
        ) {
          return false;
        }

        this.lutTexture =
          prepare(
            loaded,
          );
        return true;
      },
    );
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

  /**
   * Clona a textura do cache de assets: a VFX é dona do clone
   * (`presentationOwned`) e nunca altera/descarta a textura compartilhada.
   */
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
        undefined ||
      !(source instanceof THREE.Texture)
    ) {
      return null;
    }

    return this.markOwned(
      source.clone(),
    );
  }

  private markOwned(
    texture:
      THREE.Texture,
  ): THREE.Texture {
    texture.userData[
      PRESENTATION_OWNED_TEXTURE_FLAG
    ] =
      true;

    texture.needsUpdate =
      true;

    return texture;
  }

  /**
   * Carrega pelo `game.assets` uma textura ausente do cache, clona e libera
   * a referência obtida (o clone compartilha a imagem). `apply` devolve
   * false se o dono não existe mais (o clone é descartado).
   */
  private loadOwnedTextureLater(
    ownerKey:
      string,
    url:
      string,
    apply:
      (
        texture:
          THREE.Texture,
      ) => boolean,
  ): void {
    const assets =
      this.getAssets();

    if (
      assets ===
        null ||
      typeof assets.loadTexture !==
        "function"
    ) {
      return;
    }

    this.loadGeneration +=
      1;

    const generation =
      this.loadGeneration;

    this.pendingTextureLoads.set(
      ownerKey,
      generation,
    );

    void assets
      .loadTexture(
        url,
      )
      .then(
        (
          loaded:
            unknown,
        ): void => {
          const stillWanted =
            !this.disposed &&
            this.pendingTextureLoads.get(
              ownerKey,
            ) ===
              generation;

          if (
            stillWanted &&
            loaded instanceof
              THREE.Texture
          ) {
            this.pendingTextureLoads.delete(
              ownerKey,
            );

            const owned =
              this.markOwned(
                loaded.clone(),
              );

            if (
              !apply(
                owned,
              )
            ) {
              owned.dispose();
            }
          }

          assets.releaseAsset(
            url,
          );
        },
      )
      .catch(
        (
          error:
            unknown,
        ): void => {
          this.ctx.log.warn(
            `VFX: falha ao carregar textura "${url}".`,
            {
              error:
                String(
                  error,
                ),
            },
          );
        },
      );
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
