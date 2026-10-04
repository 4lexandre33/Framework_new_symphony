// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createSkillId,
  SkillTreeGraph,
  SkillTreeGraphError,
} from "../src/domain/mechanics";

function makeValidGraph():
  SkillTreeGraph {
  const rootA =
    createSkillId(
      "skill.root-a",
    );

  const rootB =
    createSkillId(
      "skill.root-b",
    );

  const branch =
    createSkillId(
      "skill.branch",
    );

  const ultimate =
    createSkillId(
      "skill.ultimate",
    );

  return new SkillTreeGraph([
    {
      id: ultimate,
      name: "Ultimate",
      prerequisites: [
        branch,
      ],
    },
    {
      id: rootB,
      name: "Root B",
      prerequisites: [],
    },
    {
      id: branch,
      name: "Branch",
      prerequisites: [
        rootB,
        rootA,
      ],
    },
    {
      id: rootA,
      name: "Root A",
      prerequisites: [],
    },
  ]);
}

describe(
  "Etapa 44.3 — SkillTreeGraph",
  () => {
    it(
      "constrói DAG e produz ordem topológica determinística",
      () => {
        const graph =
          makeValidGraph();

        expect(graph.size).toBe(
          4,
        );

        expect(
          graph.topologicalOrder,
        ).toEqual([
          "skill.root-a",
          "skill.root-b",
          "skill.branch",
          "skill.ultimate",
        ]);
      },
    );

    it(
      "calcula unlockable por prerequisites sem estado interno de progressão",
      () => {
        const graph =
          makeValidGraph();

        const rootA =
          createSkillId(
            "skill.root-a",
          );

        const rootB =
          createSkillId(
            "skill.root-b",
          );

        const branch =
          createSkillId(
            "skill.branch",
          );

        const none =
          new Set<
            typeof rootA
          >();

        expect(
          graph.getUnlockable(
            none,
          ),
        ).toEqual([
          "skill.root-a",
          "skill.root-b",
        ]);

        const roots =
          new Set([
            rootA,
            rootB,
          ]);

        expect(
          graph.canUnlock(
            branch,
            roots,
          ),
        ).toBe(true);

        expect(
          graph.getMissingPrerequisites(
            branch,
            new Set([
              rootA,
            ]),
          ),
        ).toEqual([
          "skill.root-b",
        ]);
      },
    );

    it(
      "expõe dependents pré-calculados",
      () => {
        const graph =
          makeValidGraph();

        expect(
          graph.getDependents(
            createSkillId(
              "skill.root-a",
            ),
          ),
        ).toEqual([
          "skill.branch",
        ]);

        expect(
          graph.getPrerequisites(
            createSkillId(
              "skill.branch",
            ),
          ),
        ).toEqual([
          "skill.root-a",
          "skill.root-b",
        ]);
      },
    );

    it(
      "rejeita prerequisite inexistente",
      () => {
        expect(() =>
          new SkillTreeGraph([
            {
              id:
                createSkillId(
                  "skill.a",
                ),
              name: "A",
              prerequisites: [
                createSkillId(
                  "skill.missing",
                ),
              ],
            },
          ]),
        ).toThrow(
          SkillTreeGraphError,
        );
      },
    );

    it(
      "rejeita ciclos",
      () => {
        const a =
          createSkillId(
            "skill.a",
          );

        const b =
          createSkillId(
            "skill.b",
          );

        expect(() =>
          new SkillTreeGraph([
            {
              id: a,
              name: "A",
              prerequisites: [
                b,
              ],
            },
            {
              id: b,
              name: "B",
              prerequisites: [
                a,
              ],
            },
          ]),
        ).toThrow(
          SkillTreeGraphError,
        );
      },
    );

    it(
      "rejeita duplicatas e auto-dependência",
      () => {
        const a =
          createSkillId(
            "skill.a",
          );

        expect(() =>
          new SkillTreeGraph([
            {
              id: a,
              name: "A",
              prerequisites: [
                a,
              ],
            },
          ]),
        ).toThrow(
          SkillTreeGraphError,
        );

        expect(() =>
          new SkillTreeGraph([
            {
              id: a,
              name: "A",
              prerequisites: [],
            },
            {
              id: a,
              name: "A2",
              prerequisites: [],
            },
          ]),
        ).toThrow(
          SkillTreeGraphError,
        );
      },
    );

    it(
      "rejeita prerequisite duplicado",
      () => {
        const root =
          createSkillId(
            "skill.root",
          );

        const child =
          createSkillId(
            "skill.child",
          );

        expect(() =>
          new SkillTreeGraph([
            {
              id: root,
              name: "Root",
              prerequisites: [],
            },
            {
              id: child,
              name: "Child",
              prerequisites: [
                root,
                root,
              ],
            },
          ]),
        ).toThrow(
          SkillTreeGraphError,
        );
      },
    );

    it(
      "rejeita lookup de skill desconhecida",
      () => {
        const graph =
          makeValidGraph();

        expect(() =>
          graph.getPrerequisites(
            createSkillId(
              "skill.unknown",
            ),
          ),
        ).toThrow(
          SkillTreeGraphError,
        );
      },
    );
  },
);
