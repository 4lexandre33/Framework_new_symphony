import * as THREE from "three";

import type {
  GPUParticleEmitterConfig,
} from "../../../contracts/vfx/types";

/** Aceleração da gravidade (m/s²) multiplicada por `gravityScale` (G91). */
export const VFX_STANDARD_GRAVITY =
  9.81;

/**
 * Vertex shader das partículas (G88).
 *
 * Usado com `THREE.ShaderMaterial`, que injeta `position`,
 * `modelViewMatrix` e `projectionMatrix` (o `RawShaderMaterial` antigo usava
 * esses nomes sem declarar e não compilava no navegador).
 *
 * `position` é a posição de NASCIMENTO da partícula em espaço de mundo (o
 * objeto Points fica na identidade), por isso o emissor pode se mover sem
 * arrastar partículas já emitidas (G19).
 */
export const PARTICLE_VERTEX_SHADER = `
  attribute vec3 aVelocity;
  attribute float aStartTime;

  uniform float uTime;
  uniform float uLifeTime;
  uniform float uGravity;
  uniform float uStartSize;
  uniform float uEndSize;
  uniform vec4 uStartColor;
  uniform vec4 uEndColor;
  uniform float uPointScale;

  varying vec4 vColor;

  void main() {
    float age = uTime - aStartTime;

    if (age < 0.0 || age > uLifeTime) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vColor = vec4(0.0);
      return;
    }

    float normalizedAge = clamp(age / max(uLifeTime, 0.0001), 0.0, 1.0);

    vColor = mix(uStartColor, uEndColor, normalizedAge);

    vec3 currentPos = position + aVelocity * age;
    currentPos.y -= 0.5 * uGravity * age * age;

    float currentSize = mix(uStartSize, uEndSize, normalizedAge);

    vec4 mvPosition = modelViewMatrix * vec4(currentPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // Tamanho em unidades de mundo: perspectiva divide pela profundidade.
    bool isPerspective = projectionMatrix[2][3] == -1.0;
    float projected = isPerspective
      ? uPointScale / max(-mvPosition.z, 0.0001)
      : uPointScale;

    gl_PointSize = max(0.0, currentSize * projected);
  }
`;

export const PARTICLE_FRAGMENT_SHADER = `
  uniform sampler2D uTexture;
  uniform bool uHasTexture;

  varying vec4 vColor;

  void main() {
    if (vColor.a <= 0.01) {
      discard;
    }

    vec4 texColor = vec4(1.0);

    if (uHasTexture) {
      texColor = texture2D(uTexture, gl_PointCoord);
    } else {
      vec2 coord = gl_PointCoord - vec2(0.5);
      float distSq = dot(coord, coord);

      if (distSq > 0.25) {
        discard;
      }

      texColor.a = smoothstep(0.25, 0.0, distSq);
    }

    gl_FragColor = vColor * texColor;
  }
`;

const DEAD_START_TIME =
  -1e9;

function finiteOr(
  value:
    number | undefined,
  fallback:
    number,
): number {
  return value !==
    undefined &&
    Number.isFinite(
      value,
    )
    ? value
    : fallback;
}

export type ParticleRandom =
  () => number;

export class GPUParticleEmitter {
  private readonly geometry:
    THREE.BufferGeometry;

  private readonly material:
    THREE.ShaderMaterial;

  private readonly pointsMesh:
    THREE.Points;

  private readonly spawnPositions:
    Float32Array;

  private readonly velocities:
    Float32Array;

  private readonly startTimes:
    Float32Array;

  private readonly positionAttribute:
    THREE.BufferAttribute;

  private readonly velocityAttribute:
    THREE.BufferAttribute;

  private readonly startTimeAttribute:
    THREE.BufferAttribute;

  private readonly dirtyAttributes:
    readonly THREE.BufferAttribute[];

  private readonly emitterPosition =
    new THREE.Vector3();

  private readonly drawingBufferSize =
    new THREE.Vector2();

  private readonly lifetime:
    number;

  private readonly duration:
    number;

  private elapsedTime =
    0;

  private nextParticleIndex =
    0;

  private spawnAccumulator =
    0;

  private pendingBurst:
    number;

  private emitting =
    true;

  private lastSpawnTime =
    DEAD_START_TIME;

  private disposed =
    false;

