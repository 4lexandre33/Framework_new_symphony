import type { NodeStatus, BlackboardValue } from "../../../contracts/ai/types";

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

export class BehaviorTree {
  private readonly blackboard = new Blackboard();

  public constructor(private readonly root: BTNode) {}

  public get memory(): Blackboard {
    return this.blackboard;
  }

  public tick(deltaSeconds: number): NodeStatus {
    return this.root.tick(this.blackboard, deltaSeconds);
  }
}