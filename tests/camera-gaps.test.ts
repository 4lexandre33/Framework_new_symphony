import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { PluginContext } from "@core";
import type { VirtualCameraDescriptor } from "../src/contracts/camera/types";
import type { RaycastHit, RaycastRequest, MutableBodyTransformDTO } from "../src/contracts/physics/types";
import { CameraService } from "../src/engine/camera/internal/CameraService";
import { SpringArm3D } from "../src/engine/camera/internal/SpringArm3D";
import type { PhysicsApi } from "../src/tokens/physics";
import type { Render3DApi } from "../src/tokens/render";

interface Emitted {
  type: string;
  payload: unknown;
}

function setup(physicsOverrides: Partial<PhysicsApi> = {}): {
  service: CameraService;
  camera: THREE.PerspectiveCamera;
  emitted: Emitted[];
  bodies: Map<string, { x: number; y: number; z: number }>;
  rays: RaycastRequest[];
} {
  const emitted: Emitted[] = [];
  const ctx = {
    events: {
      emit: (type: string, payload: unknown): void => {
        emitted.push({ type, payload });
      },
    },
    commands: { send: async (): Promise<void> => {} },
  } as unknown as PluginContext;
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100);
  camera.position.set(1, 2, 3);
  const render = { getActiveCamera: (): THREE.Camera => camera } as unknown as Render3DApi;
  const bodies = new Map<string, { x: number; y: number; z: number }>();
  const rays: RaycastRequest[] = [];
  const physics = {
    castRay: (request: RaycastRequest): RaycastHit => {
      rays.push({ ...request });
      return { hit: false, distance: 0 } as RaycastHit;
    },
    getBodyTransformInto: (id: string, out: MutableBodyTransformDTO): boolean => {
      const body = bodies.get(id);
      if (body === undefined) return false;
      out.position.x = body.x;
      out.position.y = body.y;
      out.position.z = body.z;
      return true;
    },
    ...physicsOverrides,
  } as unknown as PhysicsApi;
  const service = new CameraService(ctx);
  service.bindDependencies(physics, render);
  return { service, camera, emitted, bodies, rays };
}

function cam(id: string, extra: Partial<VirtualCameraDescriptor> = {}): VirtualCameraDescriptor {
  return {
    id,
    priority: 0,
    fov: 60,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    ...extra,
  };
}

