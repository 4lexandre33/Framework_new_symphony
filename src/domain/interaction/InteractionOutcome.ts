import type {
  Affordance,
} from "./Affordance";

import type {
  InteractionIntent,
} from "./InteractionIntent";

import type {
  InteractionRequirementId,
  InteractionRequirementResolution,
} from "./InteractionRequirement";

export type InteractionRejectionReason =
  | "unsupported-interaction"
  | "requirements-unresolved"
  | "requirements-unsatisfied";

export interface InteractionAcceptedOutcome {
  readonly accepted:
    true;
  readonly intent:
    InteractionIntent;
}

export interface InteractionRejectedOutcome {
  readonly accepted:
    false;
  readonly intent:
    InteractionIntent;
  readonly reason:
    InteractionRejectionReason;
  readonly requirementIds:
    readonly InteractionRequirementId[];
}

export type InteractionOutcome =
  | InteractionAcceptedOutcome
  | InteractionRejectedOutcome;

export type InteractionOutcomeErrorCode =
  | "duplicate-resolution"
  | "unknown-resolution";

export class InteractionOutcomeError
  extends Error {
  public readonly name =
    "InteractionOutcomeError";

  public constructor(
    public readonly code:
      InteractionOutcomeErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function rejected(
  intent:
    InteractionIntent,
  reason:
    InteractionRejectionReason,
  requirementIds:
    readonly InteractionRequirementId[] =
      [],
): InteractionRejectedOutcome {
  return Object.freeze({
    accepted: false,
    intent,
    reason,
    requirementIds:
      Object.freeze(
        [...requirementIds],
      ),
  });
}

/**
 * Resolve somente disponibilidade/autorização semântica.
 *
 * Não executa a ação. Nenhum item é removido, porta aberta, diálogo iniciado
 * ou estado alterado aqui.
 *
 * Resoluções vêm de fora. Na Etapa 62 elas poderão ser produzidas a partir de
 * Conditions sem que Interaction precise conhecer o avaliador concreto agora.
 */
export function resolveInteractionOutcome(
  intent:
    InteractionIntent,
  affordance:
    Affordance,
  resolutions:
    readonly InteractionRequirementResolution[] =
      [],
): InteractionOutcome {
  if (
    !affordance.supports(
      intent,
    )
  ) {
    return rejected(
      intent,
      "unsupported-interaction",
    );
  }

  const requirements =
    affordance
      .getRequirements();

  if (
    requirements.length ===
    0
  ) {
    if (
      resolutions.length >
      0
    ) {
      throw new InteractionOutcomeError(
        "unknown-resolution",
        "Affordance sem requisitos recebeu resoluções desconhecidas.",
      );
    }

    return Object.freeze({
      accepted: true,
      intent,
    });
  }

  const resolutionById =
    new Map<
      InteractionRequirementId,
      boolean
    >();

  for (
    const resolution of
    resolutions
  ) {
    if (
      resolutionById.has(
        resolution.requirementId,
      )
    ) {
      throw new InteractionOutcomeError(
        "duplicate-resolution",
        `Resolution duplicada para "${resolution.requirementId}".`,
      );
    }

    if (
      !affordance.hasRequirement(
        resolution.requirementId,
      )
    ) {
      throw new InteractionOutcomeError(
        "unknown-resolution",
        `Resolution desconhecida para "${resolution.requirementId}".`,
      );
    }

    resolutionById.set(
      resolution.requirementId,
      resolution.satisfied,
    );
  }

  const missing:
    InteractionRequirementId[] =
      [];

  const unsatisfied:
    InteractionRequirementId[] =
      [];

  for (
    const requirement of
    requirements
  ) {
    const resolved =
      resolutionById.get(
        requirement.id,
      );

    if (
      resolved === undefined
    ) {
      missing.push(
        requirement.id,
      );
      continue;
    }

    if (!resolved) {
      unsatisfied.push(
        requirement.id,
      );
    }
  }

  if (
    missing.length >
    0
  ) {
    return rejected(
      intent,
      "requirements-unresolved",
      missing,
    );
  }

  if (
    unsatisfied.length >
    0
  ) {
    return rejected(
      intent,
      "requirements-unsatisfied",
      unsatisfied,
    );
  }

  return Object.freeze({
    accepted: true,
    intent,
  });
}
