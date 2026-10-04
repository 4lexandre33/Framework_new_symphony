import { type AssetsApi } from "../../../tokens/assets";
import { AssetCache } from "./AssetCache";
import { GLTFLoaderService } from "./GLTFLoaderService";
import { TextureLoaderService } from "./TextureLoaderService";
import { AudioLoaderService } from "./AudioLoaderService";

export class AssetsManagerService implements AssetsApi {
  private readonly cache = new AssetCache();
  private readonly gltfLoader = new GLTFLoaderService(this.cache);
  private readonly textureLoader = new TextureLoaderService(this.cache);
  private readonly audioLoader = new AudioLoaderService(this.cache);

  async loadGLTF(url: string): Promise<any> {
    return await this.gltfLoader.load(url);
  }

  async loadTexture(url: string): Promise<any> {
    return await this.textureLoader.load(url);
  }

  async loadAudio(url: string): Promise<AudioBuffer> {
    return await this.audioLoader.load(url);
  }

  releaseAsset(url: string): void {
    this.cache.release(url);
  }

  getAsset<T = any>(url: string): T | null {
    return this.cache.get<T>(url);
  }

  clearCache(): void {
    this.cache.clear();
  }
}
