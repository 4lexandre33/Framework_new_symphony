import type { PluginContext } from "@core";
import type { AnimationEventTrigger, AnimationLoopMode } from "../../../contracts/anim/types";
import { countCrossings } from "./AnimationStateMachine";

/**
 * Dispara triggers por CRUZAMENTO da janela de tempo percorrida no tick
 * (G74/G75/G78): sem chaves de texto (ids/nomes com ":" ou espaço são
 * seguros), triggers em 0,0 e 1,0 funcionam e repetem a cada ciclo em loop.
 */
export class AnimationEventManager {
  public constructor(private readonly ctx: PluginContext) {}

  public processWindow(
    entityId: string,
    stateName: string,
    loopMode: AnimationLoopMode,
    windowStartCycles: number,
    windowEndCycles: number,
    triggers: ReadonlyArray<AnimationEventTrigger>,
  ): void {
    for (let index = 0; index < triggers.length; index += 1) {
      const trigger = triggers[index];
      if (!trigger) continue;

      const count = countCrossings(trigger.frameOrTime, windowStartCycles, windowEndCycles, loopMode);

      for (let fire = 0; fire < count; fire += 1) {
        // Objeto novo por disparo (G122: emit enfileira e entrega por referência).
        this.ctx.events.emit("game.anim.event-triggered", {
          entityId,
          stateName,
          eventName: trigger.eventName,
          payload: trigger.payload,
        });
      }
    }
  }

  /**
   * Emite `game.anim.clip-finished` para cada ciclo completado na janela.
   */
  public processClipEnd(
    entityId: string,
    stateName: string,
    clipId: string,
    loopMode: AnimationLoopMode,
    windowStartCycles: number,
    windowEndCycles: number,
  ): void {
    const count = countCrossings(1, windowStartCycles, windowEndCycles, loopMode === "LoopOnce" ? "LoopOnce" : "LoopRepeat");
    if (count === 0) return;

    const lastCycle = loopMode === "LoopOnce" ? 1 : Math.floor(windowEndCycles);

    for (let fire = 0; fire < count; fire += 1) {
      this.ctx.events.emit("game.anim.clip-finished", {
        entityId,
        stateName,
        clipId,
        loopMode,
        completedCycles: loopMode === "LoopOnce" ? 1 : lastCycle - (count - 1 - fire),
      });
    }
  }

  /** Mantido por compatibilidade: o estado de triggers agora vive na FSM. */
  public resetEntityTriggers(_entityId: string): void {}

  public clear(): void {}
}
