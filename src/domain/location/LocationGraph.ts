import type {
  LocationId,
} from "./LocationId";

import {
  createLocationRelation,
  isSymmetricLocationRelationKind,
} from "./LocationRelation";

import type {
  LocationRelation,
  LocationRelationKind,
} from "./LocationRelation";

import type {
  LocationZone,
} from "./LocationZone";

export type LocationGraphErrorCode =
  | "empty-graph"
  | "duplicate-location"
  | "duplicate-relation"
  | "missing-location"
  | "containment-cycle"
  | "unknown-location";

export class LocationGraphError
  extends Error {
  public readonly name =
    "LocationGraphError";

  public constructor(
    public readonly code:
      LocationGraphErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface LocationGraphCreateOptions {
  readonly zones:
    readonly LocationZone[];
  readonly relations?:
    readonly LocationRelation[];
}

export interface LocationPathOptions {
  /**
   * Relações utilizáveis no path.
   *
   * Default: connected-to + neighbor.
   * contains/parent/child somente entram se o chamador pedir explicitamente.
   */
  readonly relationKinds?:
    readonly LocationRelationKind[];
}

type AdjacencyMap =
  Map<
    LocationId,
    readonly LocationRelation[]
  >;

const DEFAULT_PATH_KINDS =
  Object.freeze<
    readonly LocationRelationKind[]
  >([
    "connected-to",
    "neighbor",
  ]);

const RELATION_KEY_SEPARATOR =
  "\u0000";

function compareLocationId(
  left: LocationId,
  right: LocationId,
): number {
  return left < right
    ? -1
    : left > right
      ? 1
      : 0;
}

function relationKey(
  relation: LocationRelation,
): string {
  if (
    isSymmetricLocationRelationKind(
      relation.kind,
    )
  ) {
    const first =
      compareLocationId(
        relation.from,
        relation.to,
      ) <= 0
        ? relation.from
        : relation.to;

    const second =
      first === relation.from
        ? relation.to
        : relation.from;

    return [
      relation.kind,
      first,
      second,
    ].join(
      RELATION_KEY_SEPARATOR,
    );
  }

  return [
    relation.kind,
    relation.from,
    relation.to,
  ].join(
    RELATION_KEY_SEPARATOR,
  );
}

function freezeAdjacency(
  source:
    Map<
      LocationId,
      LocationRelation[]
    >,
): AdjacencyMap {
  const result =
    new Map<
      LocationId,
      readonly LocationRelation[]
    >();

  for (
    const [
      locationId,
      relations,
    ] of source
  ) {
    relations.sort(
      (left, right) => {
        const kindCompare =
          left.kind.localeCompare(
            right.kind,
          );

        if (kindCompare !== 0) {
          return kindCompare;
        }

        const leftOther =
          left.from === locationId
            ? left.to
            : left.from;

        const rightOther =
          right.from === locationId
            ? right.to
            : right.from;

        return compareLocationId(
          leftOther,
          rightOther,
        );
      },
    );

    result.set(
      locationId,
      Object.freeze(
        [...relations],
      ),
    );
  }

  return result;
}

/**
 * Grafo semântico imutável de localizações.
 *
 * Regras:
 * - LocationId é único;
 * - relações não podem apontar para locations inexistentes;
 * - relações simétricas (connected-to/neighbor) tratam A-B e B-A como a mesma;
 * - contains é hierárquico e não pode formar ciclo;
 * - connected-to/neighbor podem formar ciclos naturalmente;
 * - nenhuma coordenada ou estrutura da engine faz parte do grafo.
 *
 * O grafo é construído uma vez. Lookups usam Map. Operações que precisam
 * materializar caminhos/alvos fazem alocação somente sob demanda.
 */
export class LocationGraph {
  private readonly zones =
    new Map<
      LocationId,
      LocationZone
    >();

  private readonly outgoing:
    AdjacencyMap;

  private readonly adjacency:
    AdjacencyMap;

  private readonly contents =
    new Map<
      LocationId,
      readonly LocationId[]
    >();

  public constructor(
    options:
      LocationGraphCreateOptions,
  ) {
    if (
      options.zones.length ===
      0
    ) {
      throw new LocationGraphError(
        "empty-graph",
        "LocationGraph precisa possuir ao menos uma LocationZone.",
      );
    }

    for (
      const zone of
      options.zones
    ) {
      if (
        this.zones.has(
          zone.id,
        )
      ) {
        throw new LocationGraphError(
          "duplicate-location",
          `LocationId duplicado: "${zone.id}".`,
        );
      }

      this.zones.set(
        zone.id,
        zone,
      );
    }

    const outgoingMutable =
      new Map<
        LocationId,
        LocationRelation[]
      >();

    const adjacencyMutable =
      new Map<
        LocationId,
        LocationRelation[]
      >();

    const contentsMutable =
      new Map<
        LocationId,
        LocationId[]
      >();

    for (
      const locationId of
      this.zones.keys()
    ) {
      outgoingMutable.set(
        locationId,
        [],
      );

      adjacencyMutable.set(
        locationId,
        [],
      );

      contentsMutable.set(
        locationId,
        [],
      );
    }

    const seenRelationKeys =
      new Set<string>();

    for (
      const relationInput of
      options.relations ?? []
    ) {
      const relation =
        createLocationRelation(
          relationInput.kind,
          relationInput.from,
          relationInput.to,
        );

      this.requireKnownLocation(
        relation.from,
      );

      this.requireKnownLocation(
        relation.to,
      );

      const key =
        relationKey(relation);

      if (
        seenRelationKeys.has(key)
      ) {
        throw new LocationGraphError(
          "duplicate-relation",
          `Relação duplicada: "${relation.kind}" entre "${relation.from}" e "${relation.to}".`,
        );
      }

      seenRelationKeys.add(key);

      outgoingMutable
        .get(relation.from)
        ?.push(relation);

      adjacencyMutable
        .get(relation.from)
        ?.push(relation);

      if (
        isSymmetricLocationRelationKind(
          relation.kind,
        )
      ) {
        adjacencyMutable
          .get(relation.to)
          ?.push(relation);
      }

      if (
        relation.kind ===
        "contains"
      ) {
        contentsMutable
          .get(relation.from)
          ?.push(relation.to);
      }
    }

    this.outgoing =
      freezeAdjacency(
        outgoingMutable,
      );

    this.adjacency =
      freezeAdjacency(
        adjacencyMutable,
      );

    for (
      const [
        locationId,
        children,
      ] of contentsMutable
    ) {
      children.sort(
        compareLocationId,
      );

      this.contents.set(
        locationId,
        Object.freeze(
          [...children],
        ),
      );
    }

    this.assertContainmentAcyclic();
  }

  public get size():
    number {
    return this.zones.size;
  }

  public hasLocation(
    locationId: LocationId,
  ): boolean {
    return this.zones.has(
      locationId,
    );
  }

  public getLocation(
    locationId: LocationId,
  ): LocationZone {
    return this.requireKnownLocation(
      locationId,
    );
  }

  public getOutgoingRelations(
    locationId: LocationId,
  ): readonly LocationRelation[] {
    this.requireKnownLocation(
      locationId,
    );

    return (
      this.outgoing.get(
        locationId,
      ) ?? []
    );
  }

  public hasDirectRelation(
    from: LocationId,
    to: LocationId,
    kind:
      LocationRelationKind,
  ): boolean {
    this.requireKnownLocation(
      from,
    );

    this.requireKnownLocation(
      to,
    );

    const relations =
      isSymmetricLocationRelationKind(
        kind,
      )
        ? this.adjacency.get(
            from,
          ) ?? []
        : this.outgoing.get(
            from,
          ) ?? [];

    for (
      const relation of
      relations
    ) {
      if (
        relation.kind !== kind
      ) {
        continue;
      }

      if (
        isSymmetricLocationRelationKind(
          kind,
        )
      ) {
        const other =
          relation.from === from
            ? relation.to
            : relation.from;

        if (other === to) {
          return true;
        }

        continue;
      }

      if (
        relation.from === from &&
        relation.to === to
      ) {
        return true;
      }
    }

    return false;
  }

  public getDirectContents(
    containerId: LocationId,
  ): readonly LocationId[] {
    this.requireKnownLocation(
      containerId,
    );

    return (
      this.contents.get(
        containerId,
      ) ?? []
    );
  }

  /**
   * Consulta containment transitivo.
   *
   * Ex.: isContainedBy(room, world) === true quando
   * world contains building e building contains room.
   */
  public isContainedBy(
    locationId: LocationId,
    containerId: LocationId,
  ): boolean {
    this.requireKnownLocation(
      locationId,
    );

    this.requireKnownLocation(
      containerId,
    );

    if (
      locationId ===
      containerId
    ) {
      return false;
    }

    const pending:
      LocationId[] = [
        containerId,
      ];

    const visited =
      new Set<
        LocationId
      >();

    while (
      pending.length > 0
    ) {
      const current =
        pending.pop();

      if (
        current === undefined ||
        visited.has(current)
      ) {
        continue;
      }

      visited.add(current);

      for (
        const child of
        this.contents.get(
          current,
        ) ?? []
      ) {
        if (
          child === locationId
        ) {
          return true;
        }

        if (
          !visited.has(child)
        ) {
          pending.push(child);
        }
      }
    }

    return false;
  }

  /**
   * BFS semântico. Por default, percorre apenas connected-to e neighbor.
   *
   * Retorna IDs incluindo origem e destino. `null` significa sem caminho.
   */
  public findPath(
    from: LocationId,
    to: LocationId,
    options:
      LocationPathOptions = {},
  ): readonly LocationId[] |
    null {
    this.requireKnownLocation(
      from,
    );

    this.requireKnownLocation(
      to,
    );

    if (from === to) {
      return [from];
    }

    const allowedKinds =
      new Set(
        options.relationKinds ??
        DEFAULT_PATH_KINDS,
      );

    if (
      allowedKinds.size === 0
    ) {
      return null;
    }

    const pending:
      LocationId[] = [from];

    let readIndex = 0;

    const visited =
      new Set<LocationId>([
        from,
      ]);

    const previous =
      new Map<
        LocationId,
        LocationId
      >();

    while (
      readIndex <
      pending.length
    ) {
      const current =
        pending[readIndex];

      readIndex += 1;

      if (
        current === undefined
      ) {
        continue;
      }

      const candidates =
        this.getTraversalCandidates(
          current,
          allowedKinds,
        );

      for (
        const next of
        candidates
      ) {
        if (
          visited.has(next)
        ) {
          continue;
        }

        visited.add(next);

        previous.set(
          next,
          current,
        );

        if (next === to) {
          return this.reconstructPath(
            from,
            to,
            previous,
          );
        }

        pending.push(next);
      }
    }

    return null;
  }

  private getTraversalCandidates(
    locationId: LocationId,
    allowedKinds:
      ReadonlySet<
        LocationRelationKind
      >,
  ): readonly LocationId[] {
    const result:
      LocationId[] = [];

    const seen =
      new Set<
        LocationId
      >();

    for (
      const relation of
      this.adjacency.get(
        locationId,
      ) ?? []
    ) {
      if (
        !allowedKinds.has(
          relation.kind,
        )
      ) {
        continue;
      }

      const next =
        relation.from ===
        locationId
          ? relation.to
          : relation.from;

      if (
        !seen.has(next)
      ) {
        seen.add(next);
        result.push(next);
      }
    }

    for (
      const relation of
      this.outgoing.get(
        locationId,
      ) ?? []
    ) {
      if (
        isSymmetricLocationRelationKind(
          relation.kind,
        ) ||
        !allowedKinds.has(
          relation.kind,
        )
      ) {
        continue;
      }

      if (
        !seen.has(
          relation.to,
        )
      ) {
        seen.add(
          relation.to,
        );

        result.push(
          relation.to,
        );
      }
    }

    result.sort(
      compareLocationId,
    );

    return result;
  }

  private reconstructPath(
    from: LocationId,
    to: LocationId,
    previous:
      ReadonlyMap<
        LocationId,
        LocationId
      >,
  ): readonly LocationId[] {
    const reversed:
      LocationId[] = [to];

    let current = to;

    while (
      current !== from
    ) {
      const parent =
        previous.get(
          current,
        );

      if (
        parent === undefined
      ) {
        throw new LocationGraphError(
          "unknown-location",
          "Falha interna ao reconstruir caminho sem predecessor.",
        );
      }

      reversed.push(parent);
      current = parent;
    }

    reversed.reverse();

    return reversed;
  }

  private requireKnownLocation(
    locationId: LocationId,
  ): LocationZone {
    const zone =
      this.zones.get(
        locationId,
      );

    if (zone === undefined) {
      throw new LocationGraphError(
        "unknown-location",
        `Location desconhecida: "${locationId}".`,
      );
    }

    return zone;
  }

  private assertContainmentAcyclic():
    void {
    const visiting =
      new Set<
        LocationId
      >();

    const visited =
      new Set<
        LocationId
      >();

    const visit = (
      locationId:
        LocationId,
    ): void => {
      if (
        visiting.has(
          locationId,
        )
      ) {
        throw new LocationGraphError(
          "containment-cycle",
          `Ciclo de containment detectado envolvendo "${locationId}".`,
        );
      }

      if (
        visited.has(locationId)
      ) {
        return;
      }

      visiting.add(locationId);

      for (
        const child of
        this.contents.get(
          locationId,
        ) ?? []
      ) {
        visit(child);
      }

      visiting.delete(
        locationId,
      );

      visited.add(locationId);
    };

    for (
      const locationId of
      this.zones.keys()
    ) {
      visit(locationId);
    }
  }
}
