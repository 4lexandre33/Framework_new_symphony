import * as THREE from "three";
import { AssetCache } from "./AssetCache";

export class TextureLoaderService {
  private readonly loader = new THREE.TextureLoader();

  constructor(private readonly cache: AssetCache) {}

  public async load(url: string): Promise<THREE.Texture> {
    if (this.cache.has(url)) {
      this.cache.retain(url);
      return this.cache.get<THREE.Texture>(url)!;
    }

    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          this.cache.set(url, texture, "texture");
          console.log(`[TextureLoaderService] ✅ Textura carregada na VRAM: ${url}`);
          resolve(texture);
        },
        undefined,
        (error) => {
          console.error(`[TextureLoaderService] ❌ Erro ao carregar textura ${url}:`, error);
          reject(error);
        }
      );
    });
  }
}