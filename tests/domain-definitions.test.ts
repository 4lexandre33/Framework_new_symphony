// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createDefinitionId,
  createDefinitionKindId,
  createDefinitionRef,
  createDefinitionValidatorId,
  definitionRefFromSnapshot,
  definitionRefToSnapshot,
  DefinitionSet,
  DefinitionSetError,
  GameDefinitions,
  GameDefinitionsError,
  sameDefinitionRef,
} from "../src/domain/definitions";

import type {
  DefinitionValidator,
} from "../src/domain/definitions";

interface WeaponDefinition {
  readonly name:
    string;
  readonly damage:
    number;
}

function createWeaponSet() {
  const kindId =
    createDefinitionKindId(
      "definition-kind.weapon",
    );

  const validator:
    DefinitionValidator<
      WeaponDefinition
    > = {
      id:
        createDefinitionValidatorId(
          "validator.weapon.damage",
        ),

      validate(context) {
        if (
          !Number.isFinite(
            context.value.damage,
          ) ||
          context.value.damage <
            0
        ) {
          return [
            {
              code:
                "invalid-damage",
              message:
                "damage deve ser finito e >= 0.",
            },
          ];
        }

        return [];
      },
    };

  return new DefinitionSet(
    kindId,
    [
      {
        id:
          createDefinitionId(
            "weapon.sword",
          ),
        value:
          Object.freeze({
            name: "Sword",
            damage: 25,
          }),
      },
      {
        id:
          createDefinitionId(
            "weapon.bow",
          ),
        value:
          Object.freeze({
            name: "Bow",
            damage: 15,
          }),
      },
    ],
    [
      validator,
    ],
  );
}

describe(
  "Etapa 60 — DefinitionRef",
  () => {
    it(
      "combina kind + definition id e faz round-trip",
      () => {
        const ref =
          createDefinitionRef<
            WeaponDefinition
          >(
            createDefinitionKindId(
              "definition-kind.weapon",
            ),
            createDefinitionId(
              "weapon.sword",
            ),
          );

        const snapshot =
          definitionRefToSnapshot(
            ref,
          );

        const restored =
          definitionRefFromSnapshot<
            WeaponDefinition
          >(snapshot);

        expect(
          sameDefinitionRef(
            ref,
            restored,
          ),
        ).toBe(true);

        expect(restored).toEqual({
          kindId:
            "definition-kind.weapon",
          definitionId:
            "weapon.sword",
        });
      },
    );

    it(
      "mesmo definitionId em kinds diferentes não é a mesma referência",
      () => {
        const id =
          createDefinitionId(
            "common",
          );

        const left =
          createDefinitionRef(
            createDefinitionKindId(
              "definition-kind.a",
            ),
            id,
          );

        const right =
          createDefinitionRef(
            createDefinitionKindId(
              "definition-kind.b",
            ),
            id,
          );

        expect(
          sameDefinitionRef(
            left,
            right,
          ),
        ).toBe(false);
      },
    );
  },
);

