import type {
  AnimationLoopMode,
  SpriteAnimationFrame,
  SpriteRegistrationOptions,
} from "../../../contracts/anim/types";

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

  clone?(): SpriteTextureLike;

  dispose?(): void;

  needsUpdate?: boolean;
}

export interface SpriteMaterialLike {
  map?:
    SpriteTextureLike | null;

  clone?(): SpriteMaterialLike;

  dispose?(): void;

  needsUpdate?: boolean;
}

interface FrameSequence {
  readonly frames:
    ReadonlyArray<SpriteAnimationFrame>;

  readonly cycleDurationMs:
    number;
}

export interface ActiveSprite2DAnimation {
  material:
    SpriteMaterialLike;

  frames:
    ReadonlyArray<SpriteAnimationFrame>;

  cycleDurationMs:
    number;

  currentFrameIndex:
    number;

  elapsedMs:
    number;

  isPlaying:
    boolean;

  /** Sequências por estado da FSM (G77). */
  readonly stateFrames:
    Map<string, FrameSequence>;

  /** true quando a FSM dirige os quadros (relógio único, G78). */
  fsmDriven:
    boolean;

  readonly defaultSequence:
    FrameSequence;

  /** Sequência aplicada por último (troca de estado reinicia o índice). */
  activeSequence:
    FrameSequence | null;

  /** Recursos clonados por esta entidade (descartados no unregister). */
  ownedTexture:
    SpriteTextureLike | null;

  ownedMaterial:
    SpriteMaterialLike | null;

  originalMaterial:
    unknown;

