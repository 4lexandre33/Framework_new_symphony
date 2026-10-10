import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { PluginContext } from "@core";
import type { GPUParticleEmitterConfig } from "../src/contracts/vfx/types";
import type { RemoveMeshOptions } from "../src/contracts/render/types";
import { DecalManager } from "../src/engine/vfx/internal/DecalManager";
import { GPUParticleEmitter, PARTICLE_VERTEX_SHADER, VFX_STANDARD_GRAVITY } from "../src/engine/vfx/internal/GPUParticleSystem";
import { PostFXComposer } from "../src/engine/vfx/internal/PostFXComposer";
import { PostProcessingPipeline } from "../src/engine/vfx/internal/PostProcessingPipeline";
import { VFXService } from "../src/engine/vfx/internal/VFXService";
import { AssetsToken } from "../src/tokens/assets";
import { RenderToken, type RenderFrameRenderer } from "../src/tokens/render";

function emitterConfig(extra: Partial<GPUParticleEmitterConfig> = {}): GPUParticleEmitterConfig {
  return {
    emitterId: "fx",
    maxParticles: 8,
    spawnRatePerSecond: 0,
    particleLifetimeSeconds: 1,
    startSize: 1,
    endSize: 1,
    startColor: { r: 1, g: 1, b: 1, a: 1 },
    endColor: { r: 1, g: 1, b: 1, a: 1 },
    position: { x: 0, y: 0, z: 0 },
    velocityBase: { x: 0, y: 0, z: 0 },
    velocityVariance: { x: 0, y: 0, z: 0 },
    ...extra,
  };
}

interface Harness {
  service: VFXService;
  emitted: { type: string; payload: unknown }[];
  scene: THREE.Scene;
  removed: { key: string; options?: RemoveMeshOptions }[];
  frameRenderers: (RenderFrameRenderer | null)[];
  assetsCache: Map<string, THREE.Texture>;
  loads: string[];
  releases: string[];
  resolveLoad: (url: string) => void;
}

