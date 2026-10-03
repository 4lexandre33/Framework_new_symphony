import * as THREE from "three";
import type { SpringArmConfig, Vector3Camera } from "../../contracts/camera/types";
import type { PhysicsApi } from "../../tokens/physics";

export class SpringArm3D {
  private currentArmLength: number;
  private isColliding = false;

  // Objeto de riscado (Scratch Vectors) pré-alocados para Zero GC no loop de render
  private readonly scratchTargetPos = new THREE.Vector3();
  private readonly scratchSocketPos = new THREE.Vector3();
  private readonly scratchArmDir = new THREE.Vector3();
  private readonly scratchDesiredCamPos = new THREE.Vector3();
  private readonly scratchActualCamPos = new THREE.Vector3();

  public constructor(private config: SpringArmConfig) {
    this.currentArmLength = config.targetArmLength;
  }

  public get armLength(): number {
    return this.currentArmLength;
  }

  public get isCurrentlyColliding(): boolean {
    return this.isColliding;
  }

  public updateConfig(newConfig: Partial<SpringArmConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  public computeCameraPosition(
    targetWorldPos: Vector3Camera,
    cameraRotation: THREE.Quaternion,
    physics?: PhysicsApi | null
  ): THREE.Vector3 {
    const { targetArmLength, probeRadius, socketOffset, targetOffset, enableCollision } =
      this.config;

    // 1. Posição Base do Alvo com Offset
    this.scratchTargetPos
      .set(targetWorldPos.x, targetWorldPos.y, targetWorldPos.z)
      .add(new THREE.Vector3(targetOffset.x, targetOffset.y, targetOffset.z));

    // 2. Calcular Direção Normalizada do Braço a partir da rotação
    this.scratchArmDir.set(0, 0, 1).applyQuaternion(cameraRotation).normalize();

    // 3. Posição Desejada sem Colisão
    const socket = new THREE.Vector3(socketOffset.x, socketOffset.y, socketOffset.z).applyQuaternion(
      cameraRotation
    );
    this.scratchSocketPos.copy(this.scratchTargetPos).add(socket);

    this.scratchDesiredCamPos
      .copy(this.scratchSocketPos)
      .addScaledVector(this.scratchArmDir, targetArmLength);

    let effectiveLength = targetArmLength;
    this.isColliding = false;

    // 4. Teste de Colisão por Raycast se a física estiver disponível
    if (enableCollision !== false && physics) {
      const rayHit = physics.castRay({
        origin: {
          x: this.scratchSocketPos.x,
          y: this.scratchSocketPos.y,
          z: this.scratchSocketPos.z,
        },
        direction: {
          x: this.scratchArmDir.x,
          y: this.scratchArmDir.y,
          z: this.scratchArmDir.z,
        },
        maxDistance: targetArmLength,
        solid: true,
      });

      if (rayHit.hit) {
        this.isColliding = true;
        effectiveLength = Math.max(0.2, rayHit.distance - probeRadius);
      }
    }

    // 5. Retração instantânea em colisão / Retorno suave sem colisão
    if (effectiveLength < this.currentArmLength) {
      this.currentArmLength = effectiveLength;
    } else {
      const smoothFactor = 0.1;
      this.currentArmLength += (effectiveLength - this.currentArmLength) * smoothFactor;
    }

    this.scratchActualCamPos
      .copy(this.scratchSocketPos)
      .addScaledVector(this.scratchArmDir, this.currentArmLength);

    return this.scratchActualCamPos;
  }
}