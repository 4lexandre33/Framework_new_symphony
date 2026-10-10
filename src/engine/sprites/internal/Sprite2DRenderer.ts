import * as THREE from "three";

import type {
  Sprite2DOptions,
  SpriteAnimationDescriptor,
} from "../../../contracts/sprites/types";

import {
  TextureAtlasParser,
  type ResolvedAtlasFrame,
} from "./TextureAtlasParser";

function finiteOr(
  value:
    number | undefined,
  fallback:
    number,
): number {
  return (
    value !==
      undefined &&
    Number.isFinite(
      value,
    )
  )
    ? value
    : fallback;
}

/** (s,t) de cada vértice da PlaneGeometry(1,1): ordem do three. */
const VERTEX_S =
  [0, 1, 0, 1] as const;

const VERTEX_T =
  [1, 1, 0, 0] as const;

export type SpriteAnimationEndedCallback = (
  spriteId: string,
  animationName: string,
) => void;

interface SpriteState {
  readonly spriteId: string;
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly atlasKey: string;
  readonly pixelsPerUnit: number | undefined;
  frameName: string;
  hasFrame: boolean;
  animation: SpriteAnimationDescriptor | null;
  frameIndex: number;
  elapsed: number;
  playing: boolean;
}

export class Sprite2DRenderer {
  private readonly activeSprites =
    new Map<
      string,
      SpriteState
    >();

  // Lista densa dos sprites animando: update sem iterador/alocação.
  private readonly animated:
    SpriteState[] =
      [];

  public constructor(
    private readonly atlasParser:
      TextureAtlasParser,
  ) {}

  public spawnSprite(
    options:
      Sprite2DOptions,
    texture:
      THREE.Texture | null,
  ): THREE.Mesh {
    const normalizedId =
      options.spriteId.trim();

    if (
      normalizedId.length ===
      0
    ) {
      throw new RangeError(
        "spriteId não pode ser vazio.",
      );
    }

    this.despawnSprite(
      normalizedId,
    );

    const ppu =
      options.pixelsPerUnit !==
        undefined &&
      Number.isFinite(
        options.pixelsPerUnit,
      ) &&
      options.pixelsPerUnit >
        0
        ? options.pixelsPerUnit
        : undefined;

    const geometry =
      new THREE.PlaneGeometry(
        1,
        1,
      );

    const material =
      new THREE.MeshBasicMaterial({
        map:
          texture,
        transparent:
          true,
        alphaTest:
          0.001,
        side:
          THREE.DoubleSide,
      });

    const mesh =
      new THREE.Mesh(
        geometry,
        material,
      );

    mesh.name =
      `sprite_${normalizedId}`;

    mesh.position.set(
      finiteOr(
        options.position.x,
        0,
      ),
      finiteOr(
        options.position.y,
        0,
      ),
      finiteOr(
        options.position.z,
        0,
      ),
    );

    mesh.scale.set(
      finiteOr(
        options.scale?.x,
        1,
      ) *
        (
          options.flipX ===
          true
            ? -1
            : 1
        ),
      finiteOr(
        options.scale?.y,
        1,
      ) *
        (
          options.flipY ===
          true
            ? -1
            : 1
        ),
      1,
    );

    mesh.rotation.z =
      finiteOr(
        options.rotation,
        0,
      );

    mesh.renderOrder =
      finiteOr(
        options.renderOrder,
        0,
      );

    const state: SpriteState = {
      spriteId:
        normalizedId,
      mesh,
      atlasKey:
        options.atlasUrl,
      pixelsPerUnit:
        ppu,
      frameName:
        options.frameName,
      hasFrame:
        false,
      animation:
        null,
      frameIndex:
        0,
      elapsed:
        0,
      playing:
        false,
    };

    this.activeSprites.set(
      normalizedId,
      state,
    );

    this.applyFrame(
      state,
      options.frameName,
    );

    return mesh;
  }

