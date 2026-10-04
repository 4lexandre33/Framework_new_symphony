// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  applyModifierOperation,
  createModifierId,
  createModifierOperation,
  createModifierSourceId,
  createModifierSourceRef,
  createModifierSourceTypeId,
  createModifierTargetId,
  Modifier,
  ModifierError,
  ModifierOperationError,
  ModifierSet,
  ModifierSetError,
} from "../src/domain/mechanics";

function modifier(
  id: string,
  target: string,
  kind:
    | "add"
    | "multiply"
    | "override",
  value: number,
  priority = 0,
): Modifier {
  return new Modifier({
    id:
      createModifierId(id),
    targetId:
      createModifierTargetId(
        target,
      ),
    operation:
      createModifierOperation(
        kind,
        value,
      ),
    priority,
  });
}

describe(
  "Etapa 52 — ModifierOperation",
  () => {
    it(
      "aplica add/multiply/override",
      () => {
        expect(
          applyModifierOperation(
            10,
            createModifierOperation(
              "add",
              5,
            ),
          ),
        ).toBe(15);

        expect(
          applyModifierOperation(
            10,
            createModifierOperation(
              "multiply",
              2,
            ),
          ),
        ).toBe(20);

        expect(
          applyModifierOperation(
            10,
            createModifierOperation(
              "override",
              7,
            ),
          ),
        ).toBe(7);
      },
    );

    it(
      "rejeita valores não finitos e overflow",
      () => {
        expect(() =>
          createModifierOperation(
            "add",
            Number.NaN,
          ),
        ).toThrow(
          ModifierOperationError,
        );

        expect(() =>
          applyModifierOperation(
            Number.MAX_VALUE,
            createModifierOperation(
              "multiply",
              2,
            ),
          ),
        ).toThrow(
          ModifierOperationError,
        );
      },
    );
  },
);

describe(
  "Etapa 52 — Modifier",
  () => {
    it(
      "cria definição semântica com source opaco",
      () => {
        const source =
          createModifierSourceRef(
            createModifierSourceTypeId(
              "source.status-effect",
            ),
            createModifierSourceId(
              "status.poison",
            ),
          );

        const value =
          new Modifier({
            id:
              createModifierId(
                "modifier.poison.damage",
              ),
            targetId:
              createModifierTargetId(
                "attribute.damage",
              ),
            operation:
              createModifierOperation(
                "multiply",
                0.75,
              ),
            priority: 20,
            source,
          });

        expect(
          value.toSnapshot(),
        ).toEqual({
          id:
            "modifier.poison.damage",
          targetId:
            "attribute.damage",
          operation:
            "multiply",
          value: 0.75,
          priority: 20,
          source: {
            typeId:
              "source.status-effect",
            sourceId:
              "status.poison",
          },
        });
      },
    );

    it(
      "rejeita priority não inteira segura",
      () => {
        expect(() =>
          new Modifier({
            id:
              createModifierId(
                "modifier.bad",
              ),
            targetId:
              createModifierTargetId(
                "attribute.damage",
              ),
            operation:
              createModifierOperation(
                "add",
                1,
              ),
            priority: 1.5,
          }),
        ).toThrow(
          ModifierError,
        );
      },
    );

    it(
      "faz round-trip por snapshot",
      () => {
        const original =
          modifier(
            "modifier.roundtrip",
            "attribute.armor",
            "add",
            12,
            -5,
          );

        expect(
          Modifier.fromSnapshot(
            original.toSnapshot(),
          ).toSnapshot(),
        ).toEqual(
          original.toSnapshot(),
        );
      },
    );
  },
);