function harness(): Harness {
  const emitted: { type: string; payload: unknown }[] = [];
  const scene = new THREE.Scene();
  const removed: { key: string; options?: RemoveMeshOptions }[] = [];
  const frameRenderers: (RenderFrameRenderer | null)[] = [];
  const registry = new Map<string, THREE.Object3D>();
  const render = {
    getScene: (): THREE.Scene => scene,
    addMeshToScene: (key: string, object: THREE.Object3D): void => {
      registry.set(key, object);
      scene.add(object);
    },
    removeMeshFromScene: (key: string, options?: RemoveMeshOptions): void => {
      removed.push({ key, options });
      const object = registry.get(key);
      if (object !== undefined) scene.remove(object);
      registry.delete(key);
    },
    setFrameRenderer: (frameRenderer: RenderFrameRenderer | null): void => {
      frameRenderers.push(frameRenderer);
    },
  };
  const assetsCache = new Map<string, THREE.Texture>();
  const loads: string[] = [];
  const releases: string[] = [];
  const pending = new Map<string, (texture: THREE.Texture) => void>();
  const assets = {
    getAsset: (url: string): THREE.Texture | null => assetsCache.get(url) ?? null,
    loadTexture: (url: string): Promise<THREE.Texture> => {
      loads.push(url);
      return new Promise((resolve) => pending.set(url, resolve));
    },
    releaseAsset: (url: string): void => {
      releases.push(url);
    },
  };
  const ctx = {
    events: { emit: (type: string, payload: unknown): void => { emitted.push({ type, payload }); } },
    commands: { send: (): Promise<void> => Promise.resolve() },
    caps: {
      get: (token: { id: string }): unknown => (token.id === RenderToken.id ? render : token.id === AssetsToken.id ? assets : undefined),
    },
    log: { warn: (): void => {}, info: (): void => {}, error: (): void => {}, debug: (): void => {} },
  } as unknown as PluginContext;
  return {
    service: new VFXService(ctx),
    emitted,
    scene,
    removed,
    frameRenderers,
    assetsCache,
    loads,
    releases,
    resolveLoad: (url: string): void => {
      const texture = new THREE.Texture();
      pending.get(url)?.(texture);
    },
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("vfx gaps (G9, G19, G28, G88–G91)", () => {
  it("G88: partículas usam ShaderMaterial (atributos/matrizes injetados pelo three)", () => {
    const emitter = new GPUParticleEmitter(emitterConfig());
    const material = emitter.mesh.material as THREE.Material;
    expect(material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(material).not.toBeInstanceOf(THREE.RawShaderMaterial);
    expect(PARTICLE_VERTEX_SHADER).not.toMatch(/attribute\s+vec3\s+position/u);
    expect(PARTICLE_VERTEX_SHADER).toMatch(/projectionMatrix \* mvPosition/u);
    emitter.dispose();
  });

  it("G89: parar e substituir emissor libera geometria, material e textura própria", () => {
    const h = harness();
    const source = new THREE.Texture();
    h.assetsCache.set("spark.png", source);
    h.service.spawnParticleEmitter(emitterConfig({ textureUrl: "spark.png" }));
    const points = h.scene.children.find((c) => c instanceof THREE.Points) as THREE.Points;
    const material = points.material as THREE.ShaderMaterial;
    const texture = material.uniforms.uTexture?.value as THREE.Texture;
    expect(texture).not.toBe(source);
    const disposed: string[] = [];
    points.geometry.addEventListener("dispose", () => disposed.push("geometry"));
    material.addEventListener("dispose", () => disposed.push("material"));
    texture.addEventListener("dispose", () => disposed.push("texture"));
    source.addEventListener("dispose", () => disposed.push("SOURCE"));

    h.service.spawnParticleEmitter(emitterConfig({ textureUrl: "spark.png" })); // substitui
    expect(disposed.sort()).toEqual(["geometry", "material", "texture"]);
    expect(h.removed.at(-1)).toEqual({ key: "vfx_emitter_fx", options: { disposeResources: false } });

    expect(h.service.stopParticleEmitter("fx")).toBe(true);
    expect(h.service.hasParticleEmitter("fx")).toBe(false);
    expect(h.scene.children.filter((c) => c instanceof THREE.Points)).toHaveLength(0);
    h.service.dispose();
  });

  it("G19: emissor móvel — partículas novas nascem na nova posição, antigas ficam", () => {
    const emitter = new GPUParticleEmitter(emitterConfig({ burstCount: 1, spawnRatePerSecond: 0 }), null, () => 0.5);
    emitter.update(0.01);
    emitter.setPosition(5, 6, 7);
    emitter.burst(1);
    emitter.update(0.01);
    const positions = emitter.mesh.geometry.getAttribute("position");
    expect([positions.getX(0), positions.getY(0), positions.getZ(0)]).toEqual([0, 0, 0]);
    expect([positions.getX(1), positions.getY(1), positions.getZ(1)]).toEqual([5, 6, 7]);
    expect(emitter.getLiveParticleCount()).toBe(2);
    emitter.dispose();
  });

  it("G28: duração encerra a emissão, o emissor é removido e emite emitter-finished; pausa congela", () => {
    const h = harness();
    h.service.spawnParticleEmitter(emitterConfig({ spawnRatePerSecond: 100, durationSeconds: 0.2, particleLifetimeSeconds: 0.3 }));
    h.service.update(0.1);
    h.service.update(0); // pausado: nada muda
    h.service.update(0.15);
    expect(h.service.hasParticleEmitter("fx")).toBe(true);
    for (let i = 0; i < 4; i += 1) h.service.update(0.1);
    expect(h.service.hasParticleEmitter("fx")).toBe(false);
    expect(h.emitted.filter((e) => e.type === "game.vfx.emitter-finished")).toEqual([
      { type: "game.vfx.emitter-finished", payload: { emitterId: "fx" } },
    ]);

    // graceful: para de emitir e some sozinho depois
    h.service.spawnParticleEmitter(emitterConfig({ emitterId: "g", spawnRatePerSecond: 50, particleLifetimeSeconds: 0.2 }));
    h.service.update(0.1);
    expect(h.service.stopParticleEmitter("g", { graceful: true })).toBe(true);
    expect(h.service.hasParticleEmitter("g")).toBe(true);
    for (let i = 0; i < 4; i += 1) h.service.update(0.1);
    expect(h.service.hasParticleEmitter("g")).toBe(false);
    h.service.dispose();
  });

  it("G91: gravityScale escala 9,81 e presets por id (posição/instância)", () => {
    const emitter = new GPUParticleEmitter(emitterConfig({ gravityScale: 0.5 }));
    expect((emitter.mesh.material as THREE.ShaderMaterial).uniforms.uGravity?.value).toBeCloseTo(VFX_STANDARD_GRAVITY * 0.5, 6);
    const defaultGravity = new GPUParticleEmitter(emitterConfig());
    expect((defaultGravity.mesh.material as THREE.ShaderMaterial).uniforms.uGravity?.value).toBeCloseTo(9.81, 6);
    emitter.dispose();
    defaultGravity.dispose();

    const h = harness();
    h.service.registerVFXPreset({ presetId: "boom", particleEmitter: emitterConfig({ emitterId: "spark", durationSeconds: 0.1 }) });
    const first = h.service.triggerVFXPresetById("boom", { position: { x: 3, y: 0, z: 0 } });
    const second = h.service.triggerVFXPresetById("boom");
    expect(first).toEqual({ presetId: "boom", emitterId: "spark@1", decalId: null });
    expect(second?.emitterId).toBe("spark@2");
    expect(h.service.hasParticleEmitter("spark@1")).toBe(true);
    expect(h.service.hasParticleEmitter("spark@2")).toBe(true);
    const spawned = h.emitted.filter((e) => e.type === "game.vfx.spawned").map((e) => e.payload as { emitterId: string; position: { x: number } });
    expect(spawned[0]).toMatchObject({ emitterId: "spark@1", position: { x: 3 } });
    expect(h.service.triggerVFXPresetById("nope")).toBeNull();

    // Descritor só com presetId dispara o registrado.
    h.service.triggerVFXPreset({ presetId: "boom" });
    expect(h.service.hasParticleEmitter("spark")).toBe(true);
    expect(h.service.unregisterVFXPreset("boom")).toBe(true);
    h.service.dispose();
  });

  it("G90: decal projeta sobre a malha, id substitui/remove, limite configurável e textura carregada depois", async () => {
    const decals = new DecalManager();
    const scene = new THREE.Scene();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), new THREE.MeshBasicMaterial());
    scene.add(wall);
    const texture = new THREE.Texture();
    const mesh = decals.projectDecal(
      { decalId: "hit", textureUrl: "x", position: { x: 0, y: 0, z: 2 }, orientationNormal: { x: 0, y: 0, z: 1 }, size: { x: 1, y: 1, z: 1 } },
      texture,
      scene,
    );
    expect(decals.getDecal("hit")?.projected).toBe(true);
    const positions = mesh.geometry.getAttribute("position");
    expect(positions.count).toBeGreaterThan(0);
    for (let i = 0; i < positions.count; i += 1) {
      expect(positions.getZ(i)).toBeCloseTo(2, 5); // na face z=+2 da caixa
      expect(Math.abs(positions.getX(i))).toBeLessThanOrEqual(0.5 + 1e-6);
    }

    decals.projectDecal(
      { decalId: "hit", textureUrl: "x", position: { x: 1, y: 0, z: 2 }, orientationNormal: { x: 0, y: 0, z: 1 }, size: { x: 1, y: 1, z: 1 } },
      texture,
      scene,
    );
    expect(decals.getActiveDecalCount()).toBe(1);
    expect(decals.removeDecal("hit", scene)).toBe(true);
    expect(decals.getActiveDecalCount()).toBe(0);

    decals.setMaxDecals(2);
    for (let i = 0; i < 3; i += 1) {
      decals.projectDecal(
        { decalId: `d${String(i)}`, textureUrl: "x", position: { x: 10 + i, y: 0, z: 0 }, orientationNormal: { x: 0, y: 1, z: 0 }, size: { x: 1, y: 1, z: 0.01 } },
        texture,
        scene,
      );
    }
    expect(decals.getActiveDecalCount()).toBe(2);
    expect(decals.getDecal("d0")).toBeNull();
    expect(decals.getDecal("d2")?.projected).toBe(false);
    decals.clear(scene);

    const h = harness();
    h.service.projectDecal({ decalId: "late", textureUrl: "late.png", position: { x: 0, y: 0, z: 0 }, orientationNormal: { x: 0, y: 1, z: 0 }, size: { x: 1, y: 1, z: 0.1 } });
    const lateMesh = h.scene.children.find((c) => c.name === "vfx_decal_late") as THREE.Mesh;
    expect((lateMesh.material as THREE.MeshBasicMaterial).visible).toBe(false);
    expect(h.loads).toEqual(["late.png"]);
    h.resolveLoad("late.png");
    await flush();
    expect((lateMesh.material as THREE.MeshBasicMaterial).visible).toBe(true);
    expect((lateMesh.material as THREE.MeshBasicMaterial).map?.userData.presentationOwned).toBe(true);
    expect(h.releases).toEqual(["late.png"]);
    expect(h.service.removeDecal("late")).toBe(true);
    h.service.dispose();
  });

  it("G9: pós-processamento instala o composer no render, liga/desliga passes e pulso temporário", () => {
    const h = harness();
    h.service.update(1 / 60);
    expect(h.frameRenderers).toEqual([]); // desligado por padrão

    h.service.pulseBloom(2, 0.2);
    expect(h.frameRenderers).toHaveLength(1);
    const composer = h.frameRenderers[0] as PostFXComposer;
    expect(composer).toBeInstanceOf(PostFXComposer);
    expect(composer.getEnabledPassNames()).toEqual(["render", "bloom", "output"]);
    h.service.update(0.1);
    h.service.update(0); // pausado: pulso não avança
    expect(h.service.isPostProcessingActive()).toBe(true);
    h.service.update(0.15);
    expect(h.frameRenderers.at(-1)).toBeNull();
    expect(h.service.isPostProcessingActive()).toBe(false);

    h.service.configurePostProcessing({ enableBloom: true, vignetteIntensity: 0.5, chromaticAberrationOffset: 0.01, enableSSAO: true });
    expect(h.frameRenderers.at(-1)).toBe(composer);
    expect(composer.getEnabledPassNames()).toEqual(["render", "ssao", "bloom", "output", "vignette"]);
    const changed = h.emitted.filter((e) => e.type === "game.vfx.postfx-changed").at(-1)?.payload as { activePasses: string[] };
    expect(changed.activePasses).toEqual(["bloom", "ssao", "vignette", "chromatic-aberration"]);

    h.service.configurePostProcessing({ enabled: false });
    expect(h.frameRenderers.at(-1)).toBeNull();
    h.service.configurePostProcessing({ enableBloom: false, vignetteIntensity: 0.3 });
    expect(h.frameRenderers.at(-1)).toBe(composer);
    h.service.dispose();
    expect(h.frameRenderers.at(-1)).toBeNull();
  });

  it("G9: color grading só entra com o LUT carregado", () => {
    const pipeline = new PostProcessingPipeline();
    let lut: THREE.Texture | null = null;
    const composer = new PostFXComposer(pipeline, () => lut);
    pipeline.updateConfig({ enableBloom: false, vignetteIntensity: 0, enableColorGrading: true, lutTextureUrl: "lut.png" });
    expect(composer.getEnabledPassNames()).toEqual(["render", "output"]);
    lut = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    expect(composer.getEnabledPassNames()).toEqual(["render", "output", "color-grading"]);
    composer.dispose();
  });
});
