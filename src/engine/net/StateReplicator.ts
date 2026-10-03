import type {
  EntitySnapshot,
  WorldStateSnapshot,
} from "../../contracts/net/types";

interface MutableVector3 {
  x: number;
  y: number;
  z: number;
}

interface MutableQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

interface MutableEntitySnapshot {
  entityId: string;
  type: string;
  position: MutableVector3;
  rotation: MutableQuaternion;
  velocity: MutableVector3;
  sequence: number;
  timestamp: number;
}

export class StateReplicator {
  private readonly entityHistory =
    new Map<string, EntitySnapshot[]>();

  private readonly maxHistorySize = 20;

  private readonly interpolatedScratch: MutableEntitySnapshot = {
    entityId: "",
    type: "",
    position: {
      x: 0,
      y: 0,
      z: 0,
    },
    rotation: {
      x: 0,
      y: 0,
      z: 0,
      w: 1,
    },
    velocity: {
      x: 0,
      y: 0,
      z: 0,
    },
    sequence: 0,
    timestamp: 0,
  };

  public registerEntity(
    entityId: string,
    initialSnapshot: EntitySnapshot,
  ): void {
    if (this.entityHistory.has(entityId)) {
      return;
    }

    this.entityHistory.set(
      entityId,
      [initialSnapshot],
    );
  }

  public unregisterEntity(
    entityId: string,
  ): void {
    this.entityHistory.delete(
      entityId,
    );
  }

  public pushEntitySnapshot(
    snapshot: EntitySnapshot,
  ): void {
    let history =
      this.entityHistory.get(
        snapshot.entityId,
      );

    if (!history) {
      history = [];

      this.entityHistory.set(
        snapshot.entityId,
        history,
      );
    }

    history.push(
      snapshot,
    );

    if (
      history.length >
      this.maxHistorySize
    ) {
      history.shift();
    }
  }

  public processWorldSnapshot(
    worldSnapshot: WorldStateSnapshot,
  ): void {
    const entities =
      worldSnapshot.entities;

    for (
      let index = 0;
      index < entities.length;
      index += 1
    ) {
      const snapshot =
        entities[index];

      if (snapshot) {
        this.pushEntitySnapshot(
          snapshot,
        );
      }
    }
  }

  public getInterpolatedState(
    entityId: string,
    alpha: number,
  ): EntitySnapshot | null {
    const history =
      this.entityHistory.get(
        entityId,
      );

    if (
      !history ||
      history.length === 0
    ) {
      return null;
    }

    if (
      history.length === 1
    ) {
      return (
        history[0] ??
        null
      );
    }

    const previous =
      history[
        history.length - 2
      ];

    const next =
      history[
        history.length - 1
      ];

    if (
      !previous ||
      !next
    ) {
      return null;
    }

    const interpolationAlpha =
      Math.max(
        0,
        Math.min(
          1,
          alpha,
        ),
      );

    const scratch =
      this.interpolatedScratch;

    scratch.entityId =
      entityId;

    scratch.type =
      next.type;

    scratch.position.x =
      previous.position.x +
      (
        next.position.x -
        previous.position.x
      ) *
        interpolationAlpha;

    scratch.position.y =
      previous.position.y +
      (
        next.position.y -
        previous.position.y
      ) *
        interpolationAlpha;

    scratch.position.z =
      previous.position.z +
      (
        next.position.z -
        previous.position.z
      ) *
        interpolationAlpha;

    const rotationX =
      previous.rotation.x +
      (
        next.rotation.x -
        previous.rotation.x
      ) *
        interpolationAlpha;

    const rotationY =
      previous.rotation.y +
      (
        next.rotation.y -
        previous.rotation.y
      ) *
        interpolationAlpha;

    const rotationZ =
      previous.rotation.z +
      (
        next.rotation.z -
        previous.rotation.z
      ) *
        interpolationAlpha;

    const rotationW =
      previous.rotation.w +
      (
        next.rotation.w -
        previous.rotation.w
      ) *
        interpolationAlpha;

    const quaternionLength =
      Math.sqrt(
        rotationX * rotationX +
        rotationY * rotationY +
        rotationZ * rotationZ +
        rotationW * rotationW,
      );

    if (
      quaternionLength >
      0.000001
    ) {
      const inverseLength =
        1 /
        quaternionLength;

      scratch.rotation.x =
        rotationX *
        inverseLength;

      scratch.rotation.y =
        rotationY *
        inverseLength;

      scratch.rotation.z =
        rotationZ *
        inverseLength;

      scratch.rotation.w =
        rotationW *
        inverseLength;
    } else {
      scratch.rotation.x = 0;
      scratch.rotation.y = 0;
      scratch.rotation.z = 0;
      scratch.rotation.w = 1;
    }

    scratch.velocity.x =
      previous.velocity.x +
      (
        next.velocity.x -
        previous.velocity.x
      ) *
        interpolationAlpha;

    scratch.velocity.y =
      previous.velocity.y +
      (
        next.velocity.y -
        previous.velocity.y
      ) *
        interpolationAlpha;

    scratch.velocity.z =
      previous.velocity.z +
      (
        next.velocity.z -
        previous.velocity.z
      ) *
        interpolationAlpha;

    scratch.sequence =
      next.sequence;

    scratch.timestamp =
      next.timestamp;

    return scratch;
  }

  public generateWorldSnapshot(
    sequence: number,
    tick: number,
    hostSteamId: string,
  ): WorldStateSnapshot {
    const entities:
      EntitySnapshot[] = [];

    for (
      const history of
      this.entityHistory.values()
    ) {
      const latest =
        history[
          history.length - 1
        ];

      if (latest) {
        entities.push(
          latest,
        );
      }
    }

    return {
      sequence,
      timestamp:
        performance.now(),
      tick,
      hostSteamId,
      entities,
    };
  }

  public clear(): void {
    this.entityHistory.clear();
  }
}