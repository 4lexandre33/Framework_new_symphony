import type { PluginContext } from "@core";
import type { AnimationEventTrigger } from "../../../contracts/anim/types";

export class AnimationEventManager {
  private readonly firedTriggers = new Set<string>();

  public constructor(private readonly ctx: PluginContext) {}

  public processTriggers(
    entityId: string,
    stateName: string,
    normalizedTime: number,
    triggers: ReadonlyArray<AnimationEventTrigger>
  ): void {
    for (const trigger of triggers) {
      const triggerKey = `${entityId}:${stateName}:${trigger.eventName}:${trigger.frameOrTime}`;

      if (normalizedTime >= trigger.frameOrTime) {
        if (!this.firedTriggers.has(triggerKey)) {
          this.firedTriggers.add(triggerKey);

          this.ctx.events.emit("game.anim.event-triggered", {
            entityId,
            stateName,
            eventName: trigger.eventName,
            payload: trigger.payload,
          });
        }
      } else {
        this.firedTriggers.delete(triggerKey);
      }
    }
  }

  public resetEntityTriggers(entityId: string): void {
    for (const key of this.firedTriggers.keys()) {
      if (key.startsWith(`${entityId}:`)) {
        this.firedTriggers.delete(key);
      }
    }
  }

  public clear(): void {
    this.firedTriggers.clear();
  }
}