  public hasSprite(
    spriteId:
      string,
  ): boolean {
    return this.activeSprites.has(
      spriteId,
    );
  }

  public getSprite(
    spriteId:
      string,
  ): THREE.Mesh | null {
    return this.activeSprites.get(
      spriteId,
    )?.mesh ??
      null;
  }

  public getSpriteFrameName(
    spriteId:
      string,
  ): string | null {
    return this.activeSprites.get(
      spriteId,
    )?.frameName ??
      null;
  }

  /** Troca o frame (para a animação em andamento). */
  public setSpriteFrame(
    spriteId:
      string,
    frameName:
      string,
  ): boolean {
    const state =
      this.activeSprites.get(
        spriteId,
      );

    if (
      state ===
      undefined
    ) {
      return false;
    }

    this.stopAnimation(
      spriteId,
    );

    return this.applyFrame(
      state,
      frameName,
    );
  }

  public playAnimation(
    spriteId:
      string,
    animation:
      SpriteAnimationDescriptor,
  ): boolean {
    const state =
      this.activeSprites.get(
        spriteId,
      );

    if (
      state ===
      undefined
    ) {
      return false;
    }

    if (
      animation.frames.length ===
        0 ||
      !Number.isFinite(
        animation.frameRate,
      ) ||
      animation.frameRate <=
        0
    ) {
      throw new RangeError(
        "Animação precisa de frames e frameRate > 0.",
      );
    }

    state.animation =
      animation;
    state.frameIndex =
      0;
    state.elapsed =
      0;
    state.playing =
      true;

    if (
      this.animated.indexOf(
        state,
      ) <
      0
    ) {
      this.animated.push(
        state,
      );
    }

    this.applyFrame(
      state,
      animation.frames[0] as string,
    );

    return true;
  }

  public stopAnimation(
    spriteId:
      string,
  ): boolean {
    const state =
      this.activeSprites.get(
        spriteId,
      );

    if (
      state ===
        undefined ||
      state.animation ===
        null
    ) {
      return false;
    }

    state.playing =
      false;
    state.animation =
      null;

    this.removeAnimated(
      state,
    );

    return true;
  }

  public isAnimating(
    spriteId:
      string,
  ): boolean {
    return this.activeSprites.get(
      spriteId,
    )?.playing ===
      true;
  }

  /**
   * Avança as animações. `onEnded` é chamado quando uma animação sem loop
   * termina (no último frame).
   */
  public update(
    deltaSeconds:
      number,
    onEnded:
      SpriteAnimationEndedCallback | null,
  ): void {
    if (
      !Number.isFinite(
        deltaSeconds,
      ) ||
      deltaSeconds <=
        0
    ) {
      return;
    }

    for (
      let index =
        this.animated.length -
        1;
      index >=
        0;
      index -=
        1
    ) {
      const state =
        this.animated[index] as SpriteState;
      const animation =
        state.animation;

      if (
        animation ===
          null ||
        !state.playing
      ) {
        continue;
      }

      const frameDuration =
        1 /
        animation.frameRate;

      state.elapsed +=
        Math.min(
          deltaSeconds,
          0.25,
        );

      let changed =
        false;
      let ended =
        false;

      while (
        state.elapsed >=
        frameDuration
      ) {
        state.elapsed -=
          frameDuration;

        const next =
          state.frameIndex +
          1;

        if (
          next <
          animation.frames.length
        ) {
          state.frameIndex =
            next;
          changed =
            true;
          continue;
        }

        if (
          animation.loop ===
          true
        ) {
          state.frameIndex =
            0;
          changed =
            true;
          continue;
        }

        ended =
          true;
        break;
      }

      if (
        changed
      ) {
        this.applyFrame(
          state,
          animation.frames[state.frameIndex] as string,
        );
      }

      if (
        ended
      ) {
        state.playing =
          false;
        state.animation =
          null;
        this.animated.splice(
          index,
          1,
        );
        onEnded?.(
          state.spriteId,
          animation.name,
        );
      }
    }
  }

