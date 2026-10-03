import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { GPUParticleSystem } from "../src/engine/vfx/GPUParticleSystem";
import { DecalManager } from "../src/engine/vfx/DecalManager";
import { PostProcessingPipeline } from "../src/engine/vfx/PostProcessingPipeline";

describe("Camada de Efeitos Visuais & Pós-Processamento (game.vfx)", () => {
  let particleSystem: GPUParticleSystem;
  let decalManager: DecalManager;
  let postProcessing: PostProcessingPipeline;

  beforeEach(() => {
    particleSystem = new GPUParticleSystem();
    decalManager = new DecalManager();
    postProcessing = new PostProcessingPipeline();
  });

  it("deve instanciar um emissor GPU com atributos de partículas no buffer", () => {
    const mesh = particleSystem.spawnEmitter({
      emitterId: "fire_01",
      maxParticles: 500,
      spawnRatePerSecond: 100,
      particleLifetimeSeconds: 2.0,
      startSize: 1.0,
      endSize: 0.1,
      startColor: { r: 1, g: 0.5, b: 0 },
      endColor: { r: 1, g: 0, b: 0 },
      position: { x: 0, y: 0, z: 0 },
      velocityBase: { x: 0, y: 2, z: 0 },
      velocityVariance: { x: 0.5, y: 0.5, z: 0.5 },
    });

    expect(mesh).toBeInstanceOf(THREE.Points);
    expect(particleSystem.getTotalActiveParticles()).toBe(500);

    particleSystem.update(0.1);
    particleSystem.stopEmitter("fire_01");
    expect(particleSystem.getTotalActiveParticles()).toBe(0);
  });

  it("deve projetar decal no cenário e reciclar instâncias antigas em Ring Buffer ao atingir o limite", () => {
    const mockScene = new THREE.Scene();
    const mockTexture = new THREE.Texture();

    for (let i = 0; i < 210; i++) {
      decalManager.projectDecal(
        {
          decalId: `bullet_hole_${i}`,
          textureUrl: "bullet.png",
          position: { x: i, y: 0, z: 0 },
          orientationNormal: { x: 0, y: 1, z: 0 },
          size: { x: 0.2, y: 0.2, z: 0.2 },
        },
        mockTexture,
        mockScene
      );
    }

    expect(decalManager.getActiveDecalCount()).toBe(200);
    decalManager.clear(mockScene);
    expect(decalManager.getActiveDecalCount()).toBe(0);
  });

  it("deve alterar configurações e disparar pulso de Bloom na pipeline de pós-processamento", () => {
    postProcessing.updateConfig({ bloomStrength: 1.2 });
    expect(postProcessing.getConfig().bloomStrength).toBe(1.2);

    postProcessing.triggerBloomPulse(3.0, 0.2);
    expect(postProcessing.getConfig().bloomStrength).toBe(3.0);

    postProcessing.update(0.3);
    expect(postProcessing.getConfig().bloomStrength).toBe(1.2);
  });
});