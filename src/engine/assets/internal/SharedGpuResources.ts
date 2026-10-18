import type {
  AssetType,
} from "../../../contracts/assets/types";

import {
  RENDER_SHARED_RESOURCE,
} from "../../../contracts/render/types";

/**
 * G81: recursos de GPU (geometria, material, textura) de um asset em cache
 * são COMPARTILHADOS com as instâncias (`loadGLTF` clona só a hierarquia) e
 * com quem usa a textura do cache. O cache é o dono: estes recursos recebem
 * a marca `RENDER_SHARED_RESOURCE` (contracts/render), que o render respeita
 * em `removeMeshFromScene` (não libera o que está marcado). Diferente de
 * `userData.renderRetain`, a marca não passa para `clone()` (o three copia
 * `userData`; a geometria até compartilha o mesmo objeto). Eles são
 * liberados só quando o asset sai do cache (refCount 0 via `releaseAsset`/
 * `releaseInstance`, `clearCache`, dispose), momento em que a marca sai.
 */
type Marked = { [RENDER_SHARED_RESOURCE]?: boolean };

/** Quantos assets em cache possuem o recurso (pode haver mais de um). */
const owners = new WeakMap<object, number>();

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isTextureLike(value: unknown): value is object {
  return isObject(value) && value.isTexture === true;
}

function collectMaterial(material: unknown, out: Set<object>): void {
  if (!isObject(material) || material.isMaterial !== true) {
    return;
  }

  out.add(material);

  for (const value of Object.values(material)) {
    if (isTextureLike(value)) {
      out.add(value);
    }
  }

  const uniforms = material.uniforms;

  if (isObject(uniforms)) {
    for (const uniform of Object.values(uniforms)) {
      const value = isObject(uniform) ? uniform.value : undefined;

      if (isTextureLike(value)) {
        out.add(value);
      } else if (Array.isArray(value)) {
        for (const entry of value) {
          if (isTextureLike(entry)) out.add(entry);
        }
      }
    }
  }
}

/** Geometrias, materiais e texturas de um asset de cache (gltf/texture). */
export function collectSharedGpuResources(data: unknown, type: AssetType): Set<object> {
  const out = new Set<object>();

  if (type === "texture") {
    if (isTextureLike(data)) out.add(data);
    return out;
  }

  if (type !== "gltf" || !isObject(data)) {
    return out;
  }

  const roots: unknown[] = [data.scene];

  if (Array.isArray(data.scenes)) {
    roots.push(...(data.scenes as unknown[]));
  }

  const visited = new Set<unknown>();

  for (const root of roots) {
    if (!isObject(root) || visited.has(root) || typeof root.traverse !== "function") {
      continue;
    }

    visited.add(root);

    (root.traverse as (callback: (node: unknown) => void) => void)((node: unknown): void => {
      if (!isObject(node)) return;

      const geometry = node.geometry;

      if (isObject(geometry) && geometry.isBufferGeometry === true) {
        out.add(geometry);
      }

      const material = node.material;

      if (Array.isArray(material)) {
        for (const entry of material) collectMaterial(entry, out);
      } else {
        collectMaterial(material, out);
      }
    });
  }

  return out;
}

/** Marca os recursos compartilhados do asset como do cache (render não libera). */
export function markSharedGpuResources(data: unknown, type: AssetType): number {
  let marked = 0;

  for (const resource of collectSharedGpuResources(data, type)) {
    const target = resource as Marked;
    owners.set(resource, (owners.get(resource) ?? 0) + 1);

    if (target[RENDER_SHARED_RESOURCE] !== true) {
      // Não enumerável: fora de JSON/Object.keys/cópias.
      Object.defineProperty(target, RENDER_SHARED_RESOURCE, {
        value: true,
        configurable: true,
        enumerable: false,
        writable: true,
      });
      marked += 1;
    }
  }

  return marked;
}

/** Retira a marca antes de o cache liberar (o recurso deixa de ter dono). */
export function unmarkSharedGpuResources(data: unknown, type: AssetType): void {
  for (const resource of collectSharedGpuResources(data, type)) {
    const count = (owners.get(resource) ?? 0) - 1;

    if (count > 0) {
      owners.set(resource, count);
      continue;
    }

    owners.delete(resource);
    delete (resource as Marked)[RENDER_SHARED_RESOURCE];
  }
}

export function isSharedGpuResource(resource: object): boolean {
  return (resource as Marked)[RENDER_SHARED_RESOURCE] === true;
}
