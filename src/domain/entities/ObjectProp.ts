import {
  createLocationRef,
} from "../location/LocationRef";

import type {
  LocationRef,
} from "../location/LocationRef";

import {
  createLocationId,
} from "../location/LocationId";

import type {
  ObjectStateRef,
} from "./ObjectStateRef";

import {
  createObjectStateId,
  createObjectStateRef,
} from "./ObjectStateRef";

import type {
  WorldObjectId,
} from "./WorldObjectId";

import {
  createWorldObjectId,
} from "./WorldObjectId";

import type {
  WorldObjectRef,
} from "./WorldObjectRef";

import {
  createWorldObjectRef,
} from "./WorldObjectRef";

export interface ObjectPropCreateOptions {
  readonly id:
    WorldObjectId;
  readonly name: string;
  readonly location?:
    LocationRef | null;
  readonly stateRef?:
    ObjectStateRef | null;
}

export interface ObjectPropSnapshot {
  readonly id:
    WorldObjectId;
  readonly name: string;
  readonly locationId:
    string | null;
  readonly stateId:
    string | null;
}

export type ObjectPropErrorCode =
  | "invalid-name"
  | "invalid-snapshot";

export class ObjectPropError
  extends Error {
  public readonly name =
    "ObjectPropError";

  public constructor(
    public readonly code:
      ObjectPropErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const MAX_OBJECT_NAME_LENGTH =
  160;

function assertName(
  name: string,
): void {
  if (
    name.length === 0 ||
    name.length >
      MAX_OBJECT_NAME_LENGTH ||
    name !== name.trim()
  ) {
    throw new ObjectPropError(
      "invalid-name",
      "ObjectProp.name deve ser não vazio, sem whitespace nas extremidades e ter no máximo 160 caracteres.",
    );
  }
}

/**
 * Objeto lógico de gameplay.
 *
 * ObjectProp NÃO é uma entidade de renderer/física. Não contém:
 * - x/y/z;
 * - transform;
 * - Sprite/Mesh/Object3D;
 * - collider/rigid body;
 * - asset/texture/material;
 * - scene node.
 *
 * A mesma instância lógica pode ser projetada por adapters 2D, 2.5D ou 3D.
 *
 * `location` é uma associação semântica e pode mudar in-place quando o objeto
 * é movido entre locations lógicas. `stateRef` é opaca e imutável nesta etapa;
 * o StateStore real pertence à Etapa 47.
 */
export class ObjectProp {
  public readonly id:
    WorldObjectId;

  public readonly name:
    string;

  public readonly stateRef:
    ObjectStateRef | null;

  private locationValue:
    LocationRef | null;

  public constructor(
    options:
      ObjectPropCreateOptions,
  ) {
    assertName(options.name);

    this.id = options.id;
    this.name = options.name;
    this.locationValue =
      options.location ?? null;
    this.stateRef =
      options.stateRef ?? null;
  }

  public static fromSnapshot(
    snapshot:
      ObjectPropSnapshot,
  ): ObjectProp {
    if (
      typeof snapshot.id !==
        "string" ||
      typeof snapshot.name !==
        "string" ||
      (
        snapshot.locationId !==
          null &&
        typeof snapshot.locationId !==
          "string"
      ) ||
      (
        snapshot.stateId !==
          null &&
        typeof snapshot.stateId !==
          "string"
      )
    ) {
      throw new ObjectPropError(
        "invalid-snapshot",
        "ObjectPropSnapshot possui shape inválido.",
      );
    }

    try {
      return new ObjectProp({
        id:
          createWorldObjectId(
            snapshot.id,
          ),
        name: snapshot.name,
        location:
          snapshot.locationId ===
          null
            ? null
            : createLocationRef(
                createLocationId(
                  snapshot.locationId,
                ),
              ),
        stateRef:
          snapshot.stateId ===
          null
            ? null
            : createObjectStateRef(
                createObjectStateId(
                  snapshot.stateId,
                ),
              ),
      });
    } catch (error) {
      if (
        error instanceof
        ObjectPropError
      ) {
        throw error;
      }

      throw new ObjectPropError(
        "invalid-snapshot",
        `ObjectPropSnapshot inválido: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }
  }

  public get location():
    LocationRef | null {
    return this.locationValue;
  }

  public get located():
    boolean {
    return (
      this.locationValue !==
      null
    );
  }

  public toRef():
    WorldObjectRef {
    return createWorldObjectRef(
      this.id,
    );
  }

  public isLocatedAt(
    location:
      LocationRef,
  ): boolean {
    return (
      this.locationValue
        ?.locationId ===
      location.locationId
    );
  }

  /**
   * Move semanticamente o objeto para outra Location.
   *
   * Retorna true somente se houve alteração.
   */
  public relocate(
    location:
      LocationRef,
  ): boolean {
    if (
      this.isLocatedAt(
        location,
      )
    ) {
      return false;
    }

    this.locationValue =
      location;

    return true;
  }

  /**
   * Remove associação semântica de location.
   *
   * Útil para objetos guardados, destruídos logicamente ou ainda não
   * materializados no world. Retorna true somente quando havia location.
   */
  public clearLocation():
    boolean {
    if (
      this.locationValue ===
      null
    ) {
      return false;
    }

    this.locationValue = null;

    return true;
  }

  /**
   * Snapshot serializável e dimension-agnostic.
   *
   * Alocado somente sob demanda.
   */
  public toSnapshot():
    ObjectPropSnapshot {
    return {
      id: this.id,
      name: this.name,
      locationId:
        this.locationValue
          ?.locationId ??
        null,
      stateId:
        this.stateRef
          ?.stateId ??
        null,
    };
  }
}
