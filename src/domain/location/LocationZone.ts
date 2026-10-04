import type {
  LocationRef,
} from "./LocationRef";

import {
  createLocationRef,
} from "./LocationRef";

import type {
  LocationId,
} from "./LocationId";

export interface LocationZoneCreateOptions {
  readonly id: LocationId;
  readonly name: string;
}

export interface LocationZoneSnapshot {
  readonly id: LocationId;
  readonly name: string;
}

export type LocationZoneErrorCode =
  | "invalid-name";

export class LocationZoneError
  extends Error {
  public readonly name =
    "LocationZoneError";

  public constructor(
    public readonly code:
      LocationZoneErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const MAX_LOCATION_NAME_LENGTH =
  160;

function assertName(
  name: string,
): void {
  if (
    name.length === 0 ||
    name.length >
      MAX_LOCATION_NAME_LENGTH ||
    name !== name.trim()
  ) {
    throw new LocationZoneError(
      "invalid-name",
      "LocationZone.name deve ser não vazio, sem whitespace nas extremidades e ter no máximo 160 caracteres.",
    );
  }
}

/**
 * Nó semântico imutável de localização.
 *
 * Não contém x/y/z, transform, tile, mesh, collider, scene node ou qualquer
 * representação física. A infraestrutura decide como um LocationId é
 * materializado em 2D, 2.5D ou 3D.
 */
export class LocationZone {
  public readonly id:
    LocationId;

  public readonly name:
    string;

  public constructor(
    options:
      LocationZoneCreateOptions,
  ) {
    assertName(options.name);

    this.id = options.id;
    this.name = options.name;
  }

  public toRef():
    LocationRef {
    return createLocationRef(
      this.id,
    );
  }

  public toSnapshot():
    LocationZoneSnapshot {
    return {
      id: this.id,
      name: this.name,
    };
  }
}
