import * as THREE from "three";

import type {
  GPUParticleEmitterConfig,
} from "../../../contracts/vfx/types";

const VERTEX_SHADER_GLSL = `
  attribute vec3 aVelocity;
  attribute float aStartTime;
  attribute float aLifeTime;
  attribute vec4 aStartColor;
  attribute vec4 aEndColor;
  attribute float aStartSize;
  attribute float aEndSize;

  uniform float uTime;
  uniform float uGravity;

  varying vec4 vColor;

  void main() {
    float age = uTime - aStartTime;

    if (age < 0.0 || age > aLifeTime) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vColor = vec4(0.0);
      return;
    }

    float normalizedAge = clamp(
      age / max(aLifeTime, 0.0001),
      0.0,
      1.0
    );

    vColor = mix(
      aStartColor,
      aEndColor,
      normalizedAge
    );

    vec3 currentPos =
      position +
      (aVelocity * age);

    currentPos.y -=
      0.5 *
      uGravity *
      age *
      age;

    float currentSize = mix(
      aStartSize,
      aEndSize,
      normalizedAge
    );

    vec4 mvPosition =
      modelViewMatrix *
      vec4(
        currentPos,
        1.0
      );

    gl_Position =
      projectionMatrix *
      mvPosition;

    float perspectiveScale =
      300.0 /
      max(
        -mvPosition.z,
        0.0001
      );

    gl_PointSize =
      max(
        0.0,
        currentSize *
        perspectiveScale
      );
  }
`;

const FRAGMENT_SHADER_GLSL = `
  uniform sampler2D uTexture;
  uniform bool uHasTexture;

  varying vec4 vColor;

  void main() {
    if (vColor.a <= 0.01) {
      discard;
    }

    vec4 texColor =
      vec4(1.0);

    if (uHasTexture) {
      texColor =
        texture2D(
          uTexture,
          gl_PointCoord
        );
    } else {
      vec2 coord =
        gl_PointCoord -
        vec2(0.5);

      float distSq =
        dot(
          coord,
          coord
        );

      if (distSq > 0.25) {
        discard;
      }

      texColor.a =
        smoothstep(
          0.25,
          0.0,
          distSq
        );
    }

    gl_FragColor =
      vColor *
      texColor;
  }
`;

export class GPUParticleEmitter {
  private readonly geometry:
    THREE.InstancedBufferGeometry;

  private readonly material:
    THREE.RawShaderMaterial;

  private readonly pointsMesh:
    THREE.Points;

  private readonly velocities:
    Float32Array;

  private readonly startTimes:
    Float32Array;

  private readonly lifeTimes:
    Float32Array;

  private readonly startColors:
    Float32Array;

  private readonly endColors:
    Float32Array;

  private readonly startSizes:
    Float32Array;

  private readonly endSizes:
    Float32Array;

  private readonly startTimeAttribute:
    THREE.InstancedBufferAttribute;

  private elapsedTime =
    0;

  private nextParticleIndex =
    0;

  private spawnAccumulator =
    0;

  public constructor(
    public readonly config:
      GPUParticleEmitterConfig,

    texture?:
      THREE.Texture | null,
  ) {
    const particleCount =
      Math.max(
        1,
        Math.floor(
          Number.isFinite(
            config.maxParticles,
          )
            ? config.maxParticles
            : 1,
        ),
      );

    this.geometry =
      new THREE.InstancedBufferGeometry();

    const basePosition =
      new Float32Array([
        config.position.x,
        config.position.y,
        config.position.z,
      ]);

    this.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(
        basePosition,
        3,
      ),
    );

    this.velocities =
      new Float32Array(
        particleCount *
        3,
      );

    this.startTimes =
      new Float32Array(
        particleCount,
      );

    this.lifeTimes =
      new Float32Array(
        particleCount,
      );

    this.startColors =
      new Float32Array(
        particleCount *
        4,
      );

    this.endColors =
      new Float32Array(
        particleCount *
        4,
      );

    this.startSizes =
      new Float32Array(
        particleCount,
      );

