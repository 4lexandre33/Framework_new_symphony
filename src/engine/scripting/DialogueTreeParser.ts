import type {
  DialogueChoice,
  DialogueNode,
  DialogueTreeDescriptor,
} from "../../contracts/scripting/types";

interface RegisteredDialogueTree {
  readonly descriptor: DialogueTreeDescriptor;
  readonly nodesById: ReadonlyMap<string, DialogueNode>;
}

export class DialogueTreeParser {
  private readonly trees = new Map<string, RegisteredDialogueTree>();
  private activeTree: RegisteredDialogueTree | null = null;
  private currentNode: DialogueNode | null = null;
  private readonly variables = new Map<string, unknown>();

  public registerTree(descriptor: DialogueTreeDescriptor): void {
    const nodesById = new Map<string, DialogueNode>();

    for (const node of descriptor.nodes) {
      nodesById.set(node.nodeId, node);
    }

    this.trees.set(descriptor.treeId, {
      descriptor,
      nodesById,
    });
  }

  public setVariable(key: string, value: unknown): void {
    this.variables.set(key, value);
  }

  public getVariable(key: string): unknown {
    return this.variables.get(key);
  }

  public startDialogue(treeId: string, startNodeId?: string): DialogueNode | null {
    const tree = this.trees.get(treeId);
    if (!tree) return this.endDialogue();

    const targetNodeId = startNodeId ?? tree.descriptor.startNodeId;
    const node = tree.nodesById.get(targetNodeId) ?? null;
    if (!node) return this.endDialogue();

    this.activeTree = tree;
    this.currentNode = node;
    return node;
  }

  public advanceDialogue(choiceIndex?: number): DialogueNode | null {
    if (!this.activeTree || !this.currentNode) return null;

    const currentNode = this.currentNode;

    if (choiceIndex !== undefined && currentNode.choices && currentNode.choices.length > 0) {
      const selectedChoice = currentNode.choices.find(
        (choice) => choice.choiceIndex === choiceIndex,
      );

      if (selectedChoice && this.evaluateChoiceCondition(selectedChoice)) {
        return this.transitionToNode(selectedChoice.nextNodeId);
      }
    }

    if (currentNode.defaultNextNodeId) {
      return this.transitionToNode(currentNode.defaultNextNodeId);
    }

    return this.endDialogue();
  }

  public getCurrentNode(): DialogueNode | null {
    return this.currentNode;
  }

  public get currentTreeId(): string | null {
    return this.activeTree?.descriptor.treeId ?? null;
  }

  public clear(): void {
    this.trees.clear();
    this.variables.clear();
    this.endDialogue();
  }

  private transitionToNode(nodeId: string): DialogueNode | null {
    if (!this.activeTree) return null;

    const nextNode = this.activeTree.nodesById.get(nodeId) ?? null;
    if (!nextNode) return this.endDialogue();

    this.currentNode = nextNode;
    return nextNode;
  }

  private evaluateChoiceCondition(choice: DialogueChoice): boolean {
    if (!choice.conditionVariable) return true;
    return this.variables.get(choice.conditionVariable) === choice.requiredValue;
  }

  private endDialogue(): null {
    this.activeTree = null;
    this.currentNode = null;
    return null;
  }
}
