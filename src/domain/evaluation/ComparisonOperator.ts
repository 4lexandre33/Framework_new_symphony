import {
  domainErr,
  domainOk,
} from "./DomainResult";

import type {
  DomainResult,
} from "./DomainResult";

import {
  stateValueEquals,
} from "../state/StateValue";

import type {
  StateValue,
} from "../state/StateValue";

export type ComparisonOperator =
  | "equals"
  | "not-equals"
  | "greater-than"
  | "greater-or-equal"
  | "less-than"
  | "less-or-equal"
  | "contains";

export type ComparisonErrorCode =
  | "incompatible-operands";

export interface ComparisonError {
  readonly code:
    ComparisonErrorCode;
  readonly operator:
    ComparisonOperator;
  readonly leftKind:
    string;
  readonly rightKind:
    string;
}

function stateValueKind(
  value: StateValue,
): string {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  return typeof value;
}

function compareNumeric(
  left: StateValue,
  right: StateValue,
  operator:
    | "greater-than"
    | "greater-or-equal"
    | "less-than"
    | "less-or-equal",
): DomainResult<
  boolean,
  ComparisonError
> {
  if (
    typeof left !==
      "number" ||
    typeof right !==
      "number"
  ) {
    return domainErr({
      code:
        "incompatible-operands",
      operator,
      leftKind:
        stateValueKind(left),
      rightKind:
        stateValueKind(right),
    });
  }

  switch (operator) {
    case "greater-than":
      return domainOk(
        left > right,
      );

    case "greater-or-equal":
      return domainOk(
        left >= right,
      );

    case "less-than":
      return domainOk(
        left < right,
      );

    case "less-or-equal":
      return domainOk(
        left <= right,
      );
  }
}

function compareContains(
  left: StateValue,
  right: StateValue,
): DomainResult<
  boolean,
  ComparisonError
> {
  if (
    typeof left ===
      "string" &&
    typeof right ===
      "string"
  ) {
    return domainOk(
      left.includes(right),
    );
  }

  if (
    Array.isArray(left)
  ) {
    for (
      const item of left
    ) {
      if (
        stateValueEquals(
          item,
          right,
        )
      ) {
        return domainOk(
          true,
        );
      }
    }

    return domainOk(false);
  }

  return domainErr({
    code:
      "incompatible-operands",
    operator:
      "contains",
    leftKind:
      stateValueKind(left),
    rightKind:
      stateValueKind(right),
  });
}

/**
 * Comparação pura e determinística entre StateValues.
 *
 * - equals/not-equals: igualdade estrutural;
 * - ordering: somente number x number;
 * - contains:
 *   - string contém string;
 *   - array contém valor por igualdade estrutural.
 *
 * Comparações incompatíveis retornam DomainResult failure em vez de lançar.
 */
export function compareStateValues(
  left: StateValue,
  right: StateValue,
  operator:
    ComparisonOperator,
): DomainResult<
  boolean,
  ComparisonError
> {
  switch (operator) {
    case "equals":
      return domainOk(
        stateValueEquals(
          left,
          right,
        ),
      );

    case "not-equals":
      return domainOk(
        !stateValueEquals(
          left,
          right,
        ),
      );

    case "greater-than":
    case "greater-or-equal":
    case "less-than":
    case "less-or-equal":
      return compareNumeric(
        left,
        right,
        operator,
      );

    case "contains":
      return compareContains(
        left,
        right,
      );
  }
}
