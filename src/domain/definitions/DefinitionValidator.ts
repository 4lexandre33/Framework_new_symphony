import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

import type {
  DefinitionId,
  DefinitionKindId,
} from "./DefinitionId";

export type DefinitionValidatorId =
  DomainId<
    "definition-validator"
  >;

export interface DefinitionValidationContext<
  TDefinition,
> {
  readonly kindId:
    DefinitionKindId;
  readonly definitionId:
    DefinitionId;
  readonly value:
    Readonly<TDefinition>;
}

export interface DefinitionValidationFinding {
  readonly code:
    string;
  readonly message:
    string;
}

export interface DefinitionValidationIssue
  extends DefinitionValidationFinding {
  readonly validatorId:
    DefinitionValidatorId;
  readonly kindId:
    DefinitionKindId;
  readonly definitionId:
    DefinitionId;
}

export interface DefinitionValidator<
  TDefinition,
> {
  readonly id:
    DefinitionValidatorId;
  validate(
    context:
      DefinitionValidationContext<TDefinition>,
  ): readonly DefinitionValidationFinding[];
}

export type DefinitionValidatorErrorCode =
  | "invalid-finding-code"
  | "invalid-finding-message";

export class DefinitionValidatorError
  extends Error {
  public readonly name =
    "DefinitionValidatorError";

  public constructor(
    public readonly code:
      DefinitionValidatorErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const MAX_FINDING_CODE_LENGTH =
  128;

const MAX_FINDING_MESSAGE_LENGTH =
  2_048;

export function createDefinitionValidatorId(
  value: string,
): DefinitionValidatorId {
  return createDomainId<
    "definition-validator"
  >(value);
}

function assertFindingText(
  value: string,
  maxLength: number,
  code:
    DefinitionValidatorErrorCode,
  label: string,
): void {
  if (
    value.length === 0 ||
    value.length > maxLength ||
    value !== value.trim()
  ) {
    throw new DefinitionValidatorError(
      code,
      `${label} deve ser não vazio, sem whitespace nas extremidades e ter no máximo ${String(maxLength)} caracteres.`,
    );
  }
}

function compareIssue(
  left:
    DefinitionValidationIssue,
  right:
    DefinitionValidationIssue,
): number {
  if (
    left.definitionId !==
    right.definitionId
  ) {
    return left.definitionId <
      right.definitionId
      ? -1
      : 1;
  }

  if (
    left.validatorId !==
    right.validatorId
  ) {
    return left.validatorId <
      right.validatorId
      ? -1
      : 1;
  }

  if (left.code !== right.code) {
    return left.code < right.code
      ? -1
      : 1;
  }

  return left.message <
    right.message
    ? -1
    : left.message >
        right.message
      ? 1
      : 0;
}

/**
 * Executa validators puros sobre uma definição e normaliza issues.
 */
export function runDefinitionValidators<
  TDefinition,
>(
  validators:
    readonly DefinitionValidator<TDefinition>[],
  context:
    DefinitionValidationContext<TDefinition>,
): readonly DefinitionValidationIssue[] {
  const issues:
    DefinitionValidationIssue[] =
      [];

  for (
    const validator of validators
  ) {
    const findings =
      validator.validate(
        context,
      );

    for (
      const finding of
      findings
    ) {
      assertFindingText(
        finding.code,
        MAX_FINDING_CODE_LENGTH,
        "invalid-finding-code",
        "finding.code",
      );

      assertFindingText(
        finding.message,
        MAX_FINDING_MESSAGE_LENGTH,
        "invalid-finding-message",
        "finding.message",
      );

      issues.push(
        Object.freeze({
          validatorId:
            validator.id,
          kindId:
            context.kindId,
          definitionId:
            context.definitionId,
          code:
            finding.code,
          message:
            finding.message,
        }),
      );
    }
  }

  issues.sort(compareIssue);

  return Object.freeze(issues);
}
