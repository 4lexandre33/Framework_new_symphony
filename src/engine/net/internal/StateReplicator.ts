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

/** Origem "local": entidade registrada/atualizada pelo próprio jogo. */
export const LOCAL_ENTITY_OWNER = "@local";
export const MAX_REPLICATED_ENTITIES = 8192;

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

/**
 * Slerp com correção de sinal (G107): q e -q representam a mesma rotação;
 * sem inverter quando dot < 0 a interpolação dá a volta longa. Escreve em
 * `out` normalizado; sem alocação.
 */
export function slerpQuaternion(
  ax: number,
  ay: number,
  az: number,
  aw: number,
  bx: number,
  by: number,
  bz: number,
  bw: number,
  t: number,
  out: MutableQuaternion,
): void {
  let dot = ax * bx + ay * by + az * bz + aw * bw;

  if (dot < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    dot = -dot;
  }

  let scaleA: number;
  let scaleB: number;

  if (dot > 0.9995) {
    // Ângulo muito pequeno: nlerp é estável e suficiente.
    scaleA = 1 - t;
    scaleB = t;
  } else {
    const theta = Math.acos(Math.min(1, dot));
    const sinTheta = Math.sin(theta);
    scaleA = Math.sin((1 - t) * theta) / sinTheta;
    scaleB = Math.sin(t * theta) / sinTheta;
  }

  const x = ax * scaleA + bx * scaleB;
  const y = ay * scaleA + by * scaleB;
  const z = az * scaleA + bz * scaleB;
  const w = aw * scaleA + bw * scaleB;
  const length = Math.sqrt(x * x + y * y + z * z + w * w);

  if (length > 0.000001) {
    out.x = x / length;
    out.y = y / length;
    out.z = z / length;
    out.w = w / length;
  } else {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    out.w = 1;
  }
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

  /** entityId → origem (`@local` ou peerId remoto). */
  private readonly entityOwner =
    new Map<string, string>();

  /** Último `sequence` de snapshot de mundo aplicado por origem. */
  private readonly lastWorldSequence =
    new Map<string, number>();

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
      ) ||
      this.entityHistory.size >=
        MAX_REPLICATED_ENTITIES
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

    this.entityOwner.set(
      entityId,
      LOCAL_ENTITY_OWNER,
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

    this.entityOwner.delete(
      entityId,
    );
  }

  /** Origem da entidade (`@local` ou peerId), ou `null` se não existe. */
  public getEntityOwner(
    entityId: string,
  ): string | null {
    return this.entityOwner.get(entityId) ?? null;
  }

  public pushEntitySnapshot(
    snapshot: EntitySnapshot,
  ): void {
    this.pushOwned(
      snapshot,
      LOCAL_ENTITY_OWNER,
    );
  }

  /**
   * Insere snapshot de uma origem. Origem remota nunca sobrescreve entidade
   * local (autoridade fica com quem a registrou).
   */
  public pushOwned(
    snapshot: EntitySnapshot,
    owner: string,
  ): boolean {
    if (
      !isValidEntitySnapshot(
        snapshot,
      )
    ) {
      return false;
    }

    const currentOwner =
      this.entityOwner.get(
        snapshot.entityId,
      );

    if (
      currentOwner !== undefined &&
      currentOwner !== owner &&
      currentOwner === LOCAL_ENTITY_OWNER
    ) {
      return false;
    }

    let history =
      this.entityHistory.get(
        snapshot.entityId,
      );

    if (!history) {
      if (
        this.entityHistory.size >=
        MAX_REPLICATED_ENTITIES
      ) {
        return false;
      }

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

    this.entityOwner.set(
      snapshot.entityId,
      owner,
    );

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
      return false;
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

    return true;
  }

  public processWorldSnapshot(
    worldSnapshot:
      WorldStateSnapshot,
    sourcePeerId?: string,
  ): void {
    const source =
      (sourcePeerId ?? worldSnapshot.hostSteamId ?? "").trim() ||
      "@remote";

    if (source === LOCAL_ENTITY_OWNER) {
      return;
    }

    const previousSequence =
      this.lastWorldSequence.get(
        source,
      );

    if (
      previousSequence !== undefined &&
      !isNewerSequence(
        worldSnapshot.sequence,
        previousSequence,
      )
    ) {
      // Snapshot atrasado/duplicado: aplicá-lo removeria entidades novas.
      return;
    }

    this.lastWorldSequence.set(
      source,
      worldSnapshot.sequence,
    );

    const present =
      new Set<string>();

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

      if (!snapshot) {
        continue;
      }

      present.add(
        snapshot.entityId,
      );

      this.pushOwned(
        snapshot,
        source,
      );
    }

    // G107: remove entidades desta origem que sumiram do snapshot.
    for (
      const [entityId, owner] of
      Array.from(this.entityOwner)
    ) {
      if (
        owner === source &&
        !present.has(entityId)
      ) {
        this.unregisterEntity(
          entityId,
        );
      }
    }
  }

  /** Remove todas as entidades de uma origem remota (par desconectado). */
  public removeEntitiesFrom(
    source: string,
  ): number {
    let removed = 0;
    for (
      const [entityId, owner] of
      Array.from(this.entityOwner)
    ) {
      if (owner === source) {
        this.unregisterEntity(entityId);
        removed += 1;
      }
    }
    this.lastWorldSequence.delete(source);
    return removed;
  }

  /** Remove todas as entidades remotas; preserva as locais. */
  public clearRemote(): void {
    for (
      const [entityId, owner] of
      Array.from(this.entityOwner)
    ) {
      if (owner !== LOCAL_ENTITY_OWNER) {
        this.unregisterEntity(entityId);
      }
    }
    this.lastWorldSequence.clear();
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

    slerpQuaternion(
      previous.rotation.x,
      previous.rotation.y,
      previous.rotation.z,
      previous.rotation.w,
      next.rotation.x,
      next.rotation.y,
      next.rotation.z,
      next.rotation.w,
      interpolationAlpha,
      scratch.rotation,
    );

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
    this.entityOwner.clear();
    this.lastWorldSequence.clear();
  }
}
