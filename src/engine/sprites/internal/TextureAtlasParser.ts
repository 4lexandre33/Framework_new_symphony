import * as THREE from "three";

import type {
  AtlasFrameData,
  TextureAtlasJSON,
  UVRect,
} from "../../../contracts/sprites/types";

function assertPositiveFinite(
  value:
    number,
  label:
    string,
): void {
  if (
    !Number.isFinite(
      value,
    ) ||
    value <=
      0
  ) {
    throw new RangeError(
      `${label} precisa ser finito e > 0.`,
    );
  }
}

export class TextureAtlasParser {
  private readonly atlasFrames =
    new Map<
      string,
      Map<
        string,
        UVRect
      >
    >();

  public parseAtlas(
    atlasKey:
      string,
    json:
      TextureAtlasJSON,
    texture:
      THREE.Texture,
  ): void {
    const normalizedKey =
      atlasKey.trim();

    if (
      normalizedKey.length ===
      0
    ) {
      throw new RangeError(
        "atlasKey não pode ser vazio.",
      );
    }

    const imgW =
      json.meta.size.w;

    const imgH =
      json.meta.size.h;

    assertPositiveFinite(
      imgW,
      "atlas width",
    );

    assertPositiveFinite(
      imgH,
      "atlas height",
    );

    texture.magFilter =
      THREE.NearestFilter;

    texture.minFilter =
      THREE.NearestFilter;

    texture.generateMipmaps =
      false;

    texture.needsUpdate =
      true;

    const frameMap =
      new Map<
        string,
        UVRect
      >();

    const rawFrames =
      json.frames;

    if (
      Array.isArray(
        rawFrames,
      )
    ) {
      for (
        const item of
        rawFrames
      ) {
        this.addFrameToMap(
          frameMap,
          item.filename,
          item,
          imgW,
          imgH,
        );
      }
    } else {
      for (
        const [
          frameName,
          item,
        ] of
        Object.entries(
          rawFrames,
        )
      ) {
        this.addFrameToMap(
          frameMap,
          frameName,
          item,
          imgW,
          imgH,
        );
      }
    }

    this.atlasFrames.set(
      normalizedKey,
      frameMap,
    );
  }

  public getFrameUV(
    atlasKey:
      string,
    frameName:
      string,
  ): UVRect | null {
    return (
      this.atlasFrames
        .get(
          atlasKey,
        )
        ?.get(
          frameName,
        ) ??
      null
    );
  }

  public hasAtlas(
    atlasKey:
      string,
  ): boolean {
    return this.atlasFrames.has(
      atlasKey,
    );
  }

  public clear(): void {
    this.atlasFrames.clear();
  }

  private addFrameToMap(
    map:
      Map<
        string,
        UVRect
      >,
    name:
      string,
    data:
      AtlasFrameData,
    imgW:
      number,
    imgH:
      number,
  ): void {
    const normalizedName =
      name.trim();

    if (
      normalizedName.length ===
      0
    ) {
      return;
    }

    const frame =
      data.frame;

    if (
      !Number.isFinite(
        frame.x,
      ) ||
      !Number.isFinite(
        frame.y,
      ) ||
      !Number.isFinite(
        frame.w,
      ) ||
      !Number.isFinite(
        frame.h,
      ) ||
      frame.w <
        0 ||
      frame.h <
        0
    ) {
      return;
    }

    const u =
      frame.x /
      imgW;

    const v =
      1 -
      (
        frame.y +
        frame.h
      ) /
        imgH;

    const w =
      frame.w /
      imgW;

    const h =
      frame.h /
      imgH;

    map.set(
      normalizedName,
      {
        u,
        v,
        w,
        h,
      },
    );
  }
}
