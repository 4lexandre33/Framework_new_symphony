import type {
  DialogueChoice,
  DialogueEndReason,
  DialogueNode,
  DialogueTreeDescriptor,
} from "../../../contracts/scripting/types";

interface RegisteredDialogueTree {
  readonly descriptor: DialogueTreeDescriptor;
  readonly nodesById: ReadonlyMap<string, DialogueNode>;
}

/** Diálogo encerrado na última operação (o serviço emite `dialogue-ended`). */
export interface DialogueEnd {
  readonly treeId: string;
  readonly lastNodeId: string | null;
  readonly reason: DialogueEndReason;
}

/**
 * Valida uma árvore de diálogo. Retorna a lista de erros (vazia = válida).
 */
export function validateDialogueTree(descriptor: DialogueTreeDescriptor): string[] {
  const errors: string[] = [];

  if (!descriptor || typeof descriptor !== "object") {
    return ["árvore ausente"];
  }

  if (typeof descriptor.treeId !== "string" || descriptor.treeId.length === 0) {
    errors.push("treeId vazio");
  }

  if (!Array.isArray(descriptor.nodes) || descriptor.nodes.length === 0) {
    errors.push("árvore sem nós");
    return errors;
  }

  const ids = new Set<string>();
  for (const node of descriptor.nodes) {
    if (!node || typeof node.nodeId !== "string" || node.nodeId.length === 0) {
      errors.push("nó sem nodeId");
      continue;
    }
    if (ids.has(node.nodeId)) errors.push(`nodeId duplicado: ${node.nodeId}`);
    ids.add(node.nodeId);
  }

  if (!ids.has(descriptor.startNodeId)) {
    errors.push(`startNodeId inexistente: ${String(descriptor.startNodeId)}`);
  }

  for (const node of descriptor.nodes) {
    if (!node || typeof node.nodeId !== "string") continue;

    if (node.defaultNextNodeId !== undefined && !ids.has(node.defaultNextNodeId)) {
      errors.push(`${node.nodeId}: defaultNextNodeId inexistente (${node.defaultNextNodeId})`);
    }

    if (node.choices !== undefined) {
      if (!Array.isArray(node.choices)) {
        errors.push(`${node.nodeId}: choices não é uma lista`);
        continue;
      }
      const indexes = new Set<number>();
      for (const choice of node.choices) {
        if (!choice || !Number.isInteger(choice.choiceIndex)) {
          errors.push(`${node.nodeId}: escolha com choiceIndex inválido`);
          continue;
        }
        if (indexes.has(choice.choiceIndex)) {
          errors.push(`${node.nodeId}: choiceIndex duplicado (${String(choice.choiceIndex)})`);
        }
        indexes.add(choice.choiceIndex);
        if (!ids.has(choice.nextNodeId)) {
          errors.push(`${node.nodeId}: escolha ${String(choice.choiceIndex)} aponta para nó inexistente (${String(choice.nextNodeId)})`);
        }
      }
    }
  }

  return errors;
}

export class DialogueTreeParser {
  private readonly trees = new Map<string, RegisteredDialogueTree>();
  private activeTree: RegisteredDialogueTree | null = null;
  private currentNode: DialogueNode | null = null;
  private readonly variables = new Map<string, unknown>();
  private readonly queue: Array<{ treeId: string; startNodeId?: string }> = [];
  private readonly endedDialogues: DialogueEnd[] = [];
  private lastErrors: string[] = [];

  /**
   * Registra a árvore se for válida (G124). Retorna false (e guarda os erros
   * em `getLastValidationErrors`) se for inválida; nada é registrado.
   */
  public registerTree(descriptor: DialogueTreeDescriptor): boolean {
    const errors = validateDialogueTree(descriptor);
    this.lastErrors = errors;
    if (errors.length > 0) return false;

    const nodesById = new Map<string, DialogueNode>();

    for (const node of descriptor.nodes) {
      nodesById.set(node.nodeId, node);
    }

    this.trees.set(descriptor.treeId, {
      descriptor,
      nodesById,
    });

    return true;
  }

  public getLastValidationErrors(): string[] {
    return this.lastErrors.slice();
  }

  public hasTree(treeId: string): boolean {
    return this.trees.has(treeId);
  }

  public setVariable(key: string, value: unknown): void {
    if (value === undefined) {
      this.variables.delete(key);
      return;
    }
    this.variables.set(key, value);
  }

  public getVariable(key: string): unknown {
    return this.variables.get(key);
  }

  public isActive(): boolean {
    return this.currentNode !== null;
  }

  /**
   * Inicia um diálogo. Id/nó inválido retorna null SEM encerrar o diálogo
   * ativo (G124). Se houver um ativo, ele termina com reason "replaced".
   */
  public startDialogue(treeId: string, startNodeId?: string): DialogueNode | null {
    const tree = this.trees.get(treeId);
    if (!tree) return null;

    const targetNodeId = startNodeId ?? tree.descriptor.startNodeId;
    const node = tree.nodesById.get(targetNodeId) ?? null;
    if (!node) return null;

    if (this.activeTree && this.currentNode) {
      this.recordEnd("replaced");
    }

    this.activeTree = tree;
    this.currentNode = node;
    return node;
  }

