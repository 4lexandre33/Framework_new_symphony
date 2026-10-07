import type {
  EntitySnapshot,
  StateReplicationApi,
  WorldStateSnapshot,
} from "../../../contracts/net/types";

import {
  isNewerSequence,
  isValidEntitySnapshot,
} from "./NetworkPacketValidator";

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

function cloneEntitySnapshot(
  source: EntitySnapshot,
): EntitySnapshot {
  return {
    entityId:
      source.entityId,
    type:
      source.type,
    position: {
      x: source.position.x,
      y: source.position.y,
      z: source.position.z,
    },
    rotation: {
      x: source.rotation.x,
      y: source.rotation.y,
      z: source.rotation.z,
      w: source.rotation.w,
    },
    velocity: {
      x: source.velocity.x,
      y: source.velocity.y,
      z: source.velocity.z,
    },
    sequence:
      source.sequence,
    timestamp:
      source.timestamp,
  };
}

function createInterpolationScratch():
  MutableEntitySnapshot {
  return {
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
}

export class StateReplicator
  implements StateReplicationApi {
  private readonly entityHistory =
    new Map<
      string,
      EntitySnapshot[]
    >();

  private readonly interpolationScratch =
    new Map<
      string,
      MutableEntitySnapshot
    >();

  private readonly maxHistorySize =
    20;

  public registerEntity(
    entityId: string,
    initialSnapshot:
      EntitySnapshot,
  ): void {
    if (
      this.entityHistory.has(
        entityId,
      ) ||
      entityId !==
        initialSnapshot.entityId ||
      !isValidEntitySnapshot(
        initialSnapshot,
      )
    ) {
      return;
    }

    this.entityHistory.set(
      entityId,
      [
        cloneEntitySnapshot(
          initialSnapshot,
        ),
      ],
    );

    this.interpolationScratch.set(
      entityId,
      createInterpolationScratch(),
    );
  }

  public unregisterEntity(
    entityId: string,
  ): void {
    this.entityHistory.delete(
      entityId,
    );

    this.interpolationScratch.delete(
      entityId,
    );
  }

  public pushEntitySnapshot(
    snapshot: EntitySnapshot,
  ): void {
    if (
      !isValidEntitySnapshot(
        snapshot,
      )
    ) {
      return;
    }

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

      this.interpolationScratch.set(
        snapshot.entityId,
        createInterpolationScratch(),
      );
    }

    const latest =
      history[
        history.length - 1
      ];

    if (
      latest &&
      !isNewerSequence(
        snapshot.sequence,
        latest.sequence,
      )
    ) {
      return;
    }

    history.push(
      cloneEntitySnapshot(
        snapshot,
      ),
    );

    if (
      history.length >
      this.maxHistorySize
    ) {
      history.shift();
    }
  }

  public processWorldSnapshot(
    worldSnapshot:
      WorldStateSnapshot,
  ): void {
    const entities =
      worldSnapshot.entities;

    for (
      let index = 0;
      index <
      entities.length;
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
          Number.isFinite(alpha)
            ? alpha
            : 0,
        ),
      );

    let scratch =
      this.interpolationScratch.get(
        entityId,
      );

    if (!scratch) {
      scratch =
        createInterpolationScratch();

      this.interpolationScratch.set(
        entityId,
        scratch,
      );
    }

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
    const entityIds =
      Array.from(
        this.entityHistory.keys(),
      );

    entityIds.sort();

    const entities:
      EntitySnapshot[] = [];

    for (
      let index = 0;
      index <
      entityIds.length;
      index += 1
    ) {
      const entityId =
        entityIds[index];

      if (!entityId) {
        continue;
      }

      const history =
        this.entityHistory.get(
          entityId,
        );

      const latest =
        history?.[
          history.length - 1
        ];

      if (latest) {
        entities.push(
          cloneEntitySnapshot(
            latest,
          ),
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
    this.interpolationScratch.clear();
  }
}
