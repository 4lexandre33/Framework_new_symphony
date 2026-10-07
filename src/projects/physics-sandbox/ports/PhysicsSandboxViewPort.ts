/** Porta local ao projeto: regras físicas não conhecem Three.js nem DOM. */
export interface Position3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Rotation4 extends Position3 {
  readonly w: number;
}

export interface PhysicsSandboxViewPort {
  setCubeTransform(position: Position3, rotation: Rotation4): void;
  dispose(): void;
}
