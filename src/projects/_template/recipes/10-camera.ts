// Câmera: `game.camera` controla a câmera do render a cada frame (RenderApi.setCameraMode não tem efeito).
// Isométrica que segue um alvo: spring-arm + setFollowTarget a cada tick; zoom = configureSpringArm (mantém o shake).
import type { CameraApi } from "../../../tokens/camera";

const ID = "main";

/** Quaternion de yaw (em torno de Y) seguido de pitch (em torno de X), em graus. Sem alocar Three.js. */
export function yawPitchQuaternion(yawDeg: number, pitchDeg: number): { x: number; y: number; z: number; w: number } {
  const hy = (yawDeg * Math.PI) / 360;
  const hp = (pitchDeg * Math.PI) / 360;
  const cy = Math.cos(hy), sy = Math.sin(hy), cp = Math.cos(hp), sp = Math.sin(hp);
  // q = qYaw * qPitch
  return { x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp };
}

export function setupIsometricCamera(camera: CameraApi, yawDeg = 45, armLength = 40): () => void {
  camera.registerVirtualCamera({
    id: ID,
    priority: 10,
    fov: 35,
    position: { x: 0, y: 30, z: 30 },
    rotation: yawPitchQuaternion(yawDeg, -35),
    springArmConfig: {
      targetArmLength: armLength,
      probeRadius: 0.2,
      socketOffset: { x: 0, y: 0, z: 0 },
      targetOffset: { x: 0, y: 1, z: 0 },
      enableCollision: false,
    },
    shakeConfig: { maxTrauma: 1, traumaDecayRate: 1.5 },
  });
  camera.setActiveCamera(ID, 0);
  return (): void => {
    camera.unregisterVirtualCamera(ID);
  };
}

/** Chame no tick com a posição atual do alvo. */
export function follow(camera: CameraApi, x: number, y: number, z: number): void {
  camera.setFollowTarget(ID, { x, y, z });
}

/** Zoom contínuo (ex.: roda do mouse via listener DOM no adapter). */
export function zoom(camera: CameraApi, armLength: number): void {
  camera.configureSpringArm(ID, { targetArmLength: Math.min(80, Math.max(15, armLength)) });
}

/** Girar 90°: re-registra (zera o shake, por isso só em giros discretos). */
export function rotateTo(camera: CameraApi, yawDeg: number, armLength: number): () => void {
  return setupIsometricCamera(camera, yawDeg, armLength);
}
