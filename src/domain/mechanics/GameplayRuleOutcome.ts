export interface AcceptedGameplayRule<
  TValue,
> {
  readonly accepted: true;
  readonly value: TValue;
}

export interface RejectedGameplayRule<
  TReason extends string,
  TDetails,
> {
  readonly accepted: false;
  readonly reason: TReason;
  readonly details: TDetails;
}

export type GameplayRuleOutcome<
  TValue,
  TReason extends string,
  TDetails = null,
> =
  | AcceptedGameplayRule<TValue>
  | RejectedGameplayRule<
      TReason,
      TDetails
    >;

export function acceptGameplayRule<
  TValue,
>(
  value: TValue,
): AcceptedGameplayRule<TValue> {
  return Object.freeze({
    accepted: true,
    value,
  });
}

export function rejectGameplayRule<
  TReason extends string,
  TDetails,
>(
  reason: TReason,
  details: TDetails,
): RejectedGameplayRule<
  TReason,
  TDetails
> {
  return Object.freeze({
    accepted: false,
    reason,
    details,
  });
}
