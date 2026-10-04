import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

import type {
  MovementIntent,
  MovementModeId,
} from "./MovementRule";

import {
  acceptGameplayRule,
  rejectGameplayRule,
} from "./GameplayRuleOutcome";

import type {
  GameplayRuleOutcome,
} from "./GameplayRuleOutcome";

export type TraversalRuleId =
  DomainId<
    "traversal-rule"
  >;

export type TraversalCapabilityId =
  DomainId<
    "traversal-capability"
  >;

export interface TraversalRuleCreateOptions {
  readonly id:
    TraversalRuleId;
  readonly allowedModeIds:
    readonly MovementModeId[];
  readonly requiredCapabilityIds?:
    readonly TraversalCapabilityId[];
}

export interface TraversalRuleResult {
  readonly ruleId:
    TraversalRuleId;
  readonly intent:
    MovementIntent;
}

export type TraversalRuleRejectionReason =
  | "unsupported-movement-mode"
  | "missing-traversal-capability";

export interface UnsupportedMovementModeDetails {
  readonly modeId:
    MovementModeId;
}

export interface MissingTraversalCapabilityDetails {
  readonly capabilityId:
    TraversalCapabilityId;
}

export type TraversalRuleRejectionDetails =
  | UnsupportedMovementModeDetails
  | MissingTraversalCapabilityDetails;

export type TraversalRuleOutcome =
  GameplayRuleOutcome<
    TraversalRuleResult,
    TraversalRuleRejectionReason,
    TraversalRuleRejectionDetails
  >;

export type TraversalRuleErrorCode =
  | "empty-movement-modes"
  | "duplicate-movement-mode"
  | "duplicate-capability";

export class TraversalRuleError
  extends Error {
  public readonly name =
    "TraversalRuleError";

  public constructor(
    public readonly code:
      TraversalRuleErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function createTraversalRuleId(
  value: string,
): TraversalRuleId {
  return createDomainId<
    "traversal-rule"
  >(value);
}

export function createTraversalCapabilityId(
  value: string,
): TraversalCapabilityId {
  return createDomainId<
    "traversal-capability"
  >(value);
}

function compareIds(
  left: string,
  right: string,
): number {
  return left < right
    ? -1
    : left > right
      ? 1
      : 0;
}

/**
 * Regra semântica de autorização de traversal.
 *
 * Não executa pathfinding, colisão ou deslocamento.
 */
export class TraversalRule {
  public readonly id:
    TraversalRuleId;

  private readonly allowedModeIds:
    readonly MovementModeId[];

  private readonly allowedModeSet =
    new Set<MovementModeId>();

  private readonly requiredCapabilityIds:
    readonly TraversalCapabilityId[];

  public constructor(
    options:
      TraversalRuleCreateOptions,
  ) {
    if (
      options.allowedModeIds
        .length === 0
    ) {
      throw new TraversalRuleError(
        "empty-movement-modes",
        "TraversalRule exige ao menos um MovementModeId.",
      );
    }

    const modes:
      MovementModeId[] = [];

    for (
      const modeId of
      options.allowedModeIds
    ) {
      if (
        this.allowedModeSet.has(
          modeId,
        )
      ) {
        throw new TraversalRuleError(
          "duplicate-movement-mode",
          `MovementModeId duplicado: "${modeId}".`,
        );
      }

      this.allowedModeSet.add(
        modeId,
      );

      modes.push(modeId);
    }

    modes.sort(
      compareIds,
    );

    const capabilitySet =
      new Set<
        TraversalCapabilityId
      >();

    const capabilities:
      TraversalCapabilityId[] =
        [];

    for (
      const capabilityId of
      options
        .requiredCapabilityIds ??
      []
    ) {
      if (
        capabilitySet.has(
          capabilityId,
        )
      ) {
        throw new TraversalRuleError(
          "duplicate-capability",
          `TraversalCapabilityId duplicado: "${capabilityId}".`,
        );
      }

      capabilitySet.add(
        capabilityId,
      );

      capabilities.push(
        capabilityId,
      );
    }

    capabilities.sort(
      compareIds,
    );

    this.id = options.id;
    this.allowedModeIds =
      Object.freeze(modes);
    this.requiredCapabilityIds =
      Object.freeze(
        capabilities,
      );
  }

  public getAllowedModeIds():
    readonly MovementModeId[] {
    return this.allowedModeIds;
  }

  public getRequiredCapabilityIds():
    readonly TraversalCapabilityId[] {
    return this
      .requiredCapabilityIds;
  }

  public evaluate(
    intent:
      MovementIntent,
    capabilities:
      ReadonlySet<
        TraversalCapabilityId
      >,
  ): TraversalRuleOutcome {
    if (
      !this.allowedModeSet.has(
        intent.modeId,
      )
    ) {
      return rejectGameplayRule(
        "unsupported-movement-mode",
        Object.freeze({
          modeId:
            intent.modeId,
        }),
      );
    }

    for (
      const capabilityId of
      this.requiredCapabilityIds
    ) {
      if (
        !capabilities.has(
          capabilityId,
        )
      ) {
        return rejectGameplayRule(
          "missing-traversal-capability",
          Object.freeze({
            capabilityId,
          }),
        );
      }
    }

    return acceptGameplayRule(
      Object.freeze({
        ruleId: this.id,
        intent,
      }),
    );
  }
}
