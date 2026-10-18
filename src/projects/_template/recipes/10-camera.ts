// Câmera: com uma câmera virtual registrada, `game.camera` controla a câmera do render a cada frame.
// Isométrica que segue um alvo: spring-arm + alvo; zoom pela roda = configureSpringArm (mantém o shake).
import type { CameraApi } from "../../../tokens/camera";
import type { InputApi } from "../../../tokens/input";

const ID = "main";

/** Quaternion de yaw (em torno de Y) seguido de pitch (em torno de X), em graus. Sem alocar Three.js. */
export function yawPitchQuaternion(yawDeg: number, pitchDeg: number): { x: number; y: number; z: number; w: number } {
  const hy = (yawDeg * Math.PI) / 360;
  const hp = (pitchDeg * Math.PI) / 360;
  const cy = Math.cos(hy), sy = Math.sin(hy), cp = Math.cos(hp), sp = Math.sin(hp);
  // q = qYaw * qPitch
  return { x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp };
}

/**
 * `followBodyId`: id de um corpo físico para seguir sozinho (lido a cada frame).
 * Sem ele, chame `follow()` quando o alvo mudar (os números são copiados).
 */
export function setupIsometricCamera(camera: CameraApi, yawDeg = 45, armLength = 40, followBodyId?: string): () => void {
  camera.registerVirtualCamera({
    id: ID,
    priority: 10, // a de maior prioridade fica ativa sozinha
    fov: 35,
    position: { x: 0, y: 30, z: 30 },
    rotation: yawPitchQuaternion(yawDeg, -35),
    ...(followBodyId !== undefined ? { followTargetId: followBodyId } : {}),
    springArmConfig: {
      targetArmLength: armLength,
      probeRadius: 0.2,
      socketOffset: { x: 0, y: 0, z: 0 },
      targetOffset: { x: 0, y: 1, z: 0 },
      enableCollision: false, // isométrica estável (sem encurtar o braço em paredes)
    },
    shakeConfig: { maxTrauma: 1, traumaDecayRate: 1.5 },
    blendDurationSeconds: 0,
  });
  return (): void => {
    camera.unregisterVirtualCamera(ID);
  };
}

/** Alvo manual (ex.: posição calculada pelo jogo). */
export function follow(camera: CameraApi, x: number, y: number, z: number): void {
  camera.setFollowTarget(ID, { x, y, z });
}

/** No tick: roda do mouse acumulada desde o tick anterior → comprimento do braço. Devolve o novo comprimento. */
export function zoomByWheel(camera: CameraApi, input: InputApi, armLength: number): number {
  const wheelY = input.getTickWheelDelta().y; // > 0 = afastar
  if (wheelY === 0) return armLength;
  const next = Math.min(80, Math.max(15, armLength + wheelY * 0.02));
  camera.configureSpringArm(ID, { targetArmLength: next });
  return next;
}

/** Girar 90°: re-registrar o mesmo id troca a rotação e PRESERVA trauma, alvo manual e status de ativa. */
export function rotateTo(camera: CameraApi, yawDeg: number, armLength: number, followBodyId?: string): () => void {
  return setupIsometricCamera(camera, yawDeg, armLength, followBodyId);
}