describe("camera gaps (G4, G45–G48)", () => {
  it("G4: sem câmera virtual (ou desabilitado) a câmera do render não é sobrescrita", () => {
    const { service, camera } = setup();
    service.render(1 / 60);
    expect(camera.position.toArray()).toEqual([1, 2, 3]);
    expect(camera.fov).toBe(70);

    service.registerVirtualCamera(cam("a", { position: { x: 5, y: 5, z: 5 } }));
    service.setEnabled(false);
    service.render(1 / 60);
    expect(camera.position.toArray()).toEqual([1, 2, 3]);
    expect(service.isEnabled()).toBe(false);

    service.setEnabled(true);
    service.render(1 / 60);
    expect(camera.position.toArray()).toEqual([5, 5, 5]);
  });

  it("G45: o raio do braço ignora o alvo e sensores; sem alvo conhecido a colisão fica desligada por padrão", () => {
    const { service, bodies, rays } = setup();
    bodies.set("hero", { x: 0, y: 0, z: 0 });
    service.registerVirtualCamera(
      cam("arm", {
        followTargetId: "hero",
        springArmConfig: { targetArmLength: 5, probeRadius: 0.2, socketOffset: { x: 0, y: 0, z: 0 }, targetOffset: { x: 0, y: 0, z: 0 } },
      }),
    );
    service.render(1 / 60);
    expect(rays).toHaveLength(1);
    expect(rays[0]).toMatchObject({ excludeEntityId: "hero", excludeSensors: true });

    // Sem entidade a ignorar e sem enableCollision explícito: não lança raio.
    const arm = new SpringArm3D({ targetArmLength: 5, probeRadius: 0.2, socketOffset: { x: 0, y: 0, z: 0 }, targetOffset: { x: 0, y: 0, z: 0 } });
    let castCount = 0;
    const physics = { castRay: (): RaycastHit => { castCount += 1; return { hit: true, distance: 0.1 } as RaycastHit; } } as unknown as PhysicsApi;
    const pos = arm.computeCameraPosition({ x: 0, y: 0, z: 0 }, new THREE.Quaternion(), physics, 1 / 60);
    expect(castCount).toBe(0);
    expect(pos.z).toBeCloseTo(5, 6);
  });

  it("G46: prioridade decide a ativa e emite evento; spring-arm sem alvo fica em position", () => {
    const { service, emitted, camera } = setup();
    service.registerVirtualCamera(cam("low", { priority: 1 }));
    expect(service.getActiveCameraId()).toBe("low");
    expect(emitted.filter((e) => e.type === "game.camera.state-changed")).toEqual([
      { type: "game.camera.state-changed", payload: { activeCameraId: "low", previousCameraId: null, blendDurationSeconds: 0 } },
    ]);
    service.registerVirtualCamera(cam("high", { priority: 5, blendDurationSeconds: 0 }));
    expect(service.getActiveCameraId()).toBe("high");
    service.registerVirtualCamera(cam("mid", { priority: 3 }));
    expect(service.getActiveCameraId()).toBe("high");
    expect(service.setCameraPriority("mid", 10)).toBe(true);
    expect(service.getActiveCameraId()).toBe("mid");
    service.unregisterVirtualCamera("mid");
    expect(service.getActiveCameraId()).toBe("high");
    expect(emitted.filter((e) => e.type === "game.camera.state-changed").map((e) => (e.payload as { activeCameraId: string }).activeCameraId)).toEqual([
      "low",
      "high",
      "mid",
      "high",
    ]);

    service.registerVirtualCamera(
      cam("armcam", {
        priority: 100,
        blendDurationSeconds: 0,
        position: { x: 7, y: 8, z: 9 },
        springArmConfig: { targetArmLength: 5, probeRadius: 0.2, socketOffset: { x: 0, y: 0, z: 0 }, targetOffset: { x: 0, y: 0, z: 0 }, enableCollision: false },
      }),
    );
    service.render(1 / 60);
    expect(camera.position.toArray()).toEqual([7, 8, 9]);
  });

  it("G47: followTargetId/lookAtTargetId via física, blend do descritor e oclusão", () => {
    const { service, camera, bodies, emitted } = setup({
      castRay: (request: RaycastRequest): RaycastHit =>
        ({ hit: request.maxDistance > 1, distance: 1, entityId: "wall" }) as RaycastHit,
    });
    bodies.set("hero", { x: 10, y: 0, z: 0 });
    bodies.set("boss", { x: 10, y: 0, z: -10 });
    service.registerVirtualCamera(
      cam("follow", { followTargetId: "hero", position: { x: 0, y: 2, z: 6 }, lookAtTargetId: "boss", detectOcclusion: true }),
    );
    service.render(1 / 60);
    expect(camera.position.toArray()).toEqual([10, 2, 6]);
    // Olhando para o boss: o eixo -Z da câmera aponta para (10,0,-10).
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const expected = new THREE.Vector3(0, -2, -16).normalize();
    expect(forward.distanceTo(expected)).toBeLessThan(1e-6);

    bodies.set("hero", { x: 20, y: 0, z: 0 });
    service.render(1 / 60);
    expect(camera.position.x).toBe(20);

    const occlusion = emitted.filter((e) => e.type === "game.camera.occlusion-changed");
    expect(occlusion).toHaveLength(1);
    expect(occlusion[0]?.payload).toEqual({ cameraId: "follow", occludedEntityIds: ["wall"] });

    // blendDurationSeconds do descritor é o padrão de setActiveCamera.
    service.registerVirtualCamera(cam("fixed", { position: { x: 0, y: 0, z: 0 }, blendDurationSeconds: 2 }));
    service.setActiveCamera("fixed");
    const changed = emitted.filter((e) => e.type === "game.camera.state-changed").at(-1);
    expect(changed?.payload).toMatchObject({ activeCameraId: "fixed", blendDurationSeconds: 2 });
    for (let i = 0; i < 4; i += 1) service.render(0.25); // metade do blend de 2 s
    expect(camera.position.x).toBeCloseTo(10, 6);

    // Alvo manual tem precedência sobre o id; setLookAtTarget(null) volta ao id.
    service.setFollowTarget("follow", { x: 0, y: 0, z: 0 });
    expect(service.clearFollowTarget("follow")).toBe(true);
    expect(service.setLookAtTarget("nope", null)).toBe(false);
  });

  it("G47: com pausa (delta 0) o blend e o shake congelam", () => {
    const { service, camera } = setup();
    service.registerVirtualCamera(cam("a", { position: { x: 0, y: 0, z: 0 } }));
    service.render(1 / 60);
    service.registerVirtualCamera(cam("b", { priority: 1, position: { x: 10, y: 0, z: 0 }, blendDurationSeconds: 1 }));
    service.render(0.5);
    const x = camera.position.x;
    service.render(0);
    service.render(0);
    expect(camera.position.x).toBe(x);
  });

  it("G48: trauma global sobrevive à troca e ao re-registro; setFollowTarget copia o alvo", () => {
    const { service, camera } = setup();
    service.registerVirtualCamera(cam("a"));
    service.addTrauma(0.8);
    service.registerVirtualCamera(cam("b", { priority: 1, blendDurationSeconds: 0 }));
    expect(service.getActiveCameraId()).toBe("b");
    expect(service.getTrauma()).toBeCloseTo(0.8, 6);
    service.registerVirtualCamera(cam("b", { priority: 1, fov: 50 }));
    expect(service.getTrauma()).toBeCloseTo(0.8, 6);
    expect(service.getCurrentCameraSnapshot()?.currentTrauma).toBeCloseTo(0.8, 6);

    const target = { x: 1, y: 2, z: 3 };
    service.registerVirtualCamera(cam("c", { priority: 2, blendDurationSeconds: 0 }));
    service.setFollowTarget("c", target);
    target.x = 999;
    service.render(0); // delta 0: shake congelado (offset do trauma atual)
    expect(Math.abs(camera.position.x - 1)).toBeLessThan(1);
  });
});
