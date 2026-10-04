import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

export type DialogueGraphId =
  DomainId<"dialogue-graph">;

export type DialogueNodeId =
  DomainId<"dialogue-node">;

export type DialogueChoiceId =
  DomainId<"dialogue-choice">;

export type DialogueSpeakerId =
  DomainId<"dialogue-speaker">;

export type DialogueConditionId =
  DomainId<"dialogue-condition">;

export function createDialogueGraphId(
  value: string,
): DialogueGraphId {
  return createDomainId<
    "dialogue-graph"
  >(value);
}

export function createDialogueNodeId(
  value: string,
): DialogueNodeId {
  return createDomainId<
    "dialogue-node"
  >(value);
}

export function createDialogueChoiceId(
  value: string,
): DialogueChoiceId {
  return createDomainId<
    "dialogue-choice"
  >(value);
}

export function createDialogueSpeakerId(
  value: string,
): DialogueSpeakerId {
  return createDomainId<
    "dialogue-speaker"
  >(value);
}

export function createDialogueConditionId(
  value: string,
): DialogueConditionId {
  return createDomainId<
    "dialogue-condition"
  >(value);
}

export interface DialogueLineNodeDefinition {
  readonly id: DialogueNodeId;
  readonly kind: "line";
  readonly speakerId:
    DialogueSpeakerId | null;
  readonly text: string;
  readonly nextNodeId:
    DialogueNodeId;
}

export interface DialogueChoiceDefinition {
  readonly id:
    DialogueChoiceId;
  readonly label: string;
  readonly nextNodeId:
    DialogueNodeId;
}

export interface DialogueChoiceNodeDefinition {
  readonly id: DialogueNodeId;
  readonly kind: "choice";
  readonly prompt:
    string | null;
  readonly choices:
    readonly DialogueChoiceDefinition[];
}

export interface DialogueBranchNodeDefinition {
  readonly id: DialogueNodeId;
  readonly kind: "branch";
  readonly conditionId:
    DialogueConditionId;
  readonly whenTrueNodeId:
    DialogueNodeId;
  readonly whenFalseNodeId:
    DialogueNodeId;
}

export interface DialogueEndNodeDefinition {
  readonly id: DialogueNodeId;
  readonly kind: "end";
}

export type DialogueNodeDefinition =
  | DialogueLineNodeDefinition
  | DialogueChoiceNodeDefinition
  | DialogueBranchNodeDefinition
  | DialogueEndNodeDefinition;

export interface DialogueLineNode {
  readonly id: DialogueNodeId;
  readonly kind: "line";
  readonly speakerId:
    DialogueSpeakerId | null;
  readonly text: string;
  readonly nextNodeId:
    DialogueNodeId;
}

export interface DialogueChoice {
  readonly id:
    DialogueChoiceId;
  readonly label: string;
  readonly nextNodeId:
    DialogueNodeId;
}

export interface DialogueChoiceNode {
  readonly id: DialogueNodeId;
  readonly kind: "choice";
  readonly prompt:
    string | null;
  readonly choices:
    readonly DialogueChoice[];
}

export interface DialogueBranchNode {
  readonly id: DialogueNodeId;
  readonly kind: "branch";
  readonly conditionId:
    DialogueConditionId;
  readonly whenTrueNodeId:
    DialogueNodeId;
  readonly whenFalseNodeId:
    DialogueNodeId;
}

export interface DialogueEndNode {
  readonly id: DialogueNodeId;
  readonly kind: "end";
}

export type DialogueNode =
  | DialogueLineNode
  | DialogueChoiceNode
  | DialogueBranchNode
  | DialogueEndNode;

export type DialogueGraphErrorCode =
  | "empty-graph"
  | "duplicate-node"
  | "missing-entry"
  | "invalid-text"
  | "empty-choices"
  | "duplicate-choice"
  | "missing-target"
  | "unreachable-node"
  | "unknown-node"
  | "wrong-node-kind"
  | "unknown-choice";

