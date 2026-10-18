import type { MutableBodyTransformDTO } from "../../contracts/physics/types";
import type { PhysicsApi } from "../../tokens/physics";
import type { __PASCAL__ViewPort } from "./ports/__PASCAL__ViewPort";

export const FLOOR_BODY_ID = "__ID__.floor";
export const BOX_BODY_ID = "__ID__.box";

/**
 * Lógica do jogo. Conhece só portas públicas (`PhysicsApi` e a porta de
 * visualização desta pasta): sem kernel, Three.js, Rapier ou DOM.
 * A engine já avança a física no `game.loop.tick`; aqui só criamos/removemos
 * corpos e copiamos a pose para a visualização.
 */
export class __PASCAL__Game {
  /** Reutilizado a cada frame (sem alocação por frame). */
  private readonly transform: MutableBodyTransformDTO = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
  };
  private disposed = false;

  public constructor(
    private readonly physics: PhysicsApi,
    private readonly view: __PASCAL__ViewPort,
  ) {
    const floorCreated = physics.createBody(
      FLOOR_BODY_ID,
      { bodyType: "fixed", position: { x: 0, y: -0.5, z: 0 } },
      { shapeType: "box", halfExtents: { x: 10, y: 0.5, z: 10 }, friction: 0.9, restitution: 0.2 },
    );
    if (!floorCreated) throw new Error("não foi possível criar o piso físico");

    const boxCreated = physics.createBody(
      BOX_BODY_ID,
      { bodyType: "dynamic", position: { x: 0, y: 5, z: 0 }, canSleep: false },
      { shapeType: "box", halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, friction: 0.6, restitution: 0.4 },
    );
    if (!boxCreated) {
      physics.removeBody(FLOOR_BODY_ID);
      throw new Error("não foi possível criar a caixa física");
    }
  }

  /** Copia a pose do corpo para a visualização (chamado no `game.loop.render`). */
  public syncVisual(): void {
    if (this.disposed) return;
    if (!this.physics.getBodyTransformInto(BOX_BODY_ID, this.transform)) return;
    this.view.setBoxTransform(this.transform.position, this.transform.rotation);
  }

  /** Impulso para cima (ligue a uma ação de input: receita 05-input-actions). */
  public jump(): boolean {
    if (this.disposed) return false;
    return this.physics.applyImpulse(BOX_BODY_ID, { x: 0, y: 4, z: 0 });
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.physics.removeBody(BOX_BODY_ID);
    this.physics.removeBody(FLOOR_BODY_ID);
    this.view.dispose();
  }
}
