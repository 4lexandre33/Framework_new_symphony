/** Porta local ao jogo: a lógica física não conhece Three.js nem DOM. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Quat extends Vec3 {
  readonly w: number;
}

export interface __PASCAL__ViewPort {
  setBoxTransform(position: Vec3, rotation: Quat): void;
  dispose(): void;
}
