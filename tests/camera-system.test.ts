import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { SpringArm3D } from "../src/engine/camera/internal/SpringArm3D";
import { TraumaCameraShake } from "../src/engine/camera/internal/TraumaCameraShake";
import { VirtualCameraStack } from "../src/engine/camera/internal/VirtualCameraStack";

describe("Camada de Câmera Dinâmica & SpringArm (game.camera)", () => {
  let springArm: SpringArm3D;
  let shake: TraumaCameraShake;
  let stack: VirtualCameraStack;

  beforeEach(() => {
    springArm = new SpringArm3D({
      targetArmLength: 5.0,
      probeRadius: 0.2,
      socketOffset: { x: 0, y: 1, z: 0 },
      targetOffset: { x: 0, y: 0, z: 0 },
      enableCollision: true,
    });

    shake = new TraumaCameraShake({
      maxTrauma: 1.0,
      traumaDecayRate: 1.0,
      frequencyHz: 20,
    });

    stack = new VirtualCameraStack();
  });

  it("deve recuar a haste do SpringArm quando houver detecção de colisão por Raycast", () => {
    const mockPhysics = {
      castRay: () => ({
        hit: true,
        distance: 2.5,
        point: { x: 0, y: 1, z: 2.5 },
        normal: { x: 0, y: 0, z: 1 },
      }),
    };

    const targetPos = { x: 0, y: 0, z: 0 };
    const rot = new THREE.Quaternion();

    const actualCamPos = springArm.computeCameraPosition(targetPos, rot, mockPhysics as any);

    expect(springArm.isCurrentlyColliding).toBe(true);
    expect(springArm.armLength).toBeLessThan(5.0);
    // Correção: 2.5m (distância) - 0.2m (probeRadius) = 2.3m no eixo Z
    expect(actualCamPos.z).toBeCloseTo(2.3, 1);
  });

  it("deve acumular e dissipar o tremor por trauma na câmera", () => {
    shake.addTrauma(0.8);
    expect(shake.currentTrauma).toBe(0.8);

    const update1 = shake.update(0.1);
    expect(shake.currentTrauma).toBeCloseTo(0.7, 1);
    expect(update1.positionOffset.length()).toBeGreaterThan(0);

    shake.update(1.0);
    expect(shake.currentTrauma).toBe(0);
  });

  it("deve alternar e realizar o blending entre duas câmeras virtuais de prioridades diferentes", () => {
    stack.registerCamera({
      id: "cam_follow",
      priority: 10,
      fov: 60,
      position: { x: 0, y: 5, z: 10 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    });

    stack.registerCamera({
      id: "cam_aim",
      priority: 20,
      fov: 40,
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    });

    // G46: a câmera de maior prioridade assume ao ser registrada.
    expect(stack.getActiveCameraId()).toBe("cam_aim");
    stack.update(1); // conclui o blend de entrada (0,5 s padrão)

    stack.setActiveCamera("cam_follow", 0.2);
    expect(stack.getActiveCameraId()).toBe("cam_follow");

    const blended = stack.update(0.1);
    expect(blended.fov).toBeCloseTo(50, 1);
  });
});