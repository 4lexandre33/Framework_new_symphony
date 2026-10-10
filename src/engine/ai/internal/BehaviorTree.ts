import type {
  BehaviorActionContext,
  BehaviorActionFn,
  BehaviorConditionFn,
  BehaviorNodeDefinition,
  BlackboardValue,
  NodeStatus,
  Vector3AI,
} from "../../../contracts/ai/types";

export class Blackboard {
  private readonly memory = new Map<string, BlackboardValue>();

  public set(key: string, value: BlackboardValue): void {
    this.memory.set(key, value);
  }

  public get(key: string): BlackboardValue | undefined {
    return this.memory.get(key);
  }

  public has(key: string): boolean {
    return this.memory.has(key);
  }

  public clear(): void {
    this.memory.clear();
  }
}

export abstract class BTNode {
  abstract tick(blackboard: Blackboard, deltaSeconds: number): NodeStatus;
}

export class SequenceNode extends BTNode {
  public constructor(private readonly children: ReadonlyArray<BTNode>) {
    super();
  }

  public tick(blackboard: Blackboard, deltaSeconds: number): NodeStatus {
    for (const child of this.children) {
      const status = child.tick(blackboard, deltaSeconds);
      if (status !== "SUCCESS") {
        return status;
      }
    }
    return "SUCCESS";
  }
}

export class SelectorNode extends BTNode {
  public constructor(private readonly children: ReadonlyArray<BTNode>) {
    super();
  }

  public tick(blackboard: Blackboard, deltaSeconds: number): NodeStatus {
    for (const child of this.children) {
      const status = child.tick(blackboard, deltaSeconds);
      if (status !== "FAILURE") {
        return status;
      }
    }
    return "FAILURE";
  }
}

export class InverterNode extends BTNode {
  public constructor(private readonly child: BTNode) {
    super();
  }

  public tick(blackboard: Blackboard, deltaSeconds: number): NodeStatus {
    const status = this.child.tick(blackboard, deltaSeconds);
    if (status === "SUCCESS") return "FAILURE";
    if (status === "FAILURE") return "SUCCESS";
    return "RUNNING";
  }
}

export class ActionNode extends BTNode {
  public constructor(
    private readonly actionFn: (blackboard: Blackboard, deltaSeconds: number) => NodeStatus
  ) {
    super();
  }

  public tick(blackboard: Blackboard, deltaSeconds: number): NodeStatus {
    return this.actionFn(blackboard, deltaSeconds);
  }
}

export class ConditionNode extends BTNode {
  public constructor(private readonly predicate: (blackboard: Blackboard) => boolean) {
    super();
  }

  public tick(blackboard: Blackboard): NodeStatus {
    return this.predicate(blackboard) ? "SUCCESS" : "FAILURE";
  }
}

/* ── Nós com estado / contexto do agente (G7) ───────────────────────────── */

/** Força SUCCESS (succeeder) ou FAILURE (failer) quando o filho termina. */
export class SucceederNode extends BTNode {
  public constructor(private readonly child: BTNode, private readonly forced: NodeStatus) {
    super();
  }

  public tick(blackboard: Blackboard, deltaSeconds: number): NodeStatus {
    const status = this.child.tick(blackboard, deltaSeconds);
    return status === "RUNNING" ? "RUNNING" : this.forced;
  }
}

export class ParallelNode extends BTNode {
  public constructor(private readonly children: ReadonlyArray<BTNode>, private readonly successThreshold: number) {
    super();
  }

  public tick(blackboard: Blackboard, deltaSeconds: number): NodeStatus {
    let successes = 0;
    let failures = 0;

    for (const child of this.children) {
      const status = child.tick(blackboard, deltaSeconds);

      if (status === "SUCCESS") successes += 1;
      else if (status === "FAILURE") failures += 1;
    }

    if (successes >= this.successThreshold) return "SUCCESS";
    if (this.children.length - failures < this.successThreshold) return "FAILURE";
    return "RUNNING";
  }
}

export class RepeatNode extends BTNode {
  private iterations = 0;

  public constructor(private readonly child: BTNode, private readonly count: number) {
    super();
  }

