import type RAPIER from "@dimforge/rapier3d-compat";

import type {
  PluginContext,
} from "@core";

import type {
  CollisionEventPayload,
  ContactForceEventPayload,
} from "../../../contracts/physics/types";

import {
  CollisionEnterEvent,
  CollisionExitEvent,
  ContactForceEvent,
  TriggerEnterEvent,
  TriggerExitEvent,
} from "../../../contracts/physics/types";

type PhysicsCollisionEventType =
  | typeof CollisionEnterEvent.type
  | typeof CollisionExitEvent.type
  | typeof TriggerEnterEvent.type
  | typeof TriggerExitEvent.type
  | typeof ContactForceEvent.type;

interface PendingPhysicsEvent {
  readonly type: PhysicsCollisionEventType;
  readonly payload: CollisionEventPayload | ContactForceEventPayload;
}

/** Par de colliders em contato/interseção ativa (entre enter e exit). */
interface ActivePair {
  readonly handleA: number;
  readonly handleB: number;
  readonly entityIdA: string;
  readonly entityIdB: string;
  readonly isTrigger: boolean;
}

function pairKey(
  handle1: number,
  handle2: number,
): string {
  return handle1 < handle2
    ? `${String(handle1)}|${String(handle2)}`
    : `${String(handle2)}|${String(handle1)}`;
}

export class CollisionEventManager {
  private readonly pendingEvents:
    PendingPhysicsEvent[] = [];

  /**
   * Pares ativos. Permite emitir exit quando um corpo é removido (o Rapier só
   * reportaria o fim do contato no próximo step, quando o handle já não mapeia
   * mais para a entidade). Alocação apenas em enter/exit, nunca por tick.
   */
  private readonly activePairs =
    new Map<string, ActivePair>();

  private handleToEntityMap:
    ReadonlyMap<number, string> | null = null;

  private handleToSensorMap:
    ReadonlyMap<number, boolean> | null = null;

  private readonly onCollisionEvent = (
    handle1: number,
    handle2: number,
    started: boolean,
  ): void => {
    const entityMap = this.handleToEntityMap;
    const sensorMap = this.handleToSensorMap;

    if (entityMap === null || sensorMap === null) {
      return;
    }

    const entityIdA = entityMap.get(handle1);
    const entityIdB = entityMap.get(handle2);

    if (entityIdA === undefined || entityIdB === undefined) {
      return;
    }

    const key = pairKey(handle1, handle2);

    if (
      started &&
      this.activePairs.has(key)
    ) {
      return;
    }

    const isTrigger =
      sensorMap.get(handle1) === true ||
      sensorMap.get(handle2) === true;

    if (started) {
      this.activePairs.set(key, {
        handleA: handle1,
        handleB: handle2,
        entityIdA,
        entityIdB,
        isTrigger,
      });
    } else {
      this.activePairs.delete(key);
    }

    const type: PhysicsCollisionEventType =
      isTrigger
        ? (started ? TriggerEnterEvent.type : TriggerExitEvent.type)
        : (started ? CollisionEnterEvent.type : CollisionExitEvent.type);

    this.pendingEvents.push({
      type,
      payload: {
        entityIdA,
        entityIdB,
        isStarted: started,
        isTrigger,
      },
    });
  };

  private readonly onContactForceEvent = (
    event: RAPIER.TempContactForceEvent,
  ): void => {
    const entityMap = this.handleToEntityMap;

    if (entityMap === null) {
      return;
    }

    const entityIdA = entityMap.get(event.collider1());
    const entityIdB = entityMap.get(event.collider2());

    if (entityIdA === undefined || entityIdB === undefined) {
      return;
    }

    const totalForce = event.totalForce();

    this.pendingEvents.push({
      type: ContactForceEvent.type,
      payload: {
        entityIdA,
        entityIdB,
        totalForceMagnitude: event.totalForceMagnitude(),
        maxForceMagnitude: event.maxForceMagnitude(),
        totalForce: {
          x: totalForce.x,
          y: totalForce.y,
          z: totalForce.z,
        },
      },
    });
  };

  public constructor(
    private readonly ctx:
      PluginContext,
  ) {}

  public processEvents(
    eventQueue: RAPIER.EventQueue,
    handleToEntityMap: ReadonlyMap<number, string>,
    handleToSensorMap: ReadonlyMap<number, boolean>,
  ): number {
    this.pendingEvents.length = 0;
    this.handleToEntityMap = handleToEntityMap;
    this.handleToSensorMap = handleToSensorMap;

    try {
      eventQueue.drainCollisionEvents(this.onCollisionEvent);
      eventQueue.drainContactForceEvents(this.onContactForceEvent);
    } finally {
      this.handleToEntityMap = null;
      this.handleToSensorMap = null;
    }

    return this.pendingEvents.length;
  }

  /**
   * Emite exits (com `removed: true`) para todos os pares ativos que envolvem
   * algum dos colliders informados. Chamado ANTES de remover o corpo do Rapier.
   * Os eventos vão direto para a fila do Kernel (não passam por pendingEvents),
   * então é seguro chamar de dentro de um handler durante `flushSerial`.
   */
  public emitExitsForColliders(
    colliderHandles: ReadonlySet<number>,
  ): number {
    let emitted = 0;

    for (const [key, pair] of this.activePairs) {
      if (
        !colliderHandles.has(pair.handleA) &&
        !colliderHandles.has(pair.handleB)
      ) {
        continue;
      }

      this.activePairs.delete(key);

      this.ctx.events.emit(
        pair.isTrigger
          ? TriggerExitEvent.type
          : CollisionExitEvent.type,
        {
          entityIdA: pair.entityIdA,
          entityIdB: pair.entityIdB,
          isStarted: false,
          isTrigger: pair.isTrigger,
          removed: true,
        },
      );

      emitted += 1;
    }

    return emitted;
  }

  public get activePairCount(): number {
    return this.activePairs.size;
  }

  public flushQueued(): void {
    try {
      for (let index = 0; index < this.pendingEvents.length; index += 1) {
        const event = this.pendingEvents[index];

        if (event === undefined) {
          continue;
        }

        this.ctx.events.emit(event.type, event.payload);
      }
    } finally {
      this.pendingEvents.length = 0;
    }
  }

  public async flushSerial(): Promise<void> {
    try {
      for (let index = 0; index < this.pendingEvents.length; index += 1) {
        const event = this.pendingEvents[index];

        if (event === undefined) {
          continue;
        }

        await this.ctx.events.emitAsync(event.type, event.payload);
      }
    } finally {
      this.pendingEvents.length = 0;
    }
  }

  public clear(): void {
    this.pendingEvents.length = 0;
    this.activePairs.clear();
    this.handleToEntityMap = null;
    this.handleToSensorMap = null;
  }
}
