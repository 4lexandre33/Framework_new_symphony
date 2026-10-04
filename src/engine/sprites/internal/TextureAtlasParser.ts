import * as THREE from "three";
import type {
  TextureAtlasJSON,
  AtlasFrameData,
  UVRect,
} from "../../../contracts/sprites/types";

export class TextureAtlasParser {
  private readonly atlasFrames = new Map<string, Map<string, UVRect>>();

  public parseAtlas(
    atlasKey: string,
    json: TextureAtlasJSON,
    texture: THREE.Texture
  ): void {
    // Aplica filtragem Nearest-Neighbor para Pixel Art nítida
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;

    const imgW = json.meta.size.w;
    const imgH = json.meta.size.h;

    const frameMap = new Map<string, UVRect>();

    const rawFrames = json.frames;
    if (Array.isArray(rawFrames)) {
      for (const item of rawFrames) {
        this.addFrameToMap(frameMap, item.filename, item, imgW, imgH);
      }
    } else {
      for (const [frameName, item] of Object.entries(rawFrames)) {
        this.addFrameToMap(frameMap, frameName, item, imgW, imgH);
      }
    }

    this.atlasFrames.set(atlasKey, frameMap);
  }

  public getFrameUV(atlasKey: string, frameName: string): UVRect | null {
    const map = this.atlasFrames.get(atlasKey);
    if (!map) return null;
    return map.get(frameName) || null;
  }

  public hasAtlas(atlasKey: string): boolean {
    return this.atlasFrames.has(atlasKey);
  }

  public clear(): void {
    this.atlasFrames.clear();
  }

  private addFrameToMap(
    map: Map<string, UVRect>,
    name: string,
    data: AtlasFrameData,
    imgW: number,
    imgH: number
  ): void {
    const f = data.frame;
    const u = f.x / imgW;
    const v = 1.0 - (f.y + f.h) / imgH; // Inverte eito Y para WebGL
    const w = f.w / imgW;
    const h = f.h / imgH;

    map.set(name, { u, v, w, h });
  }
}