  public tick(blackboard: Blackboard, deltaSeconds: number): NodeStatus {
    const status = this.child.tick(blackboard, deltaSeconds);

    if (status === "RUNNING") return "RUNNING";

    if (status === "FAILURE") {
      this.iterations = 0;
      return "FAILURE";
    }

    this.iterations += 1;

    if (this.count >= 0 && this.iterations >= this.count) {
      this.iterations = 0;
      return "SUCCESS";
    }

    return "RUNNING";
  }
}

export class WaitNode extends BTNode {
  private elapsed = 0;

  public constructor(private readonly seconds: number) {
    super();
  }

  public tick(_blackboard: Blackboard, deltaSeconds: number): NodeStatus {
    this.elapsed += deltaSeconds;

    if (this.elapsed + 1e-9 >= this.seconds) {
      this.elapsed = 0;
      return "SUCCESS";
    }

    return "RUNNING";
  }
}

export class BlackboardConditionNode extends BTNode {
  public constructor(
    private readonly key: string,
    private readonly hasExpected: boolean,
    private readonly expected: BlackboardValue | undefined,
  ) {
    super();
  }

  public tick(blackboard: Blackboard): NodeStatus {
    const value = blackboard.get(this.key);

    if (!this.hasExpected) {
      return value !== null && value !== undefined ? "SUCCESS" : "FAILURE";
    }

    return blackboard.has(this.key) && value === this.expected ? "SUCCESS" : "FAILURE";
  }
}

export class SetBlackboardNode extends BTNode {
  public constructor(private readonly key: string, private readonly value: BlackboardValue) {
    super();
  }

  public tick(blackboard: Blackboard): NodeStatus {
    blackboard.set(this.key, this.value);
    return "SUCCESS";
  }
}

/** Ação registrada pelo jogo, chamada com o contexto do agente. */
export class RegisteredActionNode extends BTNode {
  public constructor(
    private readonly context: BehaviorActionContext,
    private readonly fn: BehaviorActionFn,
    private readonly params: Readonly<Record<string, unknown>> | undefined,
  ) {
    super();
  }

  public tick(_blackboard: Blackboard, deltaSeconds: number): NodeStatus {
    const status = this.fn(this.context, deltaSeconds, this.params);
    return status === "SUCCESS" || status === "RUNNING" ? status : "FAILURE";
  }
}

export class RegisteredConditionNode extends BTNode {
  public constructor(
    private readonly context: BehaviorActionContext,
    private readonly fn: BehaviorConditionFn,
    private readonly params: Readonly<Record<string, unknown>> | undefined,
  ) {
    super();
  }

  public tick(): NodeStatus {
    return this.fn(this.context, this.params) === true ? "SUCCESS" : "FAILURE";
  }
}

/** Anda até um ponto: RUNNING andando, SUCCESS ao chegar, FAILURE sem caminho. */
export class MoveToNode extends BTNode {
  private requested = false;
  private readonly target = { x: 0, y: 0, z: 0 };
  private lastX = Number.NaN;
  private lastY = Number.NaN;
  private lastZ = Number.NaN;

  public constructor(
    private readonly context: BehaviorActionContext,
    private readonly position: Vector3AI | undefined,
    private readonly targetKey: string | undefined,
  ) {
    super();
  }

  public tick(blackboard: Blackboard): NodeStatus {
    if (!this.resolveTarget(blackboard)) {
      this.requested = false;
      return "FAILURE";
    }

    if (!this.requested || this.targetChanged()) {
      this.lastX = this.target.x;
      this.lastY = this.target.y;
      this.lastZ = this.target.z;

      if (!this.context.moveTo(this.target)) {
        this.requested = false;
        return "FAILURE";
      }

      this.requested = true;
    }

    if (this.context.hasArrived()) {
      this.requested = false;
      this.lastX = Number.NaN;
      return "SUCCESS";
    }

    if (!this.context.isMoving()) {
      this.requested = false;
      return "FAILURE";
    }

    return "RUNNING";
  }

  private targetChanged(): boolean {
    return this.target.x !== this.lastX || this.target.y !== this.lastY || this.target.z !== this.lastZ;
  }

  private resolveTarget(blackboard: Blackboard): boolean {
    const source = this.position ?? (this.targetKey !== undefined ? blackboard.get(this.targetKey) : undefined);

    if (typeof source !== "object" || source === null) {
      return false;
    }

    const vector = source as Partial<Vector3AI>;

    if (!Number.isFinite(vector.x) || !Number.isFinite(vector.y) || !Number.isFinite(vector.z)) {
      return false;
    }

    this.target.x = vector.x as number;
    this.target.y = vector.y as number;
    this.target.z = vector.z as number;
    return true;
  }
}

