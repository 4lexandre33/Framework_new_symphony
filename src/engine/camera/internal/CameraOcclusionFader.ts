import * as THREE from "three";

import type { Render3DApi } from "../../../tokens/render";

/** Configuração resolvida do fade de oclusão (G47). */
export interface ResolvedOcclusionFade {
  /** Opacidade alvo (0..1) das malhas que tapam o alvo. */
  readonly opacity: number;
  /** Duração (s) do fade de ida/volta. 0 = instantâneo. */
  readonly fadeSeconds: number;
  /** Prefixo da chave no render: chave = prefixo + entityId. */
  readonly meshKeyPrefix: string;
}

interface MaterialSlot {
  readonly mesh: THREE.Mesh;
  /** Índice no array de materiais; -1 = material único. */
  readonly index: number;
  readonly original: THREE.Material;
  readonly faded: THREE.Material;
  readonly baseOpacity: number;
}

interface FadeRecord {
  readonly object: THREE.Object3D;
  readonly slots: MaterialSlot[];
  current: number;
  target: number;
  speed: number;
}

/**
 * Fade automático das malhas que tapam o alvo da câmera (G47). Troca o
 * material de cada malha por um CLONE transparente (materiais podem ser
 * compartilhados entre instâncias/cache, então o original nunca é mexido),
 * anima a opacidade por frame e, ao desocluir, devolve o original e libera
 * o clone. Alocação só quando o conjunto ocluído muda.
 */
export class CameraOcclusionFader {
  private readonly records = new Map<string, FadeRecord>();

  public get fadingCount(): number {
    return this.records.size;
  }

  public isFaded(entityId: string): boolean {
    return this.records.has(entityId);
  }

  /** Define o conjunto ocluído: novos começam a sumir, os que saíram voltam. */
  public sync(occluded: ReadonlySet<string>, config: ResolvedOcclusionFade, render: Render3DApi): void {
    const opacity = config.opacity;
    const speed = config.fadeSeconds > 0 ? 1 / config.fadeSeconds : Number.POSITIVE_INFINITY;

    for (const [entityId, record] of this.records) {
      record.target = occluded.has(entityId) ? opacity : 1;
      record.speed = speed;
    }

    for (const entityId of occluded) {
      if (this.records.has(entityId)) {
        continue;
      }

      const object = render.getMeshFromScene(config.meshKeyPrefix + entityId);

      if (object === null) {
        continue;
      }

      const slots: MaterialSlot[] = [];
      object.traverse((child): void => {
        const mesh = child as THREE.Mesh;

        if (mesh.isMesh !== true || mesh.material === undefined) {
          return;
        }

        if (Array.isArray(mesh.material)) {
          const fadedList = mesh.material.slice();

          for (let index = 0; index < fadedList.length; index += 1) {
            const original = fadedList[index]!;
            const faded = makeFaded(original);
            fadedList[index] = faded;
            slots.push({ mesh, index, original, faded, baseOpacity: original.opacity });
          }

          mesh.material = fadedList;
        } else {
          const original = mesh.material;
          const faded = makeFaded(original);
          mesh.material = faded;
          slots.push({ mesh, index: -1, original, faded, baseOpacity: original.opacity });
        }
      });

      if (slots.length > 0) {
        this.records.set(entityId, { object, slots, current: 1, target: opacity, speed });
      }
    }
  }

  /** Todos voltam ao normal (com fade). */
  public releaseAll(): void {
    for (const record of this.records.values()) {
      record.target = 1;
    }
  }

  /** Anima as opacidades; sem alocação. */
  public update(deltaSeconds: number): void {
    if (this.records.size === 0) {
      return;
    }

    const dt = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;

    for (const [entityId, record] of this.records) {
      // Removida da cena pelo jogo: devolve os materiais e esquece.
      if (record.object.parent === null) {
        this.restore(record);
        this.records.delete(entityId);
        continue;
      }

      if (record.current !== record.target) {
        const step = record.speed === Number.POSITIVE_INFINITY ? 1 : record.speed * dt;

        if (record.current < record.target) {
          record.current = Math.min(record.target, record.current + step);
        } else {
          record.current = Math.max(record.target, record.current - step);
        }

        const slots = record.slots;

        for (let index = 0; index < slots.length; index += 1) {
          const slot = slots[index]!;
          slot.faded.opacity = slot.baseOpacity * record.current;
        }
      }

      if (record.current >= 1 && record.target >= 1) {
        this.restore(record);
        this.records.delete(entityId);
      }
    }
  }

  /** Restaura tudo na hora (troca de câmera sem fade, dispose). */
  public clear(): void {
    for (const record of this.records.values()) {
      this.restore(record);
    }

    this.records.clear();
  }

  private restore(record: FadeRecord): void {
    for (const slot of record.slots) {
      const material = slot.mesh.material;

      if (slot.index < 0) {
        if (material === slot.faded) {
          slot.mesh.material = slot.original;
        }
      } else if (Array.isArray(material) && material[slot.index] === slot.faded) {
        material[slot.index] = slot.original;
      }

      slot.faded.dispose();
    }
  }
}

function makeFaded(original: THREE.Material): THREE.Material {
  const faded = original.clone();
  faded.transparent = true;
  faded.depthWrite = false;
  faded.needsUpdate = true;
  return faded;
}

/** Normaliza `occlusionFade` do descritor (true = padrões). null = desligado. */
export function resolveOcclusionFade(
  value: boolean | { readonly opacity?: number; readonly fadeSeconds?: number; readonly meshKeyPrefix?: string } | undefined,
): ResolvedOcclusionFade | null {
  if (value === undefined || value === false) {
    return null;
  }

  const config = value === true ? {} : value;
  const opacity = typeof config.opacity === "number" && Number.isFinite(config.opacity) ? Math.min(1, Math.max(0, config.opacity)) : 0.3;
  const fadeSeconds =
    typeof config.fadeSeconds === "number" && Number.isFinite(config.fadeSeconds) ? Math.max(0, config.fadeSeconds) : 0.2;
  const meshKeyPrefix = typeof config.meshKeyPrefix === "string" ? config.meshKeyPrefix : "";
  return { opacity, fadeSeconds, meshKeyPrefix };
}
