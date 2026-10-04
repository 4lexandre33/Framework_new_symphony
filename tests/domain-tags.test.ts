// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createDomainTag,
  DomainTagError,
  isCanonicalDomainTagValue,
  normalizeDomainTagValue,
  TagSet,
  TagSetError,
} from "../src/domain/tags";

describe(
  "Etapa 61 — DomainTag",
  () => {
    it(
      "normaliza case, whitespace, underscore e namespaces",
      () => {
        expect(
          normalizeDomainTagValue(
            "  Combat.Fire Damage  ",
          ),
        ).toBe(
          "combat.fire-damage",
        );

        expect(
          createDomainTag(
            "ITEM_WEAPON",
          ),
        ).toBe(
          "item-weapon",
        );

        expect(
          createDomainTag(
            "Biome. Deep__Forest ",
          ),
        ).toBe(
          "biome.deep-forest",
        );
      },
    );

    it(
      "reconhece apenas valor já canônico",
      () => {
        expect(
          isCanonicalDomainTagValue(
            "combat.fire-damage",
          ),
        ).toBe(true);

        expect(
          isCanonicalDomainTagValue(
            "Combat.Fire Damage",
          ),
        ).toBe(false);

        expect(
          isCanonicalDomainTagValue(
            "combat_fire",
          ),
        ).toBe(false);
      },
    );

    it(
      "rejeita segmentos vazios e caracteres fora do formato",
      () => {
        expect(() =>
          createDomainTag(
            "combat..fire",
          ),
        ).toThrow(
          DomainTagError,
        );

        expect(() =>
          createDomainTag(
            ".combat",
          ),
        ).toThrow(
          DomainTagError,
        );

        expect(() =>
          createDomainTag(
            "combat@fire",
          ),
        ).toThrow(
          DomainTagError,
        );

        expect(() =>
          createDomainTag(
            "combat.-fire",
          ),
        ).toThrow(
          DomainTagError,
        );
      },
    );

    it(
      "NFKC normaliza formas compatíveis antes da validação",
      () => {
        expect(
          createDomainTag(
            "ＦＩＲＥ",
          ),
        ).toBe("fire");
      },
    );
  },
);

describe(
  "Etapa 61 — TagSet",
  () => {
    it(
      "fromValues normaliza e cria set",
      () => {
        const set =
          TagSet.fromValues([
            "Combat.Fire",
            " item.weapon ",
          ]);

        expect(set.size).toBe(2);

        expect(
          set.hasValue(
            "combat.fire",
          ),
        ).toBe(true);

        expect(
          set.has(
            createDomainTag(
              "item.weapon",
            ),
          ),
        ).toBe(true);
      },
    );

    it(
      "rejeita colisão após normalização",
      () => {
        expect(() =>
          TagSet.fromValues([
            "Combat.Fire",
            " combat.fire ",
          ]),
        ).toThrow(
          TagSetError,
        );
      },
    );

    it(
      "add/delete são idempotentes",
      () => {
        const set =
          new TagSet();

        const fire =
          createDomainTag(
            "combat.fire",
          );

        expect(
          set.add(fire),
        ).toBe(true);

        expect(
          set.add(fire),
        ).toBe(false);

        expect(
          set.delete(fire),
        ).toBe(true);

        expect(
          set.delete(fire),
        ).toBe(false);
      },
    );

    it(
      "containsAll e containsAny não alteram o set",
      () => {
        const set =
          TagSet.fromValues([
            "a.one",
            "b.two",
          ]);

        const required =
          new Set([
            createDomainTag(
              "a.one",
            ),
            createDomainTag(
              "b.two",
            ),
          ]);

        const candidates =
          new Set([
            createDomainTag(
              "missing",
            ),
            createDomainTag(
              "b.two",
            ),
          ]);

        expect(
          set.containsAll(
            required,
          ),
        ).toBe(true);

        expect(
          set.containsAny(
            candidates,
          ),
        ).toBe(true);

        expect(set.size).toBe(2);
      },
    );

    it(
      "union/intersection/difference preservam operands",
      () => {
        const left =
          TagSet.fromValues([
            "a",
            "b",
          ]);

        const right =
          TagSet.fromValues([
            "b",
            "c",
          ]);

        expect(
          left
            .union(right)
            .toArray(),
        ).toEqual([
          "a",
          "b",
          "c",
        ]);

        expect(
          left
            .intersection(right)
            .toArray(),
        ).toEqual([
          "b",
        ]);

        expect(
          left
            .difference(right)
            .toArray(),
        ).toEqual([
          "a",
        ]);

        expect(
          left.toArray(),
        ).toEqual([
          "a",
          "b",
        ]);

        expect(
          right.toArray(),
        ).toEqual([
          "b",
          "c",
        ]);
      },
    );

    it(
      "equals ignora ordem de inserção",
      () => {
        const left =
          TagSet.fromValues([
            "a",
            "b",
          ]);

        const right =
          TagSet.fromValues([
            "b",
            "a",
          ]);

        expect(
          left.equals(right),
        ).toBe(true);
      },
    );

    it(
      "toArray e snapshot usam ordem canônica",
      () => {
        const set =
          TagSet.fromValues([
            "zeta",
            "alpha",
            "middle",
          ]);

        expect(
          set.toArray(),
        ).toEqual([
          "alpha",
          "middle",
          "zeta",
        ]);

        expect(
          set.toSnapshot(),
        ).toEqual({
          tags: [
            "alpha",
            "middle",
            "zeta",
          ],
        });
      },
    );

    it(
      "snapshot round-trip preserva set",
      () => {
        const source =
          TagSet.fromValues([
            "combat.fire",
            "item.weapon",
          ]);

        const snapshot =
          source.toSnapshot();

        const restored =
          TagSet.fromSnapshot(
            snapshot,
          );

        expect(
          restored.equals(
            source,
          ),
        ).toBe(true);

        expect(
          restored.toSnapshot(),
        ).toEqual(snapshot);
      },
    );

    it(
      "restore rejeita duplicata/collision",
      () => {
        expect(() =>
          TagSet.fromSnapshot({
            tags: [
              "combat.fire",
              "Combat.Fire",
            ],
          }),
        ).toThrow(
          TagSetError,
        );
      },
    );
  },
);
