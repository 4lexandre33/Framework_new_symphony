declare const DOMAIN_DURATION_BRAND:
  unique symbol;

export type DomainDuration =
  number & {
    readonly [DOMAIN_DURATION_BRAND]:
      "DomainDuration";
  };

export type DomainDurationErrorCode =
  | "invalid-duration"
  | "duration-overflow";

export class DomainDurationError
  extends Error {
  public readonly name =
    "DomainDurationError";

  public constructor(
    public readonly code:
      DomainDurationErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function assertDomainDurationValue(
  value: number,
): void {
  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value < 0
  ) {
    throw new DomainDurationError(
      "invalid-duration",
      "DomainDuration deve ser um inteiro seguro maior ou igual a 0.",
    );
  }
}

export function createDomainDuration(
  ticks: number,
): DomainDuration {
  assertDomainDurationValue(
    ticks,
  );

  return ticks as DomainDuration;
}

export function domainDurationToTicks(
  duration:
    DomainDuration,
): number {
  return duration;
}

export function addDomainDurations(
  left: DomainDuration,
  right: DomainDuration,
): DomainDuration {
  const next =
    left + right;

  if (
    !Number.isSafeInteger(next)
  ) {
    throw new DomainDurationError(
      "duration-overflow",
      "DomainDuration excedeu o limite de inteiro seguro.",
    );
  }

  return next as DomainDuration;
}

export function subtractDomainDurations(
  left: DomainDuration,
  right: DomainDuration,
): DomainDuration {
  const next =
    left - right;

  if (next < 0) {
    return 0 as DomainDuration;
  }

  return next as DomainDuration;
}
