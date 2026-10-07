import type {
  PhysicsApi,
} from "../../tokens/physics";

import type {
  PhysicsSandboxViewPort,
} from "./ports/PhysicsSandboxViewPort";

import type {
  PhysicsSandboxAudioPort,
} from "./ports/PhysicsSandboxAudioPort";

const CUBE_ID =
  "example.physics-sandbox.cube";

const FLOOR_ID =
  "example.physics-sandbox.floor";

/**
 * Lógica específica do projeto consumidor.
 *
 * Conhece somente portas públicas:
 * - PhysicsApi;
 * - PhysicsSandboxViewPort;
 * - PhysicsSandboxAudioPort.
 *
 * Não conhece Three.js, Web Audio, Rapier interno ou plugins concretos.
 */
export class PhysicsSandboxGame {
  private disposed =
    false;

  public constructor(
    private readonly physics:
      PhysicsApi,

    private readonly view:
      PhysicsSandboxViewPort,

    private readonly audio:
      PhysicsSandboxAudioPort,
  ) {
    const floorCreated =
      physics.createBody(
        FLOOR_ID,
        {
          bodyType:
            "fixed",

          position: {
            x: 0,
            y: -0.5,
            z: 0,
          },
        },
        {
          shapeType:
            "box",

          halfExtents: {
            x: 10,
            y: 0.5,
            z: 10,
          },

          friction:
            0.9,

          restitution:
            0.3,
        },
      );

    if (!floorCreated) {
      throw new Error(
        "Não foi possível criar o piso físico do exemplo.",
      );
    }

    try {
      const cubeCreated =
        physics.createBody(
          CUBE_ID,
          {
            bodyType:
              "dynamic",

            position: {
              x: 0,
              y: 5,
              z: 0,
            },

            linearDamping:
              0.05,

            angularDamping:
              0.1,

            canSleep:
              false,
          },
          {
            shapeType:
              "box",

            halfExtents: {
              x: 1,
              y: 1,
              z: 1,
            },

            friction:
              0.6,

            restitution:
              0.65,

            density:
              1,
          },
        );

      if (!cubeCreated) {
        throw new Error(
          "Não foi possível criar o cubo físico do exemplo.",
        );
      }
    } catch (
      error:
        unknown
    ) {
      physics.removeBody(
        FLOOR_ID,
      );

      throw error;
    }

    this.syncVisual();
  }

  /**
   * Sincroniza somente apresentação.
   *
   * A simulação Rapier já é executada pelo plugin de física
   * no fixed tick da engine.
   */
  public syncVisual(): void {
    if (
      this.disposed
    ) {
      return;
    }

    const transform =
      this.physics
        .getBodyTransform(
          CUBE_ID,
        );

    if (
      transform ===
      null
    ) {
      return;
    }

    this.view
      .setCubeTransform(
        transform.position,
        transform.rotation,
      );
  }

  /**
   * Ação semântica do projeto.
   *
   * Input concreto fica fora daqui.
   */
  public jump(): boolean {
    if (
      this.disposed
    ) {
      return false;
    }

    const applied =
      this.physics
        .applyImpulse(
          CUBE_ID,
          {
            x: 0,
            y: 32,
            z: 0,
          },
        );

    if (
      applied
    ) {
      this.audio
        .playJump();
    }

    return applied;
  }

  /**
   * Traduz o evento genérico da física para uma intenção
   * específica deste jogo: impacto cubo <-> piso.
   */
  public handleCollisionEnter(
    entityIdA:
      string,

    entityIdB:
      string,
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    const cubeHitFloor =
      (
        entityIdA ===
          CUBE_ID &&
        entityIdB ===
          FLOOR_ID
      ) ||
      (
        entityIdA ===
          FLOOR_ID &&
        entityIdB ===
          CUBE_ID
      );

    if (
      cubeHitFloor
    ) {
      this.audio
        .playImpact();
    }
  }

  public dispose(): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.disposed =
      true;

    this.physics
      .removeBody(
        CUBE_ID,
      );

    this.physics
      .removeBody(
        FLOOR_ID,
      );

    this.audio
      .dispose();

    this.view
      .dispose();
  }
}