export class StopNode extends BTNode {
  public constructor(private readonly context: BehaviorActionContext) {
    super();
  }

  public tick(): NodeStatus {
    this.context.stop();
    return "SUCCESS";
  }
}

export interface BehaviorRegistry {
  getAction(name: string): BehaviorActionFn | undefined;
  getCondition(name: string): BehaviorConditionFn | undefined;
}

/**
 * Compila a definição declarativa em nós. Valida tudo: lança em tipo
 * desconhecido ou ação/condição não registrada (nada é trocado em erro).
 */
export function compileBehavior(
  definition: BehaviorNodeDefinition,
  context: BehaviorActionContext,
  registry: BehaviorRegistry,
  depth = 0,
): BTNode {
  if (depth > 64) {
    throw new Error("Árvore de comportamento profunda demais (> 64).");
  }

  if (!definition || typeof definition !== "object") {
    throw new Error("Nó de comportamento inválido.");
  }

  const compileChildren = (children: unknown): BTNode[] => {
    if (!Array.isArray(children) || children.length === 0) {
      throw new Error(`Nó "${definition.type}" precisa de filhos.`);
    }

    return children.map((child) => compileBehavior(child as BehaviorNodeDefinition, context, registry, depth + 1));
  };

  switch (definition.type) {
    case "sequence":
      return new SequenceNode(compileChildren(definition.children));
    case "selector":
      return new SelectorNode(compileChildren(definition.children));
    case "parallel": {
      const children = compileChildren(definition.children);
      const threshold = Math.max(1, Math.min(children.length, Math.floor(definition.successThreshold ?? children.length)));
      return new ParallelNode(children, threshold);
    }
    case "inverter":
      return new InverterNode(compileBehavior(definition.child, context, registry, depth + 1));
    case "succeeder":
      return new SucceederNode(compileBehavior(definition.child, context, registry, depth + 1), "SUCCESS");
    case "failer":
      return new SucceederNode(compileBehavior(definition.child, context, registry, depth + 1), "FAILURE");
    case "repeat":
      return new RepeatNode(
        compileBehavior(definition.child, context, registry, depth + 1),
        Number.isFinite(definition.count) ? Math.floor(definition.count as number) : -1,
      );
    case "wait":
      if (!Number.isFinite(definition.seconds) || definition.seconds < 0) {
        throw new Error("wait.seconds inválido.");
      }

      return new WaitNode(definition.seconds);
    case "action": {
      const fn = registry.getAction(definition.name);

      if (!fn) {
        throw new Error(`Ação de comportamento não registrada: "${definition.name}".`);
      }

      return new RegisteredActionNode(context, fn, definition.params);
    }
    case "condition": {
      const fn = registry.getCondition(definition.name);

      if (!fn) {
        throw new Error(`Condição de comportamento não registrada: "${definition.name}".`);
      }

      return new RegisteredConditionNode(context, fn, definition.params);
    }
    case "blackboard":
      if (typeof definition.key !== "string") {
        throw new Error("blackboard.key inválido.");
      }

      return new BlackboardConditionNode(definition.key, "equals" in definition, definition.equals);
    case "set-blackboard":
      if (typeof definition.key !== "string") {
        throw new Error("set-blackboard.key inválido.");
      }

      return new SetBlackboardNode(definition.key, definition.value);
    case "move-to":
      if (!definition.position && typeof definition.targetKey !== "string") {
        throw new Error("move-to precisa de position ou targetKey.");
      }

      return new MoveToNode(context, definition.position, definition.targetKey);
    case "stop":
      return new StopNode(context);
    default:
      throw new Error(`Tipo de nó desconhecido: "${String((definition as { type?: unknown }).type)}".`);
  }
}

export class BehaviorTree {
  private readonly blackboard: Blackboard;

  public constructor(private root: BTNode, blackboard?: Blackboard) {
    this.blackboard = blackboard ?? new Blackboard();
  }

  /** Troca a raiz mantendo o blackboard (G7: árvore por agente). */
  public setRoot(root: BTNode): void {
    this.root = root;
  }

  public get memory(): Blackboard {
    return this.blackboard;
  }

  public tick(deltaSeconds: number): NodeStatus {
    return this.root.tick(this.blackboard, deltaSeconds);
  }
}