  /**
   * Reaplica textura e frame de todos os sprites do atlas (após
   * `parseAtlas` tardio).
   */
  public rebindAtlas(
    atlasKey:
      string,
    texture:
      THREE.Texture | null,
  ): void {
    for (
      const state of
      this.activeSprites.values()
    ) {
      if (
        state.atlasKey !==
        atlasKey
      ) {
        continue;
      }

      state.mesh.material.map =
        texture;
      state.mesh.material.needsUpdate =
        true;
      this.applyFrame(
        state,
        state.frameName,
      );
    }
  }

  public despawnSprite(
    spriteId:
      string,
    disposeResources =
      true,
  ): boolean {
    const state =
      this.activeSprites.get(
        spriteId,
      );

    if (
      state ===
      undefined
    ) {
      return false;
    }

    this.removeAnimated(
      state,
    );

    state.mesh.removeFromParent();

    if (
      disposeResources
    ) {
      // A textura é do atlas (compartilhada entre sprites): não descarta aqui.
      state.mesh.geometry
        .dispose();

      state.mesh.material
        .dispose();
    }

    this.activeSprites.delete(
      spriteId,
    );

    return true;
  }

  public clear(
    disposeResources =
      true,
  ): void {
    for (
      const spriteId of
      [...this.activeSprites.keys()]
    ) {
      this.despawnSprite(
        spriteId,
        disposeResources,
      );
    }
  }

  private removeAnimated(
    state:
      SpriteState,
  ): void {
    const index =
      this.animated.indexOf(
        state,
      );

    if (
      index >=
      0
    ) {
      this.animated.splice(
        index,
        1,
      );
    }
  }

  /** Escreve posição/UV dos 4 vértices para o frame (sem alocação). */
  private applyFrame(
    state:
      SpriteState,
    frameName:
      string,
  ): boolean {
    state.frameName =
      frameName;

    const frame =
      this.atlasParser
        .getFrame(
          state.atlasKey,
          frameName,
        );

    const material =
      state.mesh.material;

    if (
      frame ===
      null
    ) {
      // G94: frame inexistente não mostra o atlas inteiro.
      state.hasFrame =
        false;
      material.visible =
        false;
      return false;
    }

    state.hasFrame =
      true;
    material.visible =
      material.map !==
      null;

    this.writeQuad(
      state.mesh.geometry,
      frame,
      state.pixelsPerUnit,
    );

    return true;
  }

  private writeQuad(
    geometry:
      THREE.BufferGeometry,
    frame:
      ResolvedAtlasFrame,
    pixelsPerUnit:
      number | undefined,
  ): void {
    const unit =
      pixelsPerUnit !==
      undefined
        ? 1 /
          pixelsPerUnit
        : 1 /
          Math.max(
            1e-6,
            frame.sourceHeight,
          );

    const width =
      frame.width *
      unit;
    const height =
      frame.height *
      unit;
    const offsetX =
      frame.trimOffsetX *
      unit;
    const offsetY =
      frame.trimOffsetY *
      unit;

    const positions =
      geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;

    const uvs =
      geometry.getAttribute(
        "uv",
      ) as THREE.BufferAttribute;

    for (
      let vertex = 0;
      vertex <
      4;
      vertex += 1
    ) {
      const s =
        VERTEX_S[vertex as 0 | 1 | 2 | 3];
      const t =
        VERTEX_T[vertex as 0 | 1 | 2 | 3];

      positions.setXY(
        vertex,
        offsetX +
          (s - 0.5) *
            width,
        offsetY +
          (t - 0.5) *
            height,
      );

      uvs.setXY(
        vertex,
        frame.originU +
          s *
            frame.axisUx +
          t *
            frame.axisVx,
        frame.originV +
          s *
            frame.axisUy +
          t *
            frame.axisVy,
      );
    }

    positions.needsUpdate =
      true;
    uvs.needsUpdate =
      true;
    geometry.computeBoundingSphere();
  }
}
