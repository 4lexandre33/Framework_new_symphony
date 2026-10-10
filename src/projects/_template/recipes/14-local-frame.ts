// Referencial local (contorno da lacuna G1): física de quem está "dentro" de algo móvel roda num espaço parado.
// Ex.: o trem fica físico numa ILHA longe da rota; para desenhar, aplique a pose do trem no mundo.
// A ilha fica longe também em X/Z porque `world.querySpatialGrid` é 2D (x,z): evita misturar entidades da ilha com as do mundo.
export interface Pose { x: number; y: number; z: number; yaw: number }

export const ISLAND = { x: -5000, y: -500, z: -5000 } as const;

/** Local (ilha) -> mundo. Escreve em `out` (sem alocar no tick). */
export function islandToWorld(local: { x: number; y: number; z: number }, pose: Pose, out: { x: number; y: number; z: number }): void {
  const lx = local.x - ISLAND.x, ly = local.y - ISLAND.y, lz = local.z - ISLAND.z;
  const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  out.x = pose.x + lx * c + lz * s;
  out.y = pose.y + ly;
  out.z = pose.z - lx * s + lz * c;
}

/** Força fictícia de curva/frenagem: aceleração do trem no referencial local (aplique com applyForce/applyImpulse). */
export function inertialAcceleration(prevSpeed: number, speed: number, yawRate: number, dt: number): { ax: number; az: number } {
  const along = dt > 0 ? (speed - prevSpeed) / dt : 0; // frenagem empurra para frente (+z local se o trem anda em +z)
  return { ax: -speed * yawRate, az: -along };
}