export class DialogueGraphError
  extends Error {
  public readonly name =
    "DialogueGraphError";

  public constructor(
    public readonly code:
      DialogueGraphErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface DialogueGraphCreateOptions {
  readonly id:
    DialogueGraphId;
  readonly entryNodeId:
    DialogueNodeId;
  readonly nodes:
    readonly DialogueNodeDefinition[];
}

const MAX_DIALOGUE_TEXT_LENGTH =
  4_096;

const MAX_CHOICE_LABEL_LENGTH =
  512;

function assertText(
  value: string,
  fieldName: string,
  maxLength: number,
): void {
  if (
    value.length === 0 ||
    value.length >
      maxLength ||
    value !== value.trim()
  ) {
    throw new DialogueGraphError(
      "invalid-text",
      `${fieldName} deve ser não vazio, sem whitespace nas extremidades e ter no máximo ${maxLength} caracteres.`,
    );
  }
}

function assertOptionalText(
  value: string | null,
  fieldName: string,
  maxLength: number,
): void {
  if (value === null) {
    return;
  }

  assertText(
    value,
    fieldName,
    maxLength,
  );
}

function cloneNode(
  definition:
    DialogueNodeDefinition,
): DialogueNode {
  switch (definition.kind) {
    case "line":
      assertText(
        definition.text,
        "line.text",
        MAX_DIALOGUE_TEXT_LENGTH,
      );

      return Object.freeze({
        id: definition.id,
        kind: "line",
        speakerId:
          definition.speakerId,
        text: definition.text,
        nextNodeId:
          definition.nextNodeId,
      });

    case "choice": {
      assertOptionalText(
        definition.prompt,
        "choice.prompt",
        MAX_DIALOGUE_TEXT_LENGTH,
      );

      if (
        definition.choices.length ===
        0
      ) {
        throw new DialogueGraphError(
          "empty-choices",
          `Dialogue choice node "${definition.id}" precisa possuir ao menos uma opção.`,
        );
      }

      const choiceIds =
        new Set<
          DialogueChoiceId
        >();

      const choices:
        DialogueChoice[] = [];

      for (
        const choice of
        definition.choices
      ) {
        if (
          choiceIds.has(
            choice.id,
          )
        ) {
          throw new DialogueGraphError(
            "duplicate-choice",
            `Dialogue choice node "${definition.id}" possui choice id duplicado "${choice.id}".`,
          );
        }

        choiceIds.add(
          choice.id,
        );

        assertText(
          choice.label,
          "choice.label",
          MAX_CHOICE_LABEL_LENGTH,
        );

        choices.push(
          Object.freeze({
            id: choice.id,
            label:
              choice.label,
            nextNodeId:
              choice.nextNodeId,
          }),
        );
      }

      return Object.freeze({
        id: definition.id,
        kind: "choice",
        prompt:
          definition.prompt,
        choices:
          Object.freeze(
            choices,
          ),
      });
    }

    case "branch":
      return Object.freeze({
        id: definition.id,
        kind: "branch",
        conditionId:
          definition.conditionId,
        whenTrueNodeId:
          definition.whenTrueNodeId,
        whenFalseNodeId:
          definition.whenFalseNodeId,
      });

    case "end":
      return Object.freeze({
        id: definition.id,
        kind: "end",
      });
  }
}

function collectTargets(
  node: DialogueNode,
): readonly DialogueNodeId[] {
  switch (node.kind) {
    case "line":
      return [
        node.nextNodeId,
      ];

    case "choice":
      return node.choices.map(
        (choice) =>
          choice.nextNodeId,
      );

    case "branch":
      return [
        node.whenTrueNodeId,
        node.whenFalseNodeId,
      ];

    case "end":
      return [];
  }
}

/**
 * Definição imutável de um diálogo.
 *
 * O grafo pode conter loops intencionais, mas todas as referências precisam
 * existir e todos os nós devem ser alcançáveis a partir de entryNodeId.
 *
 * Condições são IDs lógicos opacos: a avaliação concreta acontece fora do
 * grafo. Da mesma forma, speakerId não implica Sprite, Mesh, áudio ou UI.
 */
export class DialogueGraph {
  public readonly id:
    DialogueGraphId;

  public readonly entryNodeId:
    DialogueNodeId;

  private readonly nodes =
    new Map<
      DialogueNodeId,
      DialogueNode
    >();

  public constructor(
    options:
      DialogueGraphCreateOptions,
  ) {
    if (
      options.nodes.length ===
      0
    ) {
      throw new DialogueGraphError(
        "empty-graph",
        "DialogueGraph precisa possuir ao menos um nó.",
      );
    }

    this.id = options.id;
    this.entryNodeId =
      options.entryNodeId;

    for (
      const definition of
      options.nodes
    ) {
      if (
        this.nodes.has(
          definition.id,
        )
      ) {
        throw new DialogueGraphError(
          "duplicate-node",
          `DialogueNodeId duplicado: "${definition.id}".`,
        );
      }

      this.nodes.set(
        definition.id,
        cloneNode(
          definition,
        ),
      );
    }

    if (
      !this.nodes.has(
        this.entryNodeId,
      )
    ) {
      throw new DialogueGraphError(
        "missing-entry",
        `entryNodeId inexistente: "${this.entryNodeId}".`,
      );
    }

    for (
      const node of
      this.nodes.values()
    ) {
      for (
        const targetId of
        collectTargets(node)
      ) {
        if (
          !this.nodes.has(
            targetId,
          )
        ) {
          throw new DialogueGraphError(
            "missing-target",
            `Nó "${node.id}" referencia destino inexistente "${targetId}".`,
          );
        }
      }
    }

    this.assertAllNodesReachable();
  }

  public get size():
    number {
    return this.nodes.size;
  }

  public hasNode(
    nodeId: DialogueNodeId,
  ): boolean {
    return this.nodes.has(
      nodeId,
    );
  }

  public getEntryNode():
    DialogueNode {
    return this.requireNode(
      this.entryNodeId,
    );
  }

  public getNode(
    nodeId: DialogueNodeId,
  ): DialogueNode {
    return this.requireNode(
      nodeId,
    );
  }

  public isEnd(
    nodeId: DialogueNodeId,
  ): boolean {
    return (
      this.requireNode(
        nodeId,
      ).kind === "end"
    );
  }

  public resolveLine(
    nodeId: DialogueNodeId,
  ): DialogueNodeId {
    const node =
      this.requireNode(
        nodeId,
      );

    if (
      node.kind !== "line"
    ) {
      throw new DialogueGraphError(
        "wrong-node-kind",
        `Nó "${nodeId}" não é do tipo line.`,
      );
    }

    return node.nextNodeId;
  }

  public resolveBranch(
    nodeId: DialogueNodeId,
    conditionResult: boolean,
  ): DialogueNodeId {
    const node =
      this.requireNode(
        nodeId,
      );

    if (
      node.kind !== "branch"
    ) {
      throw new DialogueGraphError(
        "wrong-node-kind",
        `Nó "${nodeId}" não é do tipo branch.`,
      );
    }

    return conditionResult
      ? node.whenTrueNodeId
      : node.whenFalseNodeId;
  }

  public resolveChoice(
    nodeId: DialogueNodeId,
    choiceId:
      DialogueChoiceId,
  ): DialogueNodeId {
    const node =
      this.requireNode(
        nodeId,
      );

    if (
      node.kind !== "choice"
    ) {
      throw new DialogueGraphError(
        "wrong-node-kind",
        `Nó "${nodeId}" não é do tipo choice.`,
      );
    }

    for (
      const choice of
      node.choices
    ) {
      if (
        choice.id ===
        choiceId
      ) {
        return choice.nextNodeId;
      }
    }

    throw new DialogueGraphError(
      "unknown-choice",
      `Choice "${choiceId}" não existe no nó "${nodeId}".`,
    );
  }

  private requireNode(
    nodeId: DialogueNodeId,
  ): DialogueNode {
    const node =
      this.nodes.get(nodeId);

    if (node === undefined) {
      throw new DialogueGraphError(
        "unknown-node",
        `Dialogue node desconhecido: "${nodeId}".`,
      );
    }

    return node;
  }

  private assertAllNodesReachable():
    void {
    const visited =
      new Set<
        DialogueNodeId
      >();

    const pending:
      DialogueNodeId[] = [
        this.entryNodeId,
      ];

    while (
      pending.length > 0
    ) {
      const nodeId =
        pending.pop();

      if (
        nodeId === undefined ||
        visited.has(nodeId)
      ) {
        continue;
      }

      visited.add(nodeId);

      const node =
        this.requireNode(
          nodeId,
        );

      for (
        const targetId of
        collectTargets(node)
      ) {
        if (
          !visited.has(
            targetId,
          )
        ) {
          pending.push(
            targetId,
          );
        }
      }
    }

    if (
      visited.size ===
      this.nodes.size
    ) {
      return;
    }

    const unreachable:
      DialogueNodeId[] = [];

    for (
      const nodeId of
      this.nodes.keys()
    ) {
      if (
        !visited.has(nodeId)
      ) {
        unreachable.push(
          nodeId,
        );
      }
    }

    unreachable.sort();

    throw new DialogueGraphError(
      "unreachable-node",
      `DialogueGraph possui nó(s) inalcançável(is): ${unreachable.join(", ")}.`,
    );
  }
}