    this.endSizes =
      new Float32Array(
        particleCount,
      );

    const particleLifetime =
      Math.max(
        0.0001,
        Number.isFinite(
          config
            .particleLifetimeSeconds,
        )
          ? config
              .particleLifetimeSeconds
          : 1,
      );

    for (
      let index = 0;
      index <
      particleCount;
      index += 1
    ) {
      this.startTimes[index] =
        -9999;

      this.lifeTimes[index] =
        particleLifetime;

      const velocityOffset =
        index *
        3;

      this.velocities[
        velocityOffset
      ] =
        config.velocityBase.x +
        (
          Math.random() -
          0.5
        ) *
        config
          .velocityVariance
          .x;

      this.velocities[
        velocityOffset +
        1
      ] =
        config.velocityBase.y +
        (
          Math.random() -
          0.5
        ) *
        config
          .velocityVariance
          .y;

      this.velocities[
        velocityOffset +
        2
      ] =
        config.velocityBase.z +
        (
          Math.random() -
          0.5
        ) *
        config
          .velocityVariance
          .z;

      const colorOffset =
        index *
        4;

      this.startColors[
        colorOffset
      ] =
        config.startColor.r;

      this.startColors[
        colorOffset +
        1
      ] =
        config.startColor.g;

      this.startColors[
        colorOffset +
        2
      ] =
        config.startColor.b;

      this.startColors[
        colorOffset +
        3
      ] =
        config.startColor.a ??
        1;

      this.endColors[
        colorOffset
      ] =
        config.endColor.r;

      this.endColors[
        colorOffset +
        1
      ] =
        config.endColor.g;

      this.endColors[
        colorOffset +
        2
      ] =
        config.endColor.b;

      this.endColors[
        colorOffset +
        3
      ] =
        config.endColor.a ??
        0;

      this.startSizes[
        index
      ] =
        config.startSize;

      this.endSizes[
        index
      ] =
        config.endSize;
    }

    this.geometry.setAttribute(
      "aVelocity",
      new THREE.InstancedBufferAttribute(
        this.velocities,
        3,
      ),
    );

    this.startTimeAttribute =
      new THREE.InstancedBufferAttribute(
        this.startTimes,
        1,
      );

    this.geometry.setAttribute(
      "aStartTime",
      this.startTimeAttribute,
    );

    this.geometry.setAttribute(
      "aLifeTime",
      new THREE.InstancedBufferAttribute(
        this.lifeTimes,
        1,
      ),
    );

    this.geometry.setAttribute(
      "aStartColor",
      new THREE.InstancedBufferAttribute(
        this.startColors,
        4,
      ),
    );

    this.geometry.setAttribute(
      "aEndColor",
      new THREE.InstancedBufferAttribute(
        this.endColors,
        4,
      ),
    );

    this.geometry.setAttribute(
      "aStartSize",
      new THREE.InstancedBufferAttribute(
        this.startSizes,
        1,
      ),
    );

    this.geometry.setAttribute(
      "aEndSize",
      new THREE.InstancedBufferAttribute(
        this.endSizes,
        1,
      ),
    );

    this.material =
      new THREE.RawShaderMaterial({
        vertexShader:
          VERTEX_SHADER_GLSL,

        fragmentShader:
          FRAGMENT_SHADER_GLSL,

        uniforms: {
          uTime: {
            value:
              0,
          },

          uGravity: {
            value:
              config.gravityScale ??
              9.81,
          },

          uTexture: {
            value:
              texture ??
              null,
          },

          uHasTexture: {
            value:
              texture !==
              null &&
              texture !==
              undefined,
          },
        },

        transparent:
          true,

        depthWrite:
          false,

        blending:
          config.blendingMode ===
          "additive"
            ? THREE.AdditiveBlending
            : THREE.NormalBlending,
      });

    this.pointsMesh =
      new THREE.Points(
        this.geometry,
        this.material,
      );

