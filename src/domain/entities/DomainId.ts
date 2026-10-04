const MAX_DOMAIN_ID_LENGTH = 128;

declare const DOMAIN_ID_BRAND: unique symbol;

/**
 * Identificador nominal e serializável do domínio.
 *
 * TKind existe somente em compile-time e permite impedir que IDs de categorias
 * diferentes sejam misturados acidentalmente. O valor runtime continua sendo
 * uma string, portanto não há wrapper/objeto extra em memória.
 */
export type DomainId<TKind extends string> =
  string & {
    readonly [DOMAIN_ID_BRAND]: TKind;
  };

export class DomainIdValidationError
  extends Error {
  public readonly name =
    "DomainIdValidationError";

  public constructor(
    message: string,
  ) {
    super(message);
  }
}

function containsControlCharacter(
  value: string,
): boolean {
  for (
    let index = 0;
    index < value.length;
    index += 1
  ) {
    const code =
      value.charCodeAt(index);

    if (
      code <= 0x1f ||
      code === 0x7f
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Valida um ID sem normalizar silenciosamente o valor recebido.
 *
 * Regras deliberadamente mínimas:
 * - string não vazia;
 * - sem whitespace nas extremidades;
 * - até 128 UTF-16 code units;
 * - sem caracteres de controle.
 *
 * Não impõe UUID, ASCII, path, Steam ID ou qualquer formato de plataforma.
 */
export function isDomainIdValue(
  value: unknown,
): value is string {
  if (typeof value !== "string") {
    return false;
  }

  if (
    value.length === 0 ||
    value.length >
      MAX_DOMAIN_ID_LENGTH
  ) {
    return false;
  }

  if (value !== value.trim()) {
    return false;
  }

  return !containsControlCharacter(
    value,
  );
}

export function createDomainId<
  TKind extends string,
>(
  value: string,
): DomainId<TKind> {
  if (!isDomainIdValue(value)) {
    throw new DomainIdValidationError(
      "DomainId deve ser não vazio, não possuir whitespace nas extremidades, " +
        `ter no máximo ${MAX_DOMAIN_ID_LENGTH} caracteres e não conter controles.`,
    );
  }

  return value as DomainId<TKind>;
}

export function domainIdToString<
  TKind extends string,
>(
  id: DomainId<TKind>,
): string {
  return id;
}
