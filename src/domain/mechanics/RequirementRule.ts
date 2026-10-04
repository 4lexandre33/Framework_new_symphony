import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

import {
  acceptGameplayRule,
  rejectGameplayRule,
} from "./GameplayRuleOutcome";

import type {
  GameplayRuleOutcome,
} from "./GameplayRuleOutcome";

export type RequirementRuleId =
  DomainId<
    "requirement-rule"
  >;

export type RequirementId =
  DomainId<"requirement">;

export type RequirementRuleMode =
  | "all"
  | "any";

export interface RequirementRuleCreateOptions {
  readonly id:
    RequirementRuleId;
  readonly mode?:
    RequirementRuleMode;
  readonly requirementIds:
    readonly RequirementId[];
}

export interface RequirementRuleResult {
  readonly ruleId:
    RequirementRuleId;
  readonly mode:
    RequirementRuleMode;
  readonly satisfiedCount:
    number;
  readonly totalCount:
    number;
}

export type RequirementRuleRejectionReason =
  | "requirements-unresolved"
  | "requirements-unsatisfied";

export interface RequirementRuleRejectionDetails {
  readonly requirementId:
    RequirementId | null;
}

export type RequirementRuleOutcome =
  GameplayRuleOutcome<
    RequirementRuleResult,
    RequirementRuleRejectionReason,
    RequirementRuleRejectionDetails
  >;

export type RequirementRuleErrorCode =
  | "empty-requirements"
  | "duplicate-requirement"
  | "invalid-mode"
  | "unknown-resolution";

export class RequirementRuleError
  extends Error {
  public readonly name =
    "RequirementRuleError";

  public constructor(
    public readonly code:
      RequirementRuleErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function createRequirementRuleId(
  value: string,
): RequirementRuleId {
  return createDomainId<
    "requirement-rule"
  >(value);
}

export function createRequirementId(
  value: string,
): RequirementId {
  return createDomainId<
    "requirement"
  >(value);
}

function isRequirementRuleMode(
  value: unknown,
): value is RequirementRuleMode {
  return (
    value === "all" ||
    value === "any"
  );
}

function compareRequirementId(
  left:
    RequirementId,
  right:
    RequirementId,
): number {
  return left < right
    ? -1
    : left > right
      ? 1
      : 0;
}

/**
 * Regra de requisitos baseada em facts booleanos já resolvidos.
 *
 * A origem desses facts é externa. Esta classe não conhece o avaliador
 * concreto responsável por produzi-los.
 */
export class RequirementRule {
  public readonly id:
    RequirementRuleId;

  public readonly mode:
    RequirementRuleMode;

  private readonly requirementIds:
    readonly RequirementId[];

  private readonly requirementSet =
    new Set<RequirementId>();

  public constructor(
    options:
      RequirementRuleCreateOptions,
  ) {
    if (
      options.requirementIds
        .length === 0
    ) {
      throw new RequirementRuleError(
        "empty-requirements",
        "RequirementRule exige ao menos um RequirementId.",
      );
    }

    const mode =
      options.mode ?? "all";

    if (
      !isRequirementRuleMode(
        mode,
      )
    ) {
      throw new RequirementRuleError(
        "invalid-mode",
        `RequirementRule.mode inválido: "${String(mode)}".`,
      );
    }

    const ids:
      RequirementId[] = [];

    for (
      const requirementId of
      options.requirementIds
    ) {
      if (
        this.requirementSet.has(
          requirementId,
        )
      ) {
        throw new RequirementRuleError(
          "duplicate-requirement",
          `RequirementId duplicado: "${requirementId}".`,
        );
      }

      this.requirementSet.add(
        requirementId,
      );

      ids.push(
        requirementId,
      );
    }

    ids.sort(
      compareRequirementId,
    );

    this.id = options.id;
    this.mode = mode;
    this.requirementIds =
      Object.freeze(ids);
  }

  public getRequirementIds():
    readonly RequirementId[] {
    return this.requirementIds;
  }

  public evaluate(
    resolutions:
      ReadonlyMap<
        RequirementId,
        boolean
      >,
  ): RequirementRuleOutcome {
    for (
      const resolutionId of
      resolutions.keys()
    ) {
      if (
        !this.requirementSet.has(
          resolutionId,
        )
      ) {
        throw new RequirementRuleError(
          "unknown-resolution",
          `Resolution desconhecida: "${resolutionId}".`,
        );
      }
    }

    let satisfiedCount =
      0;

    for (
      const requirementId of
      this.requirementIds
    ) {
      const resolution =
        resolutions.get(
          requirementId,
        );

      if (
        resolution ===
        undefined
      ) {
        return rejectGameplayRule(
          "requirements-unresolved",
          Object.freeze({
            requirementId,
          }),
        );
      }

      if (resolution) {
        satisfiedCount += 1;
      }
    }

    const satisfied =
      this.mode === "all"
        ? satisfiedCount ===
          this.requirementIds
            .length
        : satisfiedCount > 0;

    if (!satisfied) {
      return rejectGameplayRule(
        "requirements-unsatisfied",
        Object.freeze({
          requirementId: null,
        }),
      );
    }

    return acceptGameplayRule(
      Object.freeze({
        ruleId: this.id,
        mode: this.mode,
        satisfiedCount,
        totalCount:
          this.requirementIds
            .length,
      }),
    );
  }
}