describe(
  "Etapa 52 — ModifierSet",
  () => {
    it(
      "avalia pipeline por priority crescente",
      () => {
        const target =
          createModifierTargetId(
            "attribute.damage",
          );

        const set =
          new ModifierSet();

        set.add(
          modifier(
            "modifier.add",
            target,
            "add",
            5,
            0,
          ),
        );

        set.add(
          modifier(
            "modifier.multiply",
            target,
            "multiply",
            2,
            10,
          ),
        );

        set.add(
          modifier(
            "modifier.override",
            target,
            "override",
            7,
            20,
          ),
        );

        set.add(
          modifier(
            "modifier.after",
            target,
            "add",
            1,
            30,
          ),
        );

        expect(
          set.evaluate(
            target,
            10,
          ),
        ).toBe(8);
      },
    );

    it(
      "usa ModifierId como desempate determinístico",
      () => {
        const target =
          createModifierTargetId(
            "attribute.value",
          );

        const set =
          new ModifierSet();

        set.add(
          modifier(
            "modifier.z",
            target,
            "multiply",
            2,
            0,
          ),
        );

        set.add(
          modifier(
            "modifier.a",
            target,
            "add",
            3,
            0,
          ),
        );

        expect(
          set.getModifiersForTarget(
            target,
          ).map(
            (entry) =>
              entry.id,
          ),
        ).toEqual([
          "modifier.a",
          "modifier.z",
        ]);

        expect(
          set.evaluate(
            target,
            10,
          ),
        ).toBe(26);
      },
    );

    it(
      "separa buckets por target",
      () => {
        const damage =
          createModifierTargetId(
            "attribute.damage",
          );

        const armor =
          createModifierTargetId(
            "attribute.armor",
          );

        const set =
          new ModifierSet();

        set.add(
          modifier(
            "modifier.damage",
            damage,
            "add",
            5,
          ),
        );

        set.add(
          modifier(
            "modifier.armor",
            armor,
            "add",
            100,
          ),
        );

        expect(
          set.evaluate(
            damage,
            10,
          ),
        ).toBe(15);

        expect(
          set.evaluate(
            armor,
            10,
          ),
        ).toBe(110);

        expect(
          set.countForTarget(
            damage,
          ),
        ).toBe(1);
      },
    );

    it(
      "sem modifiers retorna baseValue sem alteração",
      () => {
        const set =
          new ModifierSet();

        expect(
          set.evaluate(
            createModifierTargetId(
              "attribute.unknown",
            ),
            42,
          ),
        ).toBe(42);
      },
    );

    it(
      "rejeita ModifierId duplicado",
      () => {
        const set =
          new ModifierSet();

        set.add(
          modifier(
            "modifier.same",
            "attribute.damage",
            "add",
            1,
          ),
        );

        expect(() =>
          set.add(
            modifier(
              "modifier.same",
              "attribute.armor",
              "add",
              2,
            ),
          ),
        ).toThrow(
          ModifierSetError,
        );
      },
    );

    it(
      "remove atualiza somente comportamento relevante",
      () => {
        const target =
          createModifierTargetId(
            "attribute.damage",
          );

        const set =
          new ModifierSet();

        const first =
          modifier(
            "modifier.first",
            target,
            "add",
            5,
          );

        const second =
          modifier(
            "modifier.second",
            target,
            "multiply",
            2,
            10,
          );

        set.add(first);
        set.add(second);

        expect(
          set.evaluate(
            target,
            10,
          ),
        ).toBe(30);

        expect(
          set.remove(
            first.id,
          ),
        ).toBe(true);

        expect(
          set.evaluate(
            target,
            10,
          ),
        ).toBe(20);

        expect(
          set.remove(
            first.id,
          ),
        ).toBe(false);
      },
    );

    it(
      "snapshot é determinístico e round-trip preserva pipeline",
      () => {
        const set =
          new ModifierSet();

        set.add(
          modifier(
            "modifier.z",
            "attribute.speed",
            "multiply",
            1.5,
            20,
          ),
        );

        set.add(
          modifier(
            "modifier.b",
            "attribute.damage",
            "add",
            2,
            10,
          ),
        );

        set.add(
          modifier(
            "modifier.a",
            "attribute.damage",
            "multiply",
            3,
            10,
          ),
        );

        const snapshot =
          set.toSnapshot();

        expect(
          snapshot.modifiers
            .map(
              (entry) =>
                entry.id,
            ),
        ).toEqual([
          "modifier.a",
          "modifier.b",
          "modifier.z",
        ]);

        const restored =
          ModifierSet
            .fromSnapshot(
              snapshot,
            );

        expect(
          restored.toSnapshot(),
        ).toEqual(snapshot);

        expect(
          restored.evaluate(
            createModifierTargetId(
              "attribute.damage",
            ),
            4,
          ),
        ).toBe(14);
      },
    );

    it(
      "forEach percorre sem materializar snapshot",
      () => {
        const set =
          new ModifierSet();

        set.add(
          modifier(
            "modifier.one",
            "attribute.x",
            "add",
            1,
          ),
        );

        set.add(
          modifier(
            "modifier.two",
            "attribute.y",
            "add",
            2,
          ),
        );

        let count = 0;

        set.forEach(() => {
          count += 1;
        });

        expect(count).toBe(2);
      },
    );
  },
);