describe(
  "Etapa 60 — DefinitionSet",
  () => {
    it(
      "normaliza IDs e fornece lookup O(1) via Map",
      () => {
        const set =
          createWeaponSet();

        expect(set.size).toBe(2);

        expect(
          set.getDefinitionIds(),
        ).toEqual([
          "weapon.bow",
          "weapon.sword",
        ]);

        expect(
          set.require(
            createDefinitionId(
              "weapon.sword",
            ),
          ),
        ).toEqual({
          name: "Sword",
          damage: 25,
        });
      },
    );

    it(
      "createRef só aceita definição existente",
      () => {
        const set =
          createWeaponSet();

        const ref =
          set.createRef(
            createDefinitionId(
              "weapon.bow",
            ),
          );

        expect(ref).toEqual({
          kindId:
            "definition-kind.weapon",
          definitionId:
            "weapon.bow",
        });

        expect(() =>
          set.createRef(
            createDefinitionId(
              "weapon.missing",
            ),
          ),
        ).toThrow(
          DefinitionSetError,
        );
      },
    );

    it(
      "rejeita definição duplicada",
      () => {
        const id =
          createDefinitionId(
            "same",
          );

        expect(() =>
          new DefinitionSet(
            createDefinitionKindId(
              "definition-kind.test",
            ),
            [
              {
                id,
                value: 1,
              },
              {
                id,
                value: 2,
              },
            ],
          ),
        ).toThrow(
          DefinitionSetError,
        );
      },
    );

    it(
      "rejeita validator duplicado",
      () => {
        const validatorId =
          createDefinitionValidatorId(
            "validator.same",
          );

        const validator = {
          id: validatorId,
          validate: () => [],
        };

        expect(() =>
          new DefinitionSet(
            createDefinitionKindId(
              "definition-kind.test",
            ),
            [
              {
                id:
                  createDefinitionId(
                    "definition.a",
                  ),
                value: 1,
              },
            ],
            [
              validator,
              validator,
            ],
          ),
        ).toThrow(
          DefinitionSetError,
        );
      },
    );

    it(
      "agrega validation issues deterministicamente e reprova construção",
      () => {
        const validatorZ:
          DefinitionValidator<number> =
          {
            id:
              createDefinitionValidatorId(
                "validator.z",
              ),

            validate() {
              return [
                {
                  code: "z-code",
                  message: "Z issue",
                },
              ];
            },
          };

        const validatorA:
          DefinitionValidator<number> =
          {
            id:
              createDefinitionValidatorId(
                "validator.a",
              ),

            validate() {
              return [
                {
                  code: "a-code",
                  message: "A issue",
                },
              ];
            },
          };

        let thrown:
          DefinitionSetError | null =
            null;

        try {
          new DefinitionSet(
            createDefinitionKindId(
              "definition-kind.number",
            ),
            [
              {
                id:
                  createDefinitionId(
                    "definition.b",
                  ),
                value: 2,
              },
              {
                id:
                  createDefinitionId(
                    "definition.a",
                  ),
                value: 1,
              },
            ],
            [
              validatorZ,
              validatorA,
            ],
          );
        } catch (error) {
          if (
            error instanceof
            DefinitionSetError
          ) {
            thrown = error;
          } else {
            throw error;
          }
        }

        expect(thrown).not.toBeNull();

        expect(
          thrown?.code,
        ).toBe(
          "validation-failed",
        );

        expect(
          thrown?.issues.map(
            (issue) =>
              `${issue.definitionId}:${issue.validatorId}:${issue.code}`,
          ),
        ).toEqual([
          "definition.a:validator.a:a-code",
          "definition.a:validator.z:z-code",
          "definition.b:validator.a:a-code",
          "definition.b:validator.z:z-code",
        ]);
      },
    );

    it(
      "forEach segue ordem canônica de DefinitionId",
      () => {
        const set =
          createWeaponSet();

        const visited:
          string[] = [];

        set.forEach(
          (id) => {
            visited.push(id);
          },
        );

        expect(visited).toEqual([
          "weapon.bow",
          "weapon.sword",
        ]);
      },
    );
  },
);

describe(
  "Etapa 60 — GameDefinitions",
  () => {
    it(
      "resolve DefinitionRef em registry multi-kind",
      () => {
        const weapons =
          createWeaponSet();

        const potions =
          new DefinitionSet(
            createDefinitionKindId(
              "definition-kind.potion",
            ),
            [
              {
                id:
                  createDefinitionId(
                    "potion.heal",
                  ),
                value:
                  Object.freeze({
                    healing: 20,
                  }),
              },
            ],
          );

        const registry =
          new GameDefinitions([
            potions,
            weapons,
          ]);

        expect(
          registry.getKindIds(),
        ).toEqual([
          "definition-kind.potion",
          "definition-kind.weapon",
        ]);

        const swordRef =
          weapons.createRef(
            createDefinitionId(
              "weapon.sword",
            ),
          );

        const sword =
          registry.resolve(
            swordRef,
          );

        expect(sword).toEqual({
          name: "Sword",
          damage: 25,
        });

        expect(
          registry.has(swordRef),
        ).toBe(true);
      },
    );

    it(
      "resolve retorna null e require diferencia kind/definition ausentes",
      () => {
        const weapons =
          createWeaponSet();

        const registry =
          new GameDefinitions([
            weapons,
          ]);

        const missingDefinition =
          createDefinitionRef<
            WeaponDefinition
          >(
            weapons.kindId,
            createDefinitionId(
              "weapon.missing",
            ),
          );

        expect(
          registry.resolve(
            missingDefinition,
          ),
        ).toBeNull();

        expect(() =>
          registry.require(
            missingDefinition,
          ),
        ).toThrow(
          GameDefinitionsError,
        );

        const missingKind =
          createDefinitionRef(
            createDefinitionKindId(
              "definition-kind.missing",
            ),
            createDefinitionId(
              "anything",
            ),
          );

        expect(
          registry.resolve(
            missingKind,
          ),
        ).toBeNull();

        expect(() =>
          registry.require(
            missingKind,
          ),
        ).toThrow(
          GameDefinitionsError,
        );
      },
    );

    it(
      "rejeita kind duplicado",
      () => {
        const set =
          createWeaponSet();

        expect(() =>
          new GameDefinitions([
            set,
            set,
          ]),
        ).toThrow(
          GameDefinitionsError,
        );
      },
    );
  },
);
