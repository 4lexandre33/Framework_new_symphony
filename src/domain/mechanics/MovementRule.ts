import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

export type MovementEndpointId =
  DomainId<
    "movement-endpoint"
  >;

export type MovementModeId =
  DomainId<"movement-mode">;

export interface MovementIntent {
  readonly from:
    MovementEndpointId;
  readonly to:
    MovementEndpointId;
  readonly modeId:
    MovementModeId;
}

export type MovementRuleErrorCode =
  "same-endpoint";

export class MovementRuleError
  extends Error {
  public readonly name =
    "MovementRuleError";

  public constructor(
    public readonly code:
      MovementRuleErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function createMovementEndpointId(
  value: string,
): MovementEndpointId {
  return createDomainId<
    "movement-endpoint"
  >(value);
}

export function createMovementModeId(
  value: string,
): MovementModeId {
  return createDomainId<
    "movement-mode"
  >(value);
}

/**
 * Intent semântico de movimento.
 *
 * Endpoints são IDs opacos. Eles podem representar áreas, nós lógicos,
 * setores ou outros conceitos sem codificar coordenadas.
 */
export function createMovementIntent(
  from:
    MovementEndpointId,
  to:
    MovementEndpointId,
  modeId:
    MovementModeId,
): MovementIntent {
  if (from === to) {
    throw new MovementRuleError(
      "same-endpoint",
      "MovementIntent exige endpoints distintos.",
    );
  }

  return Object.freeze({
    from,
    to,
    modeId,
  });
}
