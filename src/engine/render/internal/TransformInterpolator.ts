import * as THREE from "three";

/**
 * Interpolação de transforms entre ticks fixos (G40).
 *
 * Modelo: o estado "anterior" de cada objeto é capturado no INÍCIO de cada
 * `game.loop.tick` (`capture`). O jogo move o objeto no tick (estado
 * "atual", autoritativo). No desenho, `apply(alpha)` escreve
 * lerp(anterior, atual, alpha) no objeto e `restore()` devolve o estado
 * autoritativo logo após `renderer.render`. Sem alocação por frame.
 */
interface InterpolatedEntry {
  readonly object: THREE.Object3D;
  readonly previousPosition: THREE.Vector3;
  readonly previousQuaternion: THREE.Quaternion;
  readonly previousScale: THREE.Vector3;
  readonly currentPosition: THREE.Vector3;
  readonly currentQuaternion: THREE.Quaternion;
  readonly currentScale: THREE.Vector3;
  hasPrevious: boolean;
}

export class TransformInterpolator {
  private readonly entries: InterpolatedEntry[] = [];
  private applied = false;

  public get size(): number {
    return this.entries.length;
  }

  public has(object: THREE.Object3D): boolean {
    return this.indexOf(object) >= 0;
  }

  public add(object: THREE.Object3D): void {
    if (this.indexOf(object) >= 0) {
      return;
    }

    this.entries.push({
      object,
      previousPosition: new THREE.Vector3().copy(object.position),
      previousQuaternion: new THREE.Quaternion().copy(object.quaternion),
      previousScale: new THREE.Vector3().copy(object.scale),
      currentPosition: new THREE.Vector3(),
      currentQuaternion: new THREE.Quaternion(),
      currentScale: new THREE.Vector3(),
      hasPrevious: false,
    });
  }

  public remove(object: THREE.Object3D): boolean {
    const index = this.indexOf(object);

    if (index < 0) {
      return false;
    }

    // Swap-remove: ordem não importa.
    const last = this.entries.length - 1;
    this.entries[index] = this.entries[last] as InterpolatedEntry;
    this.entries.pop();
    return true;
  }

  /** Esquece o estado anterior (teleporte): o próximo frame mostra o atual. */
  public snap(object: THREE.Object3D): void {
    const index = this.indexOf(object);

    if (index >= 0) {
      (this.entries[index] as InterpolatedEntry).hasPrevious = false;
    }
  }

  /** Início de cada tick fixo: "anterior" = estado autoritativo atual. */
  public capture(): void {
    for (let index = 0; index < this.entries.length; index += 1) {
      const entry = this.entries[index] as InterpolatedEntry;

      entry.previousPosition.copy(entry.object.position);
      entry.previousQuaternion.copy(entry.object.quaternion);
      entry.previousScale.copy(entry.object.scale);
      entry.hasPrevious = true;
    }
  }

  /** Escreve o transform interpolado (guarda o autoritativo para `restore`). */
  public apply(alpha: number): void {
    if (this.entries.length === 0) {
      return;
    }

    const t =
      Number.isFinite(alpha)
        ? Math.min(1, Math.max(0, alpha))
        : 1;

    for (let index = 0; index < this.entries.length; index += 1) {
      const entry = this.entries[index] as InterpolatedEntry;
      const object = entry.object;

      entry.currentPosition.copy(object.position);
      entry.currentQuaternion.copy(object.quaternion);
      entry.currentScale.copy(object.scale);

      if (!entry.hasPrevious) {
        continue;
      }

      object.position.lerpVectors(entry.previousPosition, entry.currentPosition, t);
      object.quaternion.slerpQuaternions(
        entry.previousQuaternion,
        entry.currentQuaternion,
        t,
      );
      object.scale.lerpVectors(entry.previousScale, entry.currentScale, t);
    }

    this.applied = true;
  }

  /** Restaura o estado autoritativo após o desenho. */
  public restore(): void {
    if (!this.applied) {
      return;
    }

    for (let index = 0; index < this.entries.length; index += 1) {
      const entry = this.entries[index] as InterpolatedEntry;

      entry.object.position.copy(entry.currentPosition);
      entry.object.quaternion.copy(entry.currentQuaternion);
      entry.object.scale.copy(entry.currentScale);
    }

    this.applied = false;
  }

  public clear(): void {
    this.restore();
    this.entries.length = 0;
  }

  private indexOf(object: THREE.Object3D): number {
    for (let index = 0; index < this.entries.length; index += 1) {
      if ((this.entries[index] as InterpolatedEntry).object === object) {
        return index;
      }
    }

    return -1;
  }
}
