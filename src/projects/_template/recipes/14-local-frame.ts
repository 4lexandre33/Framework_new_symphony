// Referencial local ("ilha"): a física de quem está DENTRO de algo móvel roda num espaço parado, e o desenho aplica a pose.
// Não é mais necessário para mover corpos (use kinematic, receita 15). Use a ilha quando também precisar de:
// - navmesh/IA sobre o objeto móvel (a navmesh do game.ai é estática);
// - coordenadas locais estáveis (rede envia posições relativas ao veículo; partes que se separam divergem sem física extra);
// - forças de curva/frenagem controladas pelo jogo, independentes do atrito.
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

/** Força fictícia de curva/frenagem: aceleração do veículo no referencial local (aplique com applyImpulse(m·a·dt)). */
export function inertialAcceleration(prevSpeed: number, speed: number, yawRate: number, dt: number): { ax: number; az: number } {
  const along = dt > 0 ? (speed - prevSpeed) / dt : 0; // frenagem empurra para frente (+z local se o veículo anda em +z)
  return { ax: -speed * yawRate, az: -along };
}
// Massa para m·a: physics.getBodyMass(id). Velocidade de um corpo: physics.getLinearVelocity(id).
