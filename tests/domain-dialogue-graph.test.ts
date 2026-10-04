// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createDialogueChoiceId,
  createDialogueConditionId,
  createDialogueGraphId,
  createDialogueNodeId,
  createDialogueSpeakerId,
  DialogueGraph,
  DialogueGraphError,
} from "../src/domain/narrative";

function createValidDialogue():
  DialogueGraph {
  const start =
    createDialogueNodeId(
      "dialogue.start",
    );

  const branch =
    createDialogueNodeId(
      "dialogue.branch",
    );

  const choice =
    createDialogueNodeId(
      "dialogue.choice",
    );

  const endGood =
    createDialogueNodeId(
      "dialogue.end-good",
    );

  const endBad =
    createDialogueNodeId(
      "dialogue.end-bad",
    );

  return new DialogueGraph({
    id:
      createDialogueGraphId(
        "dialogue.intro",
      ),
    entryNodeId: start,
    nodes: [
      {
        id: start,
        kind: "line",
        speakerId:
          createDialogueSpeakerId(
            "speaker.guide",
          ),
        text:
          "Welcome.",
        nextNodeId:
          branch,
      },
      {
        id: branch,
        kind: "branch",
        conditionId:
          createDialogueConditionId(
            "condition.has-pass",
          ),
        whenTrueNodeId:
          choice,
        whenFalseNodeId:
          endBad,
      },
      {
        id: choice,
        kind: "choice",
        prompt:
          "Choose.",
        choices: [
          {
            id:
              createDialogueChoiceId(
                "choice.accept",
              ),
            label:
              "Accept",
            nextNodeId:
              endGood,
          },
          {
            id:
              createDialogueChoiceId(
                "choice.decline",
              ),
            label:
              "Decline",
            nextNodeId:
              endBad,
          },
        ],
      },
      {
        id: endGood,
        kind: "end",
      },
      {
        id: endBad,
        kind: "end",
      },
    ],
  });
}

