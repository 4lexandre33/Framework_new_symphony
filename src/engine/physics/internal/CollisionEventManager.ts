import type RAPIER from "@dimforge/rapier3d-compat";

import type {
  PluginContext,
} from "@core";

import type {
  CollisionEventPayload,
} from "../../../contracts/physics/types";

import {
  CollisionEnterEvent,
  CollisionExitEvent,
  TriggerEnterEvent,
  TriggerExitEvent,
} from "../../../contracts/physics/types";

type PhysicsCollisionEventType =
  | typeof CollisionEnterEvent.type
  | typeof CollisionExitEvent.type
  | typeof TriggerEnterEvent.type
  | typeof TriggerExitEvent.type;

interface PendingPhysicsEvent {
  readonly type:
    PhysicsCollisionEventType;
  readonly payload:
    CollisionEventPayload;
}

export class CollisionEventManager {
  private readonly pendingEvents:
    PendingPhysicsEvent[] =
    [];

  private handleToEntityMap:
    ReadonlyMap<number, string> |
    null = null;

  private handleToSensorMap:
    ReadonlyMap<number, boolean> |
    null = null;

  private readonly onCollisionEvent =
    (
      handle1: number,
      handle2: number,
      started: boolean,
    ): void => {
      const entityMap =
        this.handleToEntityMap;

      const sensorMap =
        this.handleToSensorMap;

      if (
        entityMap ===
          null ||
        sensorMap ===
          null
      ) {
        return;
      }

      const entityIdA =
        entityMap.get(
          handle1,
        );

      const entityIdB =
        entityMap.get(
          handle2,
        );

      if (
        entityIdA ===
          undefined ||
        entityIdB ===
          undefined
      ) {
        return;
      }

      const isTrigger =
        sensorMap.get(
          handle1,
        ) ===
          true ||
        sensorMap.get(
          handle2,
        ) ===
          true;

      const type:
        PhysicsCollisionEventType =
        isTrigger
          ? (
              started
                ? TriggerEnterEvent.type
                : TriggerExitEvent.type
            )
          : (
              started
                ? CollisionEnterEvent.type
                : CollisionExitEvent.type
            );

      this.pendingEvents.push({
        type,
        payload: {
          entityIdA,
          entityIdB,
          isStarted:
            started,
          isTrigger,
        },
      });
    };

  private readonly onContactForceEvent =
    (): void => {
      // Reservado para uma capability futura de contact-force.
      // Não aloca e não altera o estado determinístico atual.
    };

  public constructor(
    private readonly ctx:
      PluginContext,
  ) {}

  public processEvents(
    eventQueue:
      RAPIER.EventQueue,
    handleToEntityMap:
      ReadonlyMap<number, string>,
    handleToSensorMap:
      ReadonlyMap<number, boolean>,
  ): number {
    this.pendingEvents.length =
      0;

    this.handleToEntityMap =
      handleToEntityMap;

    this.handleToSensorMap =
      handleToSensorMap;

    try {
      eventQueue.drainCollisionEvents(
        this.onCollisionEvent,
      );

      eventQueue.drainContactForceEvents(
        this.onContactForceEvent,
      );
    } finally {
      this.handleToEntityMap =
        null;

      this.handleToSensorMap =
        null;
    }

    return this.pendingEvents.length;
  }

  public flushQueued(): void {
    try {
      for (
        let index =
          0;
        index <
        this.pendingEvents.length;
        index +=
          1
      ) {
        const event =
          this.pendingEvents[index];

        if (
          event ===
          undefined
        ) {
          continue;
        }

        this.ctx.events.emit(
          event.type,
          event.payload,
        );
      }
    } finally {
      this.pendingEvents.length =
        0;
    }
  }

  public async flushSerial():
    Promise<void> {
    try {
      for (
        let index =
          0;
        index <
        this.pendingEvents.length;
        index +=
          1
      ) {
        const event =
          this.pendingEvents[index];

        if (
          event ===
          undefined
        ) {
          continue;
        }

        await this.ctx.events.emitAsync(
          event.type,
          event.payload,
        );
      }
    } finally {
      this.pendingEvents.length =
        0;
    }
  }

  public clear(): void {
    this.pendingEvents.length =
      0;

    this.handleToEntityMap =
      null;

    this.handleToSensorMap =
      null;
  }
}
