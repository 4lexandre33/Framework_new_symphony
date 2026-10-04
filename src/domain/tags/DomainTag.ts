const MAX_DOMAIN_TAG_LENGTH =
  128;

const DOMAIN_TAG_PATTERN =
  /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?)*$/u;

declare const DOMAIN_TAG_BRAND:
  unique symbol;

/**
 * Tag semântica canônica.
 *
 * Runtime = string.
 * Brand existe somente em compile-time.
 */
export type DomainTag =
  string & {
    readonly [
      DOMAIN_TAG_BRAND
    ]: "domain-tag";
  };

export type DomainTagErrorCode =
  | "invalid-type"
  | "empty-tag"
  | "tag-too-long"
  | "invalid-format";

export class DomainTagError
  extends Error {
  public readonly name =
    "DomainTagError";

  public constructor(
    public readonly code:
      DomainTagErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Normalização canônica:
 * - Unicode NFKC;
 * - trim nas extremidades;
 * - lowercase;
 * - "_" vira "-";
 * - whitespace dentro de cada segmento vira "-";
 * - hífens repetidos colapsam;
 * - "." separa namespaces/segmentos.
 *
 * Exemplos:
 * " Combat.Fire Damage " -> "combat.fire-damage"
 * "ITEM_WEAPON" -> "item-weapon"
 *
 * A função rejeita caracteres fora de ASCII alfanumérico, "." e "-".
 */
export function normalizeDomainTagValue(
  value: string,
): string {
  if (typeof value !== "string") {
    throw new DomainTagError(
      "invalid-type",
      "DomainTag deve ser uma string.",
    );
  }

  const normalizedUnicode =
    value.normalize("NFKC");

  const rawSegments =
    normalizedUnicode
      .trim()
      .toLowerCase()
      .split(".");

  if (
    rawSegments.length === 1 &&
    rawSegments[0] === ""
  ) {
    throw new DomainTagError(
      "empty-tag",
      "DomainTag não pode ser vazia.",
    );
  }

  const normalizedSegments:
    string[] = [];

  for (
    const rawSegment of
    rawSegments
  ) {
    const segment =
      rawSegment
        .trim()
        .replace(
          /[\s_]+/gu,
          "-",
        )
        .replace(
          /-+/gu,
          "-",
        );

    if (segment.length === 0) {
      throw new DomainTagError(
        "invalid-format",
        "DomainTag não pode conter segmentos vazios.",
      );
    }

    normalizedSegments.push(
      segment,
    );
  }

  const normalized =
    normalizedSegments.join(
      ".",
    );

  if (
    normalized.length >
    MAX_DOMAIN_TAG_LENGTH
  ) {
    throw new DomainTagError(
      "tag-too-long",
      `DomainTag deve ter no máximo ${String(MAX_DOMAIN_TAG_LENGTH)} caracteres após normalização.`,
    );
  }

  if (
    !DOMAIN_TAG_PATTERN.test(
      normalized,
    )
  ) {
    throw new DomainTagError(
      "invalid-format",
      'DomainTag aceita apenas ASCII lowercase, dígitos, "-" interno e "." entre segmentos.',
    );
  }

  return normalized;
}

export function createDomainTag(
  value: string,
): DomainTag {
  return normalizeDomainTagValue(
    value,
  ) as DomainTag;
}

export function isCanonicalDomainTagValue(
  value: unknown,
): value is DomainTag {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length >
      MAX_DOMAIN_TAG_LENGTH ||
    !DOMAIN_TAG_PATTERN.test(
      value,
    )
  ) {
    return false;
  }

  try {
    return (
      normalizeDomainTagValue(
        value,
      ) === value
    );
  } catch {
    return false;
  }
}

export function domainTagToString(
  tag: DomainTag,
): string {
  return tag;
}
