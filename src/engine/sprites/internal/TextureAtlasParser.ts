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

const OWNED_TEXTURE_FLAG =
  "presentationOwned";

/**
 * Frame resolvido do atlas (G94).
 *
 * UV do atlas para um ponto (s,t) do sprite (s: esquerda→direita,
 * t: baixo→cima, ambos 0..1 sobre a área RECORTADA do frame):
 *   uv = origin + s * axisU + t * axisV
 * Isso cobre frames girados (TexturePacker gira 90° horário).
 */
export interface ResolvedAtlasFrame {
  readonly name: string;
  readonly uv: UVRect;
  readonly originU: number;
  readonly originV: number;
  readonly axisUx: number;
  readonly axisUy: number;
  readonly axisVx: number;
  readonly axisVy: number;
  readonly rotated: boolean;
  readonly trimmed: boolean;
  /** Tamanho em pixels da área recortada (orientação original). */
  readonly width: number;
  readonly height: number;
  /** Tamanho original (sem recorte) em pixels. */
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  /** Deslocamento (px) do CENTRO da área recortada em relação ao centro do original; y para cima. */
  readonly trimOffsetX: number;
  readonly trimOffsetY: number;
}

interface AtlasEntry {
  readonly frames: Map<string, ResolvedAtlasFrame>;
  readonly texture: THREE.Texture | null;
}

export class TextureAtlasParser {
  private readonly atlases =
    new Map<
      string,
      AtlasEntry
    >();

  /**
   * Registra o atlas. A textura recebida (normalmente compartilhada pelo
   * cache de `game.assets`) NÃO é alterada: o atlas guarda um CLONE com
   * filtro nearest e sem mipmaps (G95), liberado em `clear`/re-parse.
   */
  public parseAtlas(
    atlasKey:
      string,
    json:
      TextureAtlasJSON,
    texture:
      THREE.Texture | null,
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

    const frameMap =
      new Map<
        string,
        ResolvedAtlasFrame
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

    this.disposeAtlasTexture(
      normalizedKey,
    );

    this.atlases.set(
      normalizedKey,
      {
        frames:
          frameMap,
        texture:
          texture ===
          null
            ? null
            : this.createOwnedPixelTexture(
                texture,
              ),
      },
    );
  }

  /** Clone próprio (nearest, sem mipmap) — nunca muta a textura do cache (G95). */
  public createOwnedPixelTexture(
    source:
      THREE.Texture,
  ): THREE.Texture {
    const owned =
      source.clone();

    owned.magFilter =
      THREE.NearestFilter;

    owned.minFilter =
      THREE.NearestFilter;

    owned.generateMipmaps =
      false;

    owned.userData[
      OWNED_TEXTURE_FLAG
    ] =
      true;

    owned.needsUpdate =
      true;

    return owned;
  }

  public getFrameUV(
    atlasKey:
      string,
    frameName:
      string,
  ): UVRect | null {
    return (
      this.getFrame(
        atlasKey,
        frameName,
      )?.uv ??
      null
    );
  }

  public getFrame(
    atlasKey:
      string,
    frameName:
      string,
  ): ResolvedAtlasFrame | null {
    return (
      this.atlases
        .get(
          atlasKey,
        )
        ?.frames
        .get(
          frameName,
        ) ??
      null
    );
  }

  /** Textura própria do atlas (clone), ou null se o atlas não tem textura. */
  public getAtlasTexture(
    atlasKey:
      string,
  ): THREE.Texture | null {
    return (
      this.atlases.get(
        atlasKey,
      )?.texture ??
      null
    );
  }

  public hasAtlas(
    atlasKey:
      string,
  ): boolean {
    return this.atlases.has(
      atlasKey,
    );
  }

  public clear(): void {
    for (
      const key of
      this.atlases.keys()
    ) {
      this.disposeAtlasTexture(
        key,
      );
    }

    this.atlases.clear();
  }

  private disposeAtlasTexture(
    atlasKey:
      string,
  ): void {
    const texture =
      this.atlases.get(
        atlasKey,
      )?.texture;

    if (
      texture !==
        undefined &&
      texture !==
        null &&
      texture.userData[
        OWNED_TEXTURE_FLAG
      ] ===
        true
    ) {
      texture.dispose();
    }
  }

  private addFrameToMap(
    map:
      Map<
        string,
        ResolvedAtlasFrame
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

    const rotated =
      data.rotated ===
      true;

    // TexturePacker: com `rotated`, frame.w/h são do sprite em pé; a
    // região ocupada no atlas é h × w (girada 90° horário).
    const regionW =
      rotated
        ? frame.h
        : frame.w;

    const regionH =
      rotated
        ? frame.w
        : frame.h;

    const uv: UVRect = {
      u:
        frame.x /
        imgW,
      v:
        1 -
        (
          frame.y +
          regionH
        ) /
          imgH,
      w:
        regionW /
        imgW,
      h:
        regionH /
        imgH,
      rotated,
    };

    let originU: number;
    let originV: number;
    let axisUx: number;
    let axisUy: number;
    let axisVx: number;
    let axisVy: number;

    if (
      rotated
    ) {
      // Pixel (x,y) do sprite → (H-1-y, x) da região: s cresce para baixo
      // na região e t cresce para a direita.
      originU =
        frame.x /
        imgW;
      originV =
        1 -
        frame.y /
          imgH;
      axisUx =
        0;
      axisUy =
        -frame.w /
        imgH;
      axisVx =
        frame.h /
        imgW;
      axisVy =
        0;
    } else {
      originU =
        uv.u;
      originV =
        uv.v;
      axisUx =
        uv.w;
      axisUy =
        0;
      axisVx =
        0;
      axisVy =
        uv.h;
    }

    const trimmed =
      data.trimmed ===
      true;

    const sourceWidth =
      trimmed &&
      data.sourceSize !==
        undefined &&
      data.sourceSize.w >
        0
        ? data.sourceSize.w
        : frame.w;

    const sourceHeight =
      trimmed &&
      data.sourceSize !==
        undefined &&
      data.sourceSize.h >
        0
        ? data.sourceSize.h
        : frame.h;

    const offsetX =
      trimmed &&
      data.spriteSourceSize !==
        undefined
        ? data.spriteSourceSize.x
        : 0;

    const offsetY =
      trimmed &&
      data.spriteSourceSize !==
        undefined
        ? data.spriteSourceSize.y
        : 0;

    map.set(
      normalizedName,
      {
        name:
          normalizedName,
        uv,
        originU,
        originV,
        axisUx,
        axisUy,
        axisVx,
        axisVy,
        rotated,
        trimmed,
        width:
          frame.w,
        height:
          frame.h,
        sourceWidth,
        sourceHeight,
        trimOffsetX:
          offsetX +
          frame.w /
            2 -
          sourceWidth /
            2,
        trimOffsetY:
          -(
            offsetY +
            frame.h /
              2 -
            sourceHeight /
              2
          ),
      },
    );
  }
}
