import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { AssetCache } from "./AssetCache";

export class GLTFLoaderService {
  private readonly loader = new GLTFLoader();

  constructor(private readonly cache: AssetCache) {}

  public async load(url: string): Promise<GLTF> {
    if (this.cache.has(url)) {
      this.cache.retain(url);
      return this.cache.get<GLTF>(url)!;
    }

    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (gltf) => {
          this.cache.set(url, gltf, "gltf");
          console.log(`[GLTFLoaderService] ✅ Modelo 3D carregado: ${url}`);
          resolve(gltf);
        },
        (progress) => {
          if (progress.total > 0) {
            const percent = (progress.loaded / progress.total) * 100;
            console.log(`[GLTFLoaderService] Carregando ${url}: ${percent.toFixed(1)}%`);
          }
        },
        (error) => {
          console.error(`[GLTFLoaderService] ❌ Erro ao carregar GLTF ${url}:`, error);
          reject(error);
        }
      );
    });
  }
}