  public constructor(
    public readonly config:
      GPUParticleEmitterConfig,

    texture?:
      THREE.Texture | null,

    private readonly random:
      ParticleRandom =
      Math.random,
  ) {
    const particleCount =
      Math.max(
        1,
        Math.floor(
          finiteOr(
            config.maxParticles,
            1,
          ),
        ),
      );

    this.lifetime =
      Math.max(
        0.0001,
        finiteOr(
          config.particleLifetimeSeconds,
          1,
        ),
      );

    this.duration =
      config.durationSeconds !==
        undefined &&
      Number.isFinite(
        config.durationSeconds,
      ) &&
      config.durationSeconds >
        0
        ? config.durationSeconds
        : Number.POSITIVE_INFINITY;

    this.pendingBurst =
      Math.max(
        0,
        Math.floor(
          finiteOr(
            config.burstCount,
            0,
          ),
        ),
      );

    this.emitterPosition.set(
      finiteOr(
        config.position.x,
        0,
      ),
      finiteOr(
        config.position.y,
        0,
      ),
      finiteOr(
        config.position.z,
        0,
      ),
    );

    this.spawnPositions =
      new Float32Array(
        particleCount *
        3,
      );

    this.velocities =
      new Float32Array(
        particleCount *
        3,
      );

    this.startTimes =
      new Float32Array(
        particleCount,
      ).fill(
        DEAD_START_TIME,
      );

    this.geometry =
      new THREE.BufferGeometry();

    this.positionAttribute =
      new THREE.BufferAttribute(
        this.spawnPositions,
        3,
      ).setUsage(
        THREE.DynamicDrawUsage,
      );

    this.velocityAttribute =
      new THREE.BufferAttribute(
        this.velocities,
        3,
      ).setUsage(
        THREE.DynamicDrawUsage,
      );

    this.startTimeAttribute =
      new THREE.BufferAttribute(
        this.startTimes,
        1,
      ).setUsage(
        THREE.DynamicDrawUsage,
      );

    this.geometry.setAttribute(
      "position",
      this.positionAttribute,
    );

    this.geometry.setAttribute(
      "aVelocity",
      this.velocityAttribute,
    );

    this.geometry.setAttribute(
      "aStartTime",
      this.startTimeAttribute,
    );

    this.dirtyAttributes = [
      this.positionAttribute,
      this.velocityAttribute,
      this.startTimeAttribute,
    ];

    const hasTexture =
      texture !==
        null &&
      texture !==
        undefined;

    this.material =
      new THREE.ShaderMaterial({
        vertexShader:
          PARTICLE_VERTEX_SHADER,

        fragmentShader:
          PARTICLE_FRAGMENT_SHADER,

        uniforms: {
          uTime: {
            value:
              0,
          },

          uLifeTime: {
            value:
              this.lifetime,
          },

          // G91: escala da gravidade padrão (1 = 9,81 m/s²).
          uGravity: {
            value:
              VFX_STANDARD_GRAVITY *
              finiteOr(
                config.gravityScale,
                1,
              ),
          },

          uStartSize: {
            value:
              finiteOr(
                config.startSize,
                1,
              ),
          },

          uEndSize: {
            value:
              finiteOr(
                config.endSize,
                0,
              ),
          },

          uStartColor: {
            value:
              new THREE.Vector4(
                config.startColor.r,
                config.startColor.g,
                config.startColor.b,
                config.startColor.a ??
                  1,
              ),
          },

          uEndColor: {
            value:
              new THREE.Vector4(
                config.endColor.r,
                config.endColor.g,
                config.endColor.b,
                config.endColor.a ??
                  0,
              ),
          },

          uPointScale: {
            value:
              300,
          },

          uTexture: {
            value:
              texture ??
              null,
          },

          uHasTexture: {
            value:
              hasTexture,
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
     * O shader movimenta partículas na GPU; a bounding sphere não
     * acompanha essas posições.
     */
    this.pointsMesh.frustumCulled =
      false;

    this.pointsMesh.name =
      `vfx_emitter_${config.emitterId}`;

    // Escala de tamanho por câmera/viewport, calculada antes de cada desenho.
    this.pointsMesh.onBeforeRender =
      this.handleBeforeRender;
  }

  public get mesh():
    THREE.Points {
    return this.pointsMesh;
  }

  public get isEmitting():
    boolean {
    return this.emitting;
  }

  /** Tempo de simulação acumulado do emissor (segundos). */
  public get age():
    number {
    return this.elapsedTime;
  }

  /**
   * true quando o emissor parou de emitir e a última partícula morreu
   * (pode ser descartado).
   */
  public get isFinished():
    boolean {
    return (
      !this.emitting &&
      this.pendingBurst ===
        0 &&
      this.elapsedTime -
        this.lastSpawnTime >
        this.lifetime
    );
  }

  public get texture():
    THREE.Texture | null {
    const value =
      this.material
        .uniforms
        .uTexture
        ?.value as unknown;

    return value instanceof
      THREE.Texture
      ? value
      : null;
  }

  /** Troca a textura (ex.: carregada depois). Não descarta a anterior. */
  public setTexture(
    texture:
      THREE.Texture | null,
  ): void {
    const uniforms =
      this.material.uniforms;

    if (
      uniforms.uTexture !==
        undefined &&
      uniforms.uHasTexture !==
        undefined
    ) {
      uniforms.uTexture.value =
        texture;
      uniforms.uHasTexture.value =
        texture !==
        null;
    }
  }

  /** Move o ponto de nascimento das PRÓXIMAS partículas (G19). */
  public setPosition(
    x: number,
    y: number,
    z: number,
  ): void {
    if (
      !Number.isFinite(
        x,
      ) ||
      !Number.isFinite(
        y,
      ) ||
      !Number.isFinite(
        z,
      )
    ) {
      return;
    }

    this.emitterPosition.set(
      x,
      y,
      z,
    );
  }

  public getPosition():
    Readonly<THREE.Vector3> {
    return this.emitterPosition;
  }

  /** Para de emitir; partículas vivas terminam a vida. */
  public stopEmitting(): void {
    this.emitting =
      false;
    this.pendingBurst =
      0;
  }

  /** Emite `count` partículas no próximo update. */
  public burst(
    count: number,
  ): void {
    if (
      Number.isFinite(
        count,
      ) &&
      count >
        0
    ) {
      this.pendingBurst +=
        Math.floor(
          count,
        );
    }
  }

  /** Partículas vivas agora (contagem em CPU, O(maxParticles)). */
  public getLiveParticleCount():
    number {
    let live =
      0;

    for (
      let index = 0;
      index <
      this.startTimes.length;
      index += 1
    ) {
      const age =
        this.elapsedTime -
        (this.startTimes[index] ?? DEAD_START_TIME);

      if (
        age >=
          0 &&
        age <=
          this.lifetime
      ) {
        live +=
          1;
      }
    }

    return live;
  }

  public update(
    deltaSeconds: number,
  ): void {
    const safeDelta =
      this.sanitizeDelta(
        deltaSeconds,
      );

    // Pausado (delta 0): partículas congelam (G28/pausa).
    if (
      safeDelta <=
        0 ||
      this.disposed
    ) {
      return;
    }

    this.elapsedTime +=
      safeDelta;

    const uniforms =
      this.material.uniforms;

    if (
      uniforms.uTime !==
      undefined
    ) {
      uniforms.uTime.value =
        this.elapsedTime;
    }

    if (
      this.emitting &&
      this.elapsedTime >=
        this.duration
    ) {
      // G28: duração esgotada.
      this.emitting =
        false;
    }

    let particlesToSpawn =
      this.pendingBurst;

    this.pendingBurst =
      0;

    if (
      this.emitting
    ) {
      const spawnRate =
        Math.max(
          0,
          finiteOr(
            this.config
              .spawnRatePerSecond,
            0,
          ),
        );

      this.spawnAccumulator +=
        spawnRate *
        safeDelta;

      const continuous =
        Math.floor(
          this.spawnAccumulator,
        );

      this.spawnAccumulator -=
        continuous;

      particlesToSpawn +=
        continuous;
    }

    if (
      particlesToSpawn <=
      0
    ) {
      return;
    }

    const particleCapacity =
      this.startTimes.length;

    /*
     * Um stall muito grande não precisa escrever centenas de ciclos no
     * mesmo buffer: no máximo todos os slots são reiniciados.
     */
    particlesToSpawn =
      Math.min(
        particlesToSpawn,
        particleCapacity,
      );

    const firstIndex =
      this.nextParticleIndex;

    for (
      let index = 0;
      index <
      particlesToSpawn;
      index += 1
    ) {
      this.spawnParticle(
        this.nextParticleIndex,
      );

      this.nextParticleIndex =
        (
          this.nextParticleIndex +
          1
        ) %
        particleCapacity;
    }

    this.lastSpawnTime =
      this.elapsedTime;

    this.markRangeDirty(
      firstIndex,
      particlesToSpawn,
      particleCapacity,
    );
  }

  public dispose(): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.disposed =
      true;

    const texture =
      this.texture;

    this.pointsMesh.onBeforeRender =
      NOOP_BEFORE_RENDER;

    this.pointsMesh.removeFromParent();

    this.geometry.dispose();

    this.material.dispose();

    if (
      texture !==
        null &&
      texture.userData
        .presentationOwned ===
        true
    ) {
      texture.dispose();
    }
  }

  private spawnParticle(
    slot: number,
  ): void {
    const offset =
      slot *
      3;

    const variance =
      this.config
        .velocityVariance;

    const base =
      this.config
        .velocityBase;

    this.spawnPositions[offset] =
      this.emitterPosition.x;
    this.spawnPositions[offset + 1] =
      this.emitterPosition.y;
    this.spawnPositions[offset + 2] =
      this.emitterPosition.z;

    this.velocities[offset] =
      base.x +
      (this.random() - 0.5) *
        variance.x;
    this.velocities[offset + 1] =
      base.y +
      (this.random() - 0.5) *
        variance.y;
    this.velocities[offset + 2] =
      base.z +
      (this.random() - 0.5) *
        variance.z;

    this.startTimes[slot] =
      this.elapsedTime;
  }

  private markRangeDirty(
    firstIndex: number,
    count: number,
    capacity: number,
  ): void {
    const attributes =
      this.dirtyAttributes;

    for (
      let attributeIndex = 0;
      attributeIndex <
      attributes.length;
      attributeIndex += 1
    ) {
      const attribute =
        attributes[attributeIndex] as THREE.BufferAttribute;

      const itemSize =
        attribute.itemSize;

      attribute.clearUpdateRanges();

      const firstRun =
        Math.min(
          count,
          capacity -
            firstIndex,
        );

      attribute.addUpdateRange(
        firstIndex *
          itemSize,
        firstRun *
          itemSize,
      );

      if (
        count >
        firstRun
      ) {
        attribute.addUpdateRange(
          0,
          (count - firstRun) *
            itemSize,
        );
      }

      attribute.needsUpdate =
        true;
    }
  }

  private readonly handleBeforeRender =
    (
      renderer:
        THREE.WebGLRenderer,
      _scene:
        THREE.Scene,
      camera:
        THREE.Camera,
    ): void => {
      const uniform =
        this.material
          .uniforms
          .uPointScale;

      if (
        uniform ===
        undefined
      ) {
        return;
      }

      renderer.getDrawingBufferSize(
        this.drawingBufferSize,
      );

      // projectionMatrix[1][1] = 1/tan(fov/2) (perspectiva) ou 2/(top-bottom) (orto):
      // pixels por unidade de mundo = altura/2 * esse termo.
      uniform.value =
        this.drawingBufferSize.y *
        0.5 *
        camera.projectionMatrix
          .elements[5]!;
    };

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
     * Evita explosões de partículas após breakpoint, alt-tab longo ou stall.
     */
    return Math.min(
      deltaSeconds,
      0.25,
    );
  }
}

const NOOP_BEFORE_RENDER =
  (): void => {};

export class GPUParticleSystem {
  private readonly emitters =
    new Map<
      string,
      GPUParticleEmitter
    >();

  public constructor(
    private readonly random:
      ParticleRandom =
      Math.random,
  ) {}

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
        this.random,
      );

    this.emitters.set(
      config.emitterId,
      emitter,
    );

    return emitter.mesh;
  }

  public getEmitter(
    emitterId: string,
  ): GPUParticleEmitter | null {
    return (
      this.emitters.get(
        emitterId,
      ) ??
      null
    );
  }

  public hasEmitter(
    emitterId: string,
  ): boolean {
    return this.emitters.has(
      emitterId,
    );
  }

  /**
   * Remove o emissor. `disposeResources` (padrão) libera geometria,
   * material e textura própria (G89); false só esquece a referência.
   */
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

  /**
   * Coleta ids dos emissores terminados em `out` (reutilizado pelo
   * chamador; sem alocação).
   */
  public collectFinished(
    out: string[],
  ): number {
    out.length =
      0;

    for (
      const [
        emitterId,
        emitter,
      ] of
      this.emitters
    ) {
      if (
        emitter.isFinished
      ) {
        out.push(
          emitterId,
        );
      }
    }

    return out.length;
  }

  /** Capacidade (slots) somada de todos os emissores. */
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

  public getEmitterCount():
    number {
    return this.emitters.size;
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
