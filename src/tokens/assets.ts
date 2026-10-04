import { defineCapability } from "@core";
import type { AssetType } from "../contracts/assets/types";

export interface CachedAssetRecord<T = any> {
  readonly data: T;
  readonly type: AssetType;
  refCount: number;
}

export interface AssetsApi {
  /**
   * Carrega assincronamente um modelo 3D GLTF/GLB e incrementa sua contagem de referências.
   */
  loadGLTF(url: string): Promise<any>;

  /**
   * Carrega assincronamente uma textura (PNG, JPG, WebP) para Three.js.
   */
  loadTexture(url: string): Promise<any>;

  /**
   * Carrega e decodifica um arquivo de áudio (WAV, MP3, OGG) via Web Audio API.
   */
  loadAudio(url: string): Promise<AudioBuffer>;

  /**
   * Decrementa a contagem de referências de um asset. Se a contagem atingir zero, a VRAM e a memória RAM são liberadas.
   */
  releaseAsset(url: string): void;

  /**
   * Recupera um asset previamente carregado do cache sem alterar a contagem de referências.
   */
  getAsset<T = any>(url: string): T | null;

  /**
   * Libera todos os assets do cache e esvazia a memória de vídeo (VRAM).
   */
  clearCache(): void;
}

export const AssetsToken = defineCapability<AssetsApi>("game.assets", "1.0.0");