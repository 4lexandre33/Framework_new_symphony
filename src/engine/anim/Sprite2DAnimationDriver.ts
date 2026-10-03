import type {
  SpriteAnimationFrame,
} from "../../contracts/anim/types";

export interface SpriteTextureVectorLike {
  x: number;
  y: number;

  set(
    x: number,
    y: number,
  ): void;
}

export interface SpriteTextureLike {
  offset:
    SpriteTextureVectorLike;

  repeat:
    SpriteTextureVectorLike;
}

export interface SpriteMaterialLike {
  map?:
    SpriteTextureLike | null;
}

export interface ActiveSprite2DAnimation {
  readonly material:
    SpriteMaterialLike;

  readonly frames:
    ReadonlyArray<SpriteAnimationFrame>;

  readonly cycleDurationMs:
    number;

  currentFrameIndex:
    number;

  elapsedMs:
    number;

  isPlaying:
    boolean;
}

export class Sprite2DAnimationDriver {
  private readonly spriteAnimations =
    new Map<
      string,
      ActiveSprite2DAnimation
    >();

  public register(
    entityId: string,
    material:
      SpriteMaterialLike,
    frames:
      ReadonlyArray<SpriteAnimationFrame>,
  ): void {
    this.unregister(
      entityId,
    );

    let cycleDurationMs =
      0;

    for (
      let index = 0;
      index <
      frames.length;
      index += 1
    ) {
      const frame =
        frames[index];

      if (!frame) {
        continue;
      }

      cycleDurationMs +=
        this.getFrameDuration(
          frame,
        );
    }

    const animation:
      ActiveSprite2DAnimation = {
        material,
        frames,

        cycleDurationMs,

        currentFrameIndex:
          0,

        elapsedMs:
          0,

        isPlaying:
          frames.length >
          0,
      };

    this.spriteAnimations.set(
      entityId,
      animation,
    );

    const firstFrame =
      frames[0];

    if (firstFrame) {
      this.applyFrame(
        material,
        firstFrame,
      );
    }
  }

  public unregister(
    entityId: string,
  ): void {
    this.spriteAnimations.delete(
      entityId,
    );
  }

  public pause(
    entityId: string,
  ): boolean {
    const animation =
      this.spriteAnimations.get(
        entityId,
      );

    if (!animation) {
      return false;
    }

    animation.isPlaying =
      false;

    return true;
  }

  public resume(
    entityId: string,
  ): boolean {
    const animation =
      this.spriteAnimations.get(
        entityId,
      );

    if (
      !animation ||
      animation.frames.length ===
        0
    ) {
      return false;
    }

    animation.isPlaying =
      true;

    return true;
  }

  public getCurrentFrameIndex(
    entityId: string,
  ): number | null {
    return (
      this.spriteAnimations.get(
        entityId,
      )?.currentFrameIndex ??
      null
    );
  }

  public update(
    deltaSeconds: number,
  ): void {
    if (
      !Number.isFinite(
        deltaSeconds,
      ) ||
      deltaSeconds <= 0
    ) {
      return;
    }

    const deltaMs =
      deltaSeconds *
      1000;

    for (
      const animation of
      this.spriteAnimations.values()
    ) {
      if (
        !animation.isPlaying ||
        animation.frames.length ===
          0
      ) {
        continue;
      }

      animation.elapsedMs +=
        deltaMs;

      /*
       * Elimina ciclos inteiros acumulados.
       *
       * Isso impede que um frame muito longo
       * gere centenas de iterações no while.
       */
      if (
        animation.cycleDurationMs >
          0 &&
        animation.elapsedMs >=
          animation.cycleDurationMs
      ) {
        animation.elapsedMs %=
          animation.cycleDurationMs;
      }

      let processedFrames =
        0;

      while (
        processedFrames <
        animation.frames.length
      ) {
        const currentFrame =
          animation.frames[
            animation.currentFrameIndex
          ];

        if (!currentFrame) {
          break;
        }

        const durationMs =
          this.getFrameDuration(
            currentFrame,
          );

        if (
          animation.elapsedMs <
          durationMs
        ) {
          break;
        }

        animation.elapsedMs -=
          durationMs;

        animation.currentFrameIndex =
          (
            animation.currentFrameIndex +
            1
          ) %
          animation.frames.length;

        const nextFrame =
          animation.frames[
            animation.currentFrameIndex
          ];

        if (nextFrame) {
          this.applyFrame(
            animation.material,
            nextFrame,
          );
        }

        processedFrames +=
          1;
      }
    }
  }

  public dispose(): void {
    this.spriteAnimations.clear();
  }

  private applyFrame(
    material:
      SpriteMaterialLike,
    frame:
      SpriteAnimationFrame,
  ): void {
    const map =
      material.map;

    if (!map) {
      return;
    }

    map.offset.set(
      frame.uvOffset.x,
      frame.uvOffset.y,
    );

    map.repeat.set(
      frame.uvScale.x,
      frame.uvScale.y,
    );
  }

  private getFrameDuration(
    frame:
      SpriteAnimationFrame,
  ): number {
    if (
      !Number.isFinite(
        frame.durationMs,
      ) ||
      frame.durationMs <=
        0
    ) {
      return 1;
    }

    return frame.durationMs;
  }
}