    /*
     * O shader movimenta partículas na GPU.
     * A bounding sphere do BufferGeometry não
     * acompanha essas posições dinamicamente.
     */
    this.pointsMesh.frustumCulled =
      false;
  }

  public get mesh():
    THREE.Points {
    return this.pointsMesh;
  }

  public update(
    deltaSeconds: number,
  ): void {
    const safeDelta =
      this.sanitizeDelta(
        deltaSeconds,
      );

    if (
      safeDelta <=
      0
    ) {
      return;
    }

    this.elapsedTime +=
      safeDelta;

    this.material
      .uniforms
      .uTime
      .value =
        this.elapsedTime;

    const spawnRate =
      Math.max(
        0,
        Number.isFinite(
          this.config
            .spawnRatePerSecond,
        )
          ? this.config
              .spawnRatePerSecond
          : 0,
      );

    this.spawnAccumulator +=
      spawnRate *
      safeDelta;

    let particlesToSpawn =
      Math.floor(
        this.spawnAccumulator,
      );

    if (
      particlesToSpawn <=
      0
    ) {
      return;
    }

    this.spawnAccumulator -=
      particlesToSpawn;

    const particleCapacity =
      this.startTimes.length;

    /*
     * Um stall muito grande não precisa escrever
     * centenas de ciclos no mesmo buffer.
     *
     * No máximo todos os slots são reiniciados.
     */
    particlesToSpawn =
      Math.min(
        particlesToSpawn,
        particleCapacity,
      );

    for (
      let index = 0;
      index <
      particlesToSpawn;
      index += 1
    ) {
      this.startTimes[
        this.nextParticleIndex
      ] =
        this.elapsedTime;

      this.nextParticleIndex =
        (
          this.nextParticleIndex +
          1
        ) %
        particleCapacity;
    }

    this.startTimeAttribute
      .needsUpdate =
        true;
  }

  public dispose(): void {
    const texture =
      this.material
        .uniforms
        .uTexture
        .value;

    this.geometry.dispose();

    this.material.dispose();

    if (
      texture instanceof
        THREE.Texture &&
      texture.userData
        .presentationOwned ===
        true
    ) {
      texture.dispose();
    }
  }

  private sanitizeDelta(
    deltaSeconds: number,
  ): number {
    if (
      !Number.isFinite(
        deltaSeconds,
      ) ||
      deltaSeconds <=
        0
    ) {
      return 0;
    }

    /*
     * Evita explosões de partículas após
     * breakpoint, alt-tab longo ou stall.
     */
    return Math.min(
      deltaSeconds,
      0.25,
    );
  }
}

export class GPUParticleSystem {
  private readonly emitters =
    new Map<
      string,
      GPUParticleEmitter
    >();

  public spawnEmitter(
    config:
      GPUParticleEmitterConfig,

    texture?:
      THREE.Texture | null,
  ): THREE.Points {
    this.stopEmitter(
      config.emitterId,
    );

    const emitter =
      new GPUParticleEmitter(
        config,
        texture,
      );

    this.emitters.set(
      config.emitterId,
      emitter,
    );

    return emitter.mesh;
  }

  public stopEmitter(
    emitterId: string,
    disposeResources =
      true,
  ): boolean {
    const emitter =
      this.emitters.get(
        emitterId,
      );

    if (!emitter) {
      return false;
    }

    if (
      disposeResources
    ) {
      emitter.dispose();
    }

    this.emitters.delete(
      emitterId,
    );

    return true;
  }

  public update(
    deltaSeconds: number,
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
      const emitter of
      this.emitters.values()
    ) {
      emitter.update(
        deltaSeconds,
      );
    }
  }

  public getTotalActiveParticles():
    number {
    let total =
      0;

    for (
      const emitter of
      this.emitters.values()
    ) {
      total +=
        Math.max(
          1,
          Math.floor(
            emitter.config
              .maxParticles,
          ),
        );
    }

    return total;
  }

  public clear(
    disposeResources =
      true,
  ): void {
    if (
      disposeResources
    ) {
      for (
        const emitter of
        this.emitters.values()
      ) {
        emitter.dispose();
      }
    }

    this.emitters.clear();
  }
}