  /** Enfileira um diálogo para começar quando o atual terminar. */
  public enqueue(treeId: string, startNodeId?: string): boolean {
    const tree = this.trees.get(treeId);
    if (!tree) return false;
    if (startNodeId !== undefined && !tree.nodesById.has(startNodeId)) return false;
    this.queue.push(startNodeId === undefined ? { treeId } : { treeId, startNodeId });
    return true;
  }

  public get queuedCount(): number {
    return this.queue.length;
  }

  /**
   * Avança o diálogo.
   * - Nó com escolhas: `choiceIndex` deve existir e a condição passar; senão o
   *   diálogo FICA no nó atual (retorna o próprio nó) — nunca segue o default
   *   nem encerra em silêncio. Sem índice, segue `defaultNextNodeId` se houver.
   * - Nó sem escolhas: segue `defaultNextNodeId` ou encerra ("completed").
   */
  public advanceDialogue(choiceIndex?: number): DialogueNode | null {
    if (!this.activeTree || !this.currentNode) return null;

    const currentNode = this.currentNode;
    const hasChoices = currentNode.choices !== undefined && currentNode.choices.length > 0;

    if (hasChoices) {
      if (choiceIndex !== undefined) {
        const selectedChoice = this.findChoice(currentNode, choiceIndex);
        if (!selectedChoice || !this.evaluateChoiceCondition(selectedChoice)) {
          return currentNode;
        }
        return this.transitionToNode(selectedChoice.nextNodeId);
      }

      if (currentNode.defaultNextNodeId) {
        return this.transitionToNode(currentNode.defaultNextNodeId);
      }

      return currentNode;
    }

    if (currentNode.defaultNextNodeId) {
      return this.transitionToNode(currentNode.defaultNextNodeId);
    }

    return this.endDialogue("completed");
  }

  /** Escolhas do nó atual cuja condição passa. */
  public getAvailableChoices(): DialogueChoice[] {
    const choices = this.currentNode?.choices;
    if (!choices) return [];
    return choices.filter((choice) => this.evaluateChoiceCondition(choice));
  }

  /** true se `choiceIndex` existe no nó atual e a condição passa. */
  public isChoiceAvailable(choiceIndex: number): boolean {
    const node = this.currentNode;
    if (!node) return false;
    const choice = this.findChoice(node, choiceIndex);
    return choice !== null && this.evaluateChoiceCondition(choice);
  }

  public getCurrentNode(): DialogueNode | null {
    return this.currentNode;
  }

  public get currentTreeId(): string | null {
    return this.activeTree?.descriptor.treeId ?? null;
  }

  /** Encerra o diálogo ativo (reason "stopped"). */
  public stop(): boolean {
    if (!this.activeTree || !this.currentNode) return false;
    this.endDialogue("stopped");
    return true;
  }

  /** Remove e retorna os encerramentos acumulados (para emitir eventos). */
  public drainEnded(): DialogueEnd[] {
    if (this.endedDialogues.length === 0) return [];
    return this.endedDialogues.splice(0, this.endedDialogues.length);
  }

  /**
   * Se não há diálogo ativo e há fila, inicia o próximo. Retorna o nó
   * inicial (ou null).
   */
  public startNextQueued(): DialogueNode | null {
    while (!this.isActive() && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) break;
      const node = this.startDialogue(next.treeId, next.startNodeId);
      if (node) return node;
    }
    return null;
  }

  public clear(): void {
    this.trees.clear();
    this.variables.clear();
    this.queue.length = 0;
    this.activeTree = null;
    this.currentNode = null;
    this.endedDialogues.length = 0;
  }

  private findChoice(node: DialogueNode, choiceIndex: number): DialogueChoice | null {
    const choices = node.choices;
    if (!choices) return null;
    for (let index = 0; index < choices.length; index += 1) {
      const choice = choices[index];
      if (choice && choice.choiceIndex === choiceIndex) return choice;
    }
    return null;
  }

  private transitionToNode(nodeId: string): DialogueNode | null {
    if (!this.activeTree) return null;

    const nextNode = this.activeTree.nodesById.get(nodeId) ?? null;
    if (!nextNode) return this.endDialogue("error");

    this.currentNode = nextNode;
    return nextNode;
  }

  private evaluateChoiceCondition(choice: DialogueChoice): boolean {
    if (!choice.conditionVariable) return true;
    const value = this.variables.get(choice.conditionVariable);
    if (choice.requiredValue === undefined) return Boolean(value);
    return value === choice.requiredValue;
  }

  private recordEnd(reason: DialogueEndReason): void {
    if (!this.activeTree) return;
    this.endedDialogues.push({
      treeId: this.activeTree.descriptor.treeId,
      lastNodeId: this.currentNode?.nodeId ?? null,
      reason,
    });
  }

  private endDialogue(reason: DialogueEndReason): null {
    this.recordEnd(reason);
    this.activeTree = null;
    this.currentNode = null;
    return null;
  }
}
