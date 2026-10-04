import type { AssetType } from "../../../contracts/assets/types";
import type { CachedAssetRecord } from "../../../tokens/assets";

export class AssetCache {
  private readonly cache = new Map<string, CachedAssetRecord>();

  public has(key: string): boolean {
    return this.cache.has(key);
  }

  public get<T = any>(key: string): T | null {
    const record = this.cache.get(key);
    return record ? (record.data as T) : null;
  }

  public set<T = any>(key: string, data: T, type: AssetType): void {
    const existing = this.cache.get(key);
    if (existing) {
      existing.refCount++;
    } else {
      this.cache.set(key, { data, type, refCount: 1 });
    }
  }

  public retain(key: string): boolean {
    const record = this.cache.get(key);
    if (record) {
      record.refCount++;
      return true;
    }
    return false;
  }

  public release(key: string): boolean {
    const record = this.cache.get(key);
    if (!record) return false;

    record.refCount--;

    if (record.refCount <= 0) {
      this.disposeResource(record.data, record.type);
      this.cache.delete(key);
      console.log(`[AssetCache] 🗑️ Asset liberado da VRAM/RAM: ${key}`);
      return true;
    }

    return false;
  }

  public clear(): void {
    for (const [_, record] of this.cache.entries()) {
      this.disposeResource(record.data, record.type);
    }
    this.cache.clear();
    console.log("[AssetCache] 🧹 Cache de VRAM e memória limpo completamente.");
  }

  private disposeResource(data: any, type: AssetType): void {
    if (!data) return;

    if (type === "texture") {
      if (typeof data.dispose === "function") {
        data.dispose();
      }
    } else if (type === "gltf") {
      if (data.scene && typeof data.scene.traverse === "function") {
        data.scene.traverse((object: any) => {
          if (object.geometry && typeof object.geometry.dispose === "function") {
            object.geometry.dispose();
          }
          if (object.material) {
            if (Array.isArray(object.material)) {
              object.material.forEach((mat: any) => mat.dispose && mat.dispose());
            } else if (typeof object.material.dispose === "function") {
              object.material.dispose();
            }
          }
        });
      }
    }
  }
}