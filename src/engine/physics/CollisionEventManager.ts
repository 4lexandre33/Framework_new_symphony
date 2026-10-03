import RAPIER from "@dimforge/rapier3d-compat";
import type { PluginContext } from "../../core/contracts/plugin-context";

export class CollisionEventManager {
  public constructor(private readonly ctx: PluginContext) {}

  public processEvents(eventQueue: RAPIER.EventQueue, handleToEntityMap: Map<number, string>): void {
    eventQueue.drainCollisionEvents((handle1, handle2, started) => {
      const entityIdA = handleToEntityMap.get(handle1);
      const entityIdB = handleToEntityMap.get(handle2);

      if (!entityIdA || !entityIdB) return;

      const payload = {
        entityIdA,
        entityIdB,
        isStarted: started,
        isTrigger: false,
      };

      if (started) {
        this.ctx.events.emit("game.physics.collision-enter", payload);
      } else {
        this.ctx.events.emit("game.physics.collision-exit", payload);
      }
    });

    eventQueue.drainContactForceEvents(() => {
      // Reservado para cálculos de forças mecânicas e deformações de malha
    });
  }
}