describe(
  "Etapa 44.4 — DialogueGraph",
  () => {
    it(
      "navega line, branch e choice usando apenas IDs lógicos",
      () => {
        const graph =
          createValidDialogue();

        expect(graph.size).toBe(
          5,
        );

        expect(
          graph.resolveLine(
            createDialogueNodeId(
              "dialogue.start",
            ),
          ),
        ).toBe(
          "dialogue.branch",
        );

        expect(
          graph.resolveBranch(
            createDialogueNodeId(
              "dialogue.branch",
            ),
            true,
          ),
        ).toBe(
          "dialogue.choice",
        );

        expect(
          graph.resolveChoice(
            createDialogueNodeId(
              "dialogue.choice",
            ),
            createDialogueChoiceId(
              "choice.accept",
            ),
          ),
        ).toBe(
          "dialogue.end-good",
        );

        expect(
          graph.isEnd(
            createDialogueNodeId(
              "dialogue.end-good",
            ),
          ),
        ).toBe(true);
      },
    );

    it(
      "permite loops intencionais",
      () => {
        const a =
          createDialogueNodeId(
            "loop.a",
          );

        const b =
          createDialogueNodeId(
            "loop.b",
          );

        const graph =
          new DialogueGraph({
            id:
              createDialogueGraphId(
                "dialogue.loop",
              ),
            entryNodeId: a,
            nodes: [
              {
                id: a,
                kind: "line",
                speakerId: null,
                text: "A",
                nextNodeId: b,
              },
              {
                id: b,
                kind: "choice",
                prompt: null,
                choices: [
                  {
                    id:
                      createDialogueChoiceId(
                        "choice.loop",
                      ),
                    label: "Again",
                    nextNodeId: a,
                  },
                ],
              },
            ],
          });

        expect(
          graph.resolveChoice(
            b,
            createDialogueChoiceId(
              "choice.loop",
            ),
          ),
        ).toBe(a);
      },
    );

    it(
      "copia definições para impedir mutação externa",
      () => {
        const start =
          createDialogueNodeId(
            "copy.start",
          );

        const end =
          createDialogueNodeId(
            "copy.end",
          );

        const choices = [
          {
            id:
              createDialogueChoiceId(
                "copy.choice",
              ),
            label: "Continue",
            nextNodeId: end,
          },
        ];

        const graph =
          new DialogueGraph({
            id:
              createDialogueGraphId(
                "dialogue.copy",
              ),
            entryNodeId:
              start,
            nodes: [
              {
                id: start,
                kind: "choice",
                prompt: null,
                choices,
              },
              {
                id: end,
                kind: "end",
              },
            ],
          });

        choices[0] = {
          id:
            createDialogueChoiceId(
              "copy.mutated",
            ),
          label: "Mutated",
          nextNodeId: end,
        };

        expect(
          graph.resolveChoice(
            start,
            createDialogueChoiceId(
              "copy.choice",
            ),
          ),
        ).toBe(end);
      },
    );

    it(
      "rejeita referências inexistentes",
      () => {
        expect(() =>
          new DialogueGraph({
            id:
              createDialogueGraphId(
                "dialogue.bad-target",
              ),
            entryNodeId:
              createDialogueNodeId(
                "bad.start",
              ),
            nodes: [
              {
                id:
                  createDialogueNodeId(
                    "bad.start",
                  ),
                kind: "line",
                speakerId: null,
                text: "Broken",
                nextNodeId:
                  createDialogueNodeId(
                    "bad.missing",
                  ),
              },
            ],
          }),
        ).toThrow(
          DialogueGraphError,
        );
      },
    );

    it(
      "rejeita nodes inalcançáveis",
      () => {
        const start =
          createDialogueNodeId(
            "orphan.start",
          );

        const end =
          createDialogueNodeId(
            "orphan.end",
          );

        const orphan =
          createDialogueNodeId(
            "orphan.node",
          );

        expect(() =>
          new DialogueGraph({
            id:
              createDialogueGraphId(
                "dialogue.orphan",
              ),
            entryNodeId:
              start,
            nodes: [
              {
                id: start,
                kind: "line",
                speakerId: null,
                text: "Start",
                nextNodeId: end,
              },
              {
                id: end,
                kind: "end",
              },
              {
                id: orphan,
                kind: "end",
              },
            ],
          }),
        ).toThrow(
          DialogueGraphError,
        );
      },
    );

    it(
      "rejeita choice duplicada e lookup incorreto",
      () => {
        const graph =
          createValidDialogue();

        expect(() =>
          graph.resolveChoice(
            createDialogueNodeId(
              "dialogue.choice",
            ),
            createDialogueChoiceId(
              "choice.unknown",
            ),
          ),
        ).toThrow(
          DialogueGraphError,
        );

        expect(() =>
          graph.resolveLine(
            createDialogueNodeId(
              "dialogue.end-good",
            ),
          ),
        ).toThrow(
          DialogueGraphError,
        );

        const choiceNode =
          createDialogueNodeId(
            "dup.choice",
          );

        const end =
          createDialogueNodeId(
            "dup.end",
          );

        const duplicateChoiceId =
          createDialogueChoiceId(
            "dup.option",
          );

        expect(() =>
          new DialogueGraph({
            id:
              createDialogueGraphId(
                "dialogue.dup",
              ),
            entryNodeId:
              choiceNode,
            nodes: [
              {
                id: choiceNode,
                kind: "choice",
                prompt: null,
                choices: [
                  {
                    id:
                      duplicateChoiceId,
                    label: "A",
                    nextNodeId:
                      end,
                  },
                  {
                    id:
                      duplicateChoiceId,
                    label: "B",
                    nextNodeId:
                      end,
                  },
                ],
              },
              {
                id: end,
                kind: "end",
              },
            ],
          }),
        ).toThrow(
          DialogueGraphError,
        );
      },
    );
  },
);
