import {
  createDomainTag,
} from "./DomainTag";

import type {
  DomainTag,
} from "./DomainTag";

export interface TagSetSnapshot {
  readonly tags:
    readonly string[];
}

export type TagSetErrorCode =
  | "duplicate-tag"
  | "invalid-snapshot";

export class TagSetError
  extends Error {
  public readonly name =
    "TagSetError";

  public constructor(
    public readonly code:
      TagSetErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function compareDomainTag(
  left: DomainTag,
  right: DomainTag,
): number {
  return left < right
    ? -1
    : left > right
      ? 1
      : 0;
}

/**
 * Set runtime de DomainTag.
 *
 * Operações comuns usam Set e não materializam arrays.
 * Ordenação/alocação ocorre somente em APIs explicitamente materializadoras.
 */
export class TagSet {
  private readonly tags =
    new Set<DomainTag>();

  public constructor(
    initial:
      readonly DomainTag[] = [],
  ) {
    for (
      const tag of initial
    ) {
      if (
        this.tags.has(tag)
      ) {
        throw new TagSetError(
          "duplicate-tag",
          `DomainTag duplicada: "${tag}".`,
        );
      }

      this.tags.add(tag);
    }
  }

  /**
   * Constrói a partir de strings brutas, aplicando normalização.
   *
   * Valores diferentes que normalizam para a mesma tag são considerados
   * duplicados e causam erro de autoria.
   */
  public static fromValues(
    values:
      readonly string[],
  ): TagSet {
    const tags:
      DomainTag[] = [];

    const seen =
      new Set<DomainTag>();

    for (
      const value of values
    ) {
      const tag =
        createDomainTag(value);

      if (seen.has(tag)) {
        throw new TagSetError(
          "duplicate-tag",
          `Valores normalizam para a mesma DomainTag: "${tag}".`,
        );
      }

      seen.add(tag);
      tags.push(tag);
    }

    return new TagSet(tags);
  }

  public static fromSnapshot(
    snapshot:
      TagSetSnapshot,
  ): TagSet {
    try {
      return TagSet.fromValues(
        snapshot.tags,
      );
    } catch (error) {
      throw new TagSetError(
        "invalid-snapshot",
        `TagSetSnapshot inválido: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }
  }

  public get size():
    number {
    return this.tags.size;
  }

  public get isEmpty():
    boolean {
    return this.tags.size === 0;
  }

  public has(
    tag: DomainTag,
  ): boolean {
    return this.tags.has(tag);
  }

  public hasValue(
    value: string,
  ): boolean {
    return this.tags.has(
      createDomainTag(value),
    );
  }

  /**
   * Retorna true somente em inserção nova.
   */
  public add(
    tag: DomainTag,
  ): boolean {
    const before =
      this.tags.size;

    this.tags.add(tag);

    return (
      this.tags.size >
      before
    );
  }

  public addValue(
    value: string,
  ): boolean {
    return this.add(
      createDomainTag(value),
    );
  }

  /**
   * Retorna true somente quando a tag existia.
   */
  public delete(
    tag: DomainTag,
  ): boolean {
    return this.tags.delete(tag);
  }

  public deleteValue(
    value: string,
  ): boolean {
    return this.delete(
      createDomainTag(value),
    );
  }

  public clear(): void {
    this.tags.clear();
  }

  public containsAll(
    required:
      ReadonlySet<DomainTag>,
  ): boolean {
    for (
      const tag of required
    ) {
      if (!this.tags.has(tag)) {
        return false;
      }
    }

    return true;
  }

  public containsAny(
    candidates:
      ReadonlySet<DomainTag>,
  ): boolean {
    for (
      const tag of candidates
    ) {
      if (this.tags.has(tag)) {
        return true;
      }
    }

    return false;
  }

  public equals(
    other: TagSet,
  ): boolean {
    if (
      this.size !== other.size
    ) {
      return false;
    }

    for (
      const tag of this.tags
    ) {
      if (!other.has(tag)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Set operation discreta. Retorna nova instância.
   */
  public union(
    other: TagSet,
  ): TagSet {
    const result =
      new TagSet();

    for (
      const tag of this.tags
    ) {
      result.tags.add(tag);
    }

    for (
      const tag of
      other.tags
    ) {
      result.tags.add(tag);
    }

    return result;
  }

  /**
   * Set operation discreta. Retorna nova instância.
   */
  public intersection(
    other: TagSet,
  ): TagSet {
    const result =
      new TagSet();

    const iterate =
      this.size <= other.size
        ? this
        : other;

    const lookup =
      iterate === this
        ? other
        : this;

    for (
      const tag of
      iterate.tags
    ) {
      if (lookup.has(tag)) {
        result.tags.add(tag);
      }
    }

    return result;
  }

  /**
   * Tags presentes nesta instância e ausentes em other.
   */
  public difference(
    other: TagSet,
  ): TagSet {
    const result =
      new TagSet();

    for (
      const tag of this.tags
    ) {
      if (!other.has(tag)) {
        result.tags.add(tag);
      }
    }

    return result;
  }

  /**
   * Iteração sem alocação intermediária.
   *
   * A ordem é a ordem de inserção do Set. Para ordem canônica, use toArray().
   */
  public forEach(
    visitor: (
      tag: DomainTag,
    ) => void,
  ): void {
    for (
      const tag of this.tags
    ) {
      visitor(tag);
    }
  }

  /**
   * Materialização canônica sob demanda.
   */
  public toArray():
    readonly DomainTag[] {
    return Object.freeze(
      [...this.tags]
        .sort(
          compareDomainTag,
        ),
    );
  }

  public toSnapshot():
    TagSetSnapshot {
    return Object.freeze({
      tags:
        Object.freeze(
          this.toArray().map(
            (tag) => tag,
          ),
        ),
    });
  }
}
