export type DomainSuccess<
  TValue,
> = {
  readonly ok: true;
  readonly value: TValue;
};

export type DomainFailure<
  TError,
> = {
  readonly ok: false;
  readonly error: TError;
};

export type DomainResult<
  TValue,
  TError,
> =
  | DomainSuccess<TValue>
  | DomainFailure<TError>;

export function domainOk<
  TValue,
>(
  value: TValue,
): DomainSuccess<TValue> {
  return {
    ok: true,
    value,
  };
}

export function domainErr<
  TError,
>(
  error: TError,
): DomainFailure<TError> {
  return {
    ok: false,
    error,
  };
}

export function mapDomainResult<
  TValue,
  TError,
  TMapped,
>(
  result: DomainResult<
    TValue,
    TError
  >,
  mapper: (
    value: TValue,
  ) => TMapped,
): DomainResult<TMapped, TError> {
  if (!result.ok) {
    return result;
  }

  return domainOk(
    mapper(result.value),
  );
}

export function flatMapDomainResult<
  TValue,
  TError,
  TMapped,
>(
  result: DomainResult<
    TValue,
    TError
  >,
  mapper: (
    value: TValue,
  ) => DomainResult<
    TMapped,
    TError
  >,
): DomainResult<TMapped, TError> {
  if (!result.ok) {
    return result;
  }

  return mapper(result.value);
}