  target:
    { material: unknown } | null;
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
    options:
      SpriteRegistrationOptions = {},
  ): SpriteMaterialLike {
    const previous =
      this.spriteAnimations.get(
        entityId,
      );

    const preservedStates =
      previous?.stateFrames;

    this.unregister(
      entityId,
    );

    let effectiveMaterial =
      material;

    let ownedMaterial:
      SpriteMaterialLike | null = null;

    let ownedTexture:
      SpriteTextureLike | null = null;

    const target =
      options.target ??
      null;

    const materialShared =
      this.isMaterialInUse(
        material,
      );

    /*
     * Material compartilhado entre entidades: sem clonar, todas animariam
     * juntas (G77). Só dá para trocar o material se o dono (target) vier.
     */
    if (
      target !== null &&
      typeof material.clone ===
        "function" &&
      (options.cloneMaterial ===
        true ||
        materialShared)
    ) {
      ownedMaterial =
        material.clone();

      effectiveMaterial =
        ownedMaterial;

      target.material =
        ownedMaterial;
    }

    const map =
      effectiveMaterial.map;

    const cloneTexture =
      options.cloneTexture ??
      "auto";

    if (
      map &&
      typeof map.clone ===
        "function" &&
      (cloneTexture ===
        true ||
        (cloneTexture ===
          "auto" &&
          this.isTextureInUse(
            map,
          )))
    ) {
      ownedTexture =
        map.clone();

      if (
        ownedTexture
      ) {
        ownedTexture.needsUpdate =
          true;

        effectiveMaterial.map =
          ownedTexture;

        effectiveMaterial.needsUpdate =
          true;
      }
    }

    const sequence =
      buildSequence(
        frames,
      );

    const animation:
      ActiveSprite2DAnimation = {
        material:
          effectiveMaterial,

        frames:
          sequence.frames,

        cycleDurationMs:
          sequence.cycleDurationMs,

        defaultSequence:
          sequence,

        currentFrameIndex:
          0,

        elapsedMs:
          0,

        isPlaying:
          frames.length >
          0,

        stateFrames:
          preservedStates ??
          new Map(),

        fsmDriven:
          false,

        activeSequence:
          sequence,

        ownedTexture,

        ownedMaterial,

        originalMaterial:
          material,

        target,
      };

    this.spriteAnimations.set(
      entityId,
      animation,
    );

    const firstFrame =
      frames[0];

    if (firstFrame) {
      this.applyFrame(
        effectiveMaterial,
        firstFrame,
      );
    }

    return effectiveMaterial;
  }

  public has(
    entityId: string,
  ): boolean {
    return this.spriteAnimations.has(
      entityId,
    );
  }

  /**
   * Associa uma sequência de quadros a um estado da FSM (G77).
   * Retorna a duração do ciclo em segundos (0 se vazia).
   */
  public registerStateFrames(
    entityId: string,
    stateName: string,
    frames:
      ReadonlyArray<SpriteAnimationFrame>,
  ): number {
    const animation =
      this.spriteAnimations.get(
        entityId,
      );

    if (!animation) {
      return 0;
    }

    const sequence =
      buildSequence(
        frames,
      );

    animation.stateFrames.set(
      stateName,
      sequence,
    );

    animation.activeSequence =
      null;

    return sequence.cycleDurationMs /
      1000;
  }

  public getStateCycleSeconds(
    entityId: string,
    stateName: string,
  ): number | null {
    const sequence =
      this.spriteAnimations
        .get(
          entityId,
        )
        ?.stateFrames.get(
          stateName,
        );

    return sequence &&
      sequence.cycleDurationMs >
        0
      ? sequence.cycleDurationMs /
          1000
      : null;
  }

  public unregister(
    entityId: string,
  ): void {
    const animation =
      this.spriteAnimations.get(
        entityId,
      );

    if (!animation) {
      return;
    }

    this.spriteAnimations.delete(
      entityId,
    );

    if (
      animation.ownedTexture
    ) {
      animation.ownedTexture.dispose?.();
    }

    if (
      animation.ownedMaterial
    ) {
      if (
        animation.target &&
        animation.target.material ===
          animation.ownedMaterial
      ) {
        animation.target.material =
          animation.originalMaterial;
      }

      animation.ownedMaterial.dispose?.();
    }
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

  /**
   * Dirige o sprite pelo estado da FSM: quadros do estado (ou a sequência
   * padrão) escolhidos a partir do tempo do estado — mesmo relógio da FSM.
   */
  public syncToState(
    entityId: string,
    stateName: string,
    elapsedSeconds: number,
    loopMode:
      AnimationLoopMode,
  ): void {
    const animation =
      this.spriteAnimations.get(
        entityId,
      );

    if (!animation) {
      return;
    }

    animation.fsmDriven =
      true;

    if (
      !animation.isPlaying &&
      animation.frames.length >
        0
    ) {
      return;
    }

    const stateSequence =
      animation.stateFrames.get(
        stateName,
      );

    const sequence =
      stateSequence ??
      animation.defaultSequence;

    const frames =
      sequence.frames;

    const cycleMs =
      sequence.cycleDurationMs;

    if (
      frames.length ===
        0 ||
      cycleMs <= 0
    ) {
      return;
    }

    // A sequência padrão (sem quadros por estado) sempre repete.
    const mode:
      AnimationLoopMode =
        stateSequence
          ? loopMode
          : "LoopRepeat";

    let timeMs =
      Math.max(
        0,
        elapsedSeconds *
          1000,
      );

    if (
      mode ===
      "LoopOnce"
    ) {
      timeMs =
        Math.min(
          timeMs,
          cycleMs -
            1e-6,
        );
    } else if (
      mode ===
      "LoopPingPong"
    ) {
      const phase =
        timeMs %
        (2 *
          cycleMs);

      timeMs =
        phase <
        cycleMs
          ? phase
          : Math.max(
              0,
              2 *
                cycleMs -
                phase -
                1e-6,
            );
    } else {
      timeMs %=
        cycleMs;
    }

    let index =
      0;

    let accumulated =
      0;

    for (
      ;
      index <
      frames.length;
      index += 1
    ) {
      const frame =
        frames[index];

      if (!frame) {
        continue;
      }

      accumulated +=
        getFrameDuration(
          frame,
        );

      if (
        timeMs <
        accumulated
      ) {
        break;
      }
    }

    if (
      index >=
      frames.length
    ) {
      index =
        frames.length -
        1;
    }

    if (
      sequence !==
        animation.activeSequence ||
      index !==
        animation.currentFrameIndex
    ) {
      animation.activeSequence =
        sequence;

      animation.currentFrameIndex =
        index;

      const frame =
        frames[index];

      if (frame) {
        this.applyFrame(
          animation.material,
          frame,
        );
      }
    }
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
      Math.min(
        deltaSeconds,
        0.25,
      ) *
      1000;

    for (
      const animation of
      this.spriteAnimations.values()
    ) {
      if (
        animation.fsmDriven ||
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
          getFrameDuration(
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
    for (
      const entityId of
      Array.from(
        this.spriteAnimations.keys(),
      )
    ) {
      this.unregister(
        entityId,
      );
    }

    this.spriteAnimations.clear();
  }

  private isMaterialInUse(
    material: unknown,
  ): boolean {
    for (
      const animation of
      this.spriteAnimations.values()
    ) {
      if (
        animation.material ===
          material ||
        animation.originalMaterial ===
          material
      ) {
        return true;
      }
    }

    return false;
  }

  private isTextureInUse(
    map: SpriteTextureLike,
  ): boolean {
    for (
      const animation of
      this.spriteAnimations.values()
    ) {
      if (
        animation.material.map ===
        map
      ) {
        return true;
      }
    }

    return false;
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
}

function buildSequence(
  frames:
    ReadonlyArray<SpriteAnimationFrame>,
): FrameSequence {
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

    if (frame) {
      cycleDurationMs +=
        getFrameDuration(
          frame,
        );
    }
  }

  return {
    frames,
    cycleDurationMs,
  };
}

function getFrameDuration(
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
