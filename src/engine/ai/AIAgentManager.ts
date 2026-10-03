import type {
  AIAgentConfig,
  BlackboardValue,
  NavMeshPathResult,
  PerceptionSenseType,
  Vector3AI,
} from "../../contracts/ai/types";

import type {
  PhysicsApi,
} from "../../tokens/physics";

import {
  NavMeshQuery,
} from "./NavMeshQuery";

import {
  ActionNode,
  BehaviorTree,
  ConditionNode,
  SelectorNode,
  SequenceNode,
} from "./BehaviorTree";

import {
  PerceptionSystem,
} from "./PerceptionSystem";

import {
  SteeringBehaviors,
} from "./SteeringBehaviors";

interface MutableVector3AI {
  x: number;
  y: number;
  z: number;
}

export interface AIAgentManagerHooks {
  onPathCalculated?(
    agentId: string,
    result:
      NavMeshPathResult,
  ): void;

  onBehaviorStateChanged?(
    agentId: string,
    previousState: string,
    newState: string,
  ): void;

  onTargetSpotted?(
    agentId: string,
    targetEntityId:
      string | undefined,
    position:
      Vector3AI,
    senseType:
      Exclude<
        PerceptionSenseType,
        "none"
      >,
  ): void;
}

interface ActiveAIAgent {
  readonly config:
    AIAgentConfig;

  readonly behaviorTree:
    BehaviorTree;

  readonly position:
    MutableVector3AI;

  readonly velocity:
    MutableVector3AI;

  readonly forwardDir:
    MutableVector3AI;

  currentWaypoints:
    ReadonlyArray<Vector3AI>;

  currentWaypointIndex:
    number;

  targetSpotted:
    boolean;
}

const EMPTY_WAYPOINTS:
  ReadonlyArray<Vector3AI> =
    Object.freeze([]);

export class AIAgentManager {
  private readonly agents =
    new Map<
      string,
      ActiveAIAgent
    >();

  private readonly navMeshQuery =
    new NavMeshQuery();

  private readonly perceptionSystem =
    new PerceptionSystem();

  private readonly steering =
    new SteeringBehaviors();

  public constructor(
    private readonly hooks:
      AIAgentManagerHooks = {},
  ) {}

  public get navMesh():
    NavMeshQuery {
    return this.navMeshQuery;
  }

  public registerAgent(
    config:
      AIAgentConfig,
  ): boolean {
    if (
      config.agentId.length ===
        0 ||
      this.agents.has(
        config.agentId,
      )
    ) {
      return false;
    }

    const behaviorTree =
      new BehaviorTree(
        new SelectorNode([
          new SequenceNode([
            new ConditionNode(
              (
                blackboard,
              ): boolean =>
                blackboard.get(
                  "hasTarget",
                ) ===
                true,
            ),

            new ActionNode(
              (
                blackboard,
              ) => {
                const target =
                  blackboard.get(
                    "targetPos",
                  );

                if (
                  this.isVector3(
                    target,
                  )
                ) {
                  blackboard.set(
                    "status",
                    "chasing",
                  );

                  return "SUCCESS";
                }

                return "FAILURE";
              },
            ),
          ]),

          new ActionNode(
            (
              blackboard,
            ) => {
              blackboard.set(
                "status",
                "patrolling",
              );

              return "SUCCESS";
            },
          ),
        ]),
      );

    const initialPosition =
      config.initialPosition ?? {
        x: 0,
        y: 0,
        z: 0,
      };

    const initialForward =
      config
        .initialForwardDirection ?? {
        x: 0,
        y: 0,
        z: 1,
      };

    this.agents.set(
      config.agentId,
      {
        config,

        behaviorTree,

        position: {
          x:
            initialPosition.x,

          y:
            initialPosition.y,

          z:
            initialPosition.z,
        },

        velocity: {
          x: 0,
          y: 0,
          z: 0,
        },

        forwardDir:
          this.createNormalizedVector(
            initialForward,
            {
              x: 0,
              y: 0,
              z: 1,
            },
          ),

        currentWaypoints:
          EMPTY_WAYPOINTS,

        currentWaypointIndex:
          0,

        targetSpotted:
          false,
      },
    );

    return true;
  }

  public unregisterAgent(
    agentId: string,
  ): boolean {
    return this.agents.delete(
      agentId,
    );
  }

  public setAgentTarget(
    agentId: string,
    targetPos:
      Vector3AI,
  ): NavMeshPathResult {
    const agent =
      this.agents.get(
        agentId,
      );

    if (!agent) {
      return {
        found:
          false,

        waypoints:
          EMPTY_WAYPOINTS,

        totalDistance:
          0,
      };
    }

    const result =
      this.navMeshQuery.findPath({
        start:
          agent.position,

        target:
          targetPos,

        agentRadius:
          agent.config
            .navAgentRadius,
      });

    if (
      result.found
    ) {
      agent.currentWaypoints =
        result.waypoints;

      agent.currentWaypointIndex =
        0;

      agent.behaviorTree
        .memory.set(
          "hasTarget",
          true,
        );

      agent.behaviorTree
        .memory.set(
          "targetPos",
          {
            x:
              targetPos.x,

            y:
              targetPos.y,

            z:
              targetPos.z,
          },
        );

      agent.targetSpotted =
        false;
    } else {
      this.clearTarget(
        agent,
      );
    }

    this.hooks
      .onPathCalculated?.(
        agentId,
        result,
      );

    return result;
  }

  public setBlackboardValue(
    agentId: string,
    key: string,
    value:
      BlackboardValue,
  ): void {
    this.agents
      .get(
        agentId,
      )
      ?.behaviorTree
      .memory.set(
        key,
        value,
      );
  }

  public getBlackboardValue(
    agentId: string,
    key: string,
  ): BlackboardValue | undefined {
    return this.agents
      .get(
        agentId,
      )
      ?.behaviorTree
      .memory.get(
        key,
      );
  }

  public getAgentPosition(
    agentId: string,
  ): Vector3AI | null {
    const position =
      this.agents.get(
        agentId,
      )?.position;

    if (!position) {
      return null;
    }

    return {
      x:
        position.x,

      y:
        position.y,

      z:
        position.z,
    };
  }

  public triggerAudioStimulus(
    position:
      Vector3AI,
    loudnessRadius:
      number,
    sourceEntityId?:
      string,
  ): void {
    const radius =
      this.sanitizeNonNegative(
        loudnessRadius,
      );

    const radiusSquared =
      radius *
      radius;

    for (
      const agent of
      this.agents.values()
    ) {
      const dx =
        position.x -
        agent.position.x;

      const dy =
        position.y -
        agent.position.y;

      const dz =
        position.z -
        agent.position.z;

      const distanceSquared =
        dx * dx +
        dy * dy +
        dz * dz;

      if (
        distanceSquared >
        radiusSquared
      ) {
        continue;
      }

      if (sourceEntityId) {
        agent.behaviorTree
          .memory.set(
            "targetEntityId",
            sourceEntityId,
          );
      }

      this.setAgentTarget(
        agent.config.agentId,
        position,
      );
    }
  }

  public update(
    deltaSeconds:
      number,
    physics:
      PhysicsApi | null =
        null,
  ): void {
    const safeDelta =
      this.sanitizeDelta(
        deltaSeconds,
      );

    if (
      safeDelta <=
      0
    ) {
      return;
    }

    for (
      const agent of
      this.agents.values()
    ) {
      const previousStatus =
        this.readString(
          agent.behaviorTree
            .memory.get(
              "status",
            ),
        ) ??
        "none";

      agent.behaviorTree.tick(
        safeDelta,
      );

      const currentStatus =
        this.readString(
          agent.behaviorTree
            .memory.get(
              "status",
            ),
        ) ??
        "none";

      if (
        currentStatus !==
        previousStatus
      ) {
        this.hooks
          .onBehaviorStateChanged?.(
            agent.config
              .agentId,
            previousStatus,
            currentStatus,
          );
      }

      this.updatePerception(
        agent,
        physics,
      );

      this.updateLocomotion(
        agent,
        safeDelta,
      );
    }
  }

  public clear(): void {
    this.agents.clear();

    this.navMeshQuery.clear();
  }

  private updatePerception(
    agent:
      ActiveAIAgent,
    physics:
      PhysicsApi | null,
  ): void {
    const rawTarget =
      agent.behaviorTree
        .memory.get(
          "targetPos",
        );

    if (
      !this.isVector3(
        rawTarget,
      ) ||
      !agent.config
        .perceptionConfig
    ) {
      agent.targetSpotted =
        false;

      return;
    }

    const result =
      this.perceptionSystem
        .checkPerception(
          agent.position,
          agent.forwardDir,
          rawTarget,
          agent.config
            .perceptionConfig,
          physics,
        );

    agent.behaviorTree
      .memory.set(
        "targetSpotted",
        result.targetSpotted,
      );

    /*
     * Emite somente na borda false -> true.
     * Não gera spam de evento a cada tick.
     */
    if (
      result.targetSpotted &&
      !agent.targetSpotted &&
      result.senseType !==
        "none"
    ) {
      const targetEntityId =
        this.readString(
          agent.behaviorTree
            .memory.get(
              "targetEntityId",
            ),
        );

      this.hooks
        .onTargetSpotted?.(
          agent.config
            .agentId,
          targetEntityId,
          rawTarget,
          result.senseType,
        );
    }

    agent.targetSpotted =
      result.targetSpotted;
  }

  private updateLocomotion(
    agent:
      ActiveAIAgent,
    deltaSeconds:
      number,
  ): void {
    const stoppingDistance =
      Math.max(
        0.01,
        this.sanitizeNonNegative(
          agent.config
            .stoppingDistance ??
            1,
        ),
      );

    /*
     * Ignora imediatamente waypoints
     * que já foram alcançados.
     */
    while (
      agent.currentWaypointIndex <
      agent.currentWaypoints.length
    ) {
      const waypoint =
        agent.currentWaypoints[
          agent.currentWaypointIndex
        ];

      if (!waypoint) {
        break;
      }

      const dx =
        waypoint.x -
        agent.position.x;

      const dy =
        waypoint.y -
        agent.position.y;

      const dz =
        waypoint.z -
        agent.position.z;

      if (
        dx * dx +
          dy * dy +
          dz * dz >
        stoppingDistance *
          stoppingDistance
      ) {
        break;
      }

      agent.currentWaypointIndex +=
        1;
    }

    if (
      agent.currentWaypointIndex >=
      agent.currentWaypoints.length
    ) {
      if (
        agent.currentWaypoints.length >
        0
      ) {
        this.completePath(
          agent,
        );
      }

      return;
    }

    const waypoint =
      agent.currentWaypoints[
        agent.currentWaypointIndex
      ];

    if (!waypoint) {
      return;
    }

    const maxSpeed =
      this.sanitizeNonNegative(
        agent.config.maxSpeed ??
          5,
      );

    const maxForce =
      this.sanitizeNonNegative(
        agent.config.maxForce ??
          10,
      );

    const force =
      this.steering.arrive(
        agent.position,
        agent.velocity,
        waypoint,
        maxSpeed,
        maxForce,
        Math.max(
          stoppingDistance *
            2,
          0.01,
        ),
      );

    agent.velocity.x +=
      force.x *
      deltaSeconds;

    agent.velocity.y +=
      force.y *
      deltaSeconds;

    agent.velocity.z +=
      force.z *
      deltaSeconds;

    this.clampVectorLength(
      agent.velocity,
      maxSpeed,
    );

    agent.position.x +=
      agent.velocity.x *
      deltaSeconds;

    agent.position.y +=
      agent.velocity.y *
      deltaSeconds;

    agent.position.z +=
      agent.velocity.z *
      deltaSeconds;

    const velocitySquared =
      agent.velocity.x *
        agent.velocity.x +
      agent.velocity.y *
        agent.velocity.y +
      agent.velocity.z *
        agent.velocity.z;

    if (
      velocitySquared >
      0.00000001
    ) {
      const inverseSpeed =
        1 /
        Math.sqrt(
          velocitySquared,
        );

      agent.forwardDir.x =
        agent.velocity.x *
        inverseSpeed;

      agent.forwardDir.y =
        agent.velocity.y *
        inverseSpeed;

      agent.forwardDir.z =
        agent.velocity.z *
        inverseSpeed;
    }
  }

  private completePath(
    agent:
      ActiveAIAgent,
  ): void {
    agent.currentWaypoints =
      EMPTY_WAYPOINTS;

    agent.currentWaypointIndex =
      0;

    agent.velocity.x =
      0;

    agent.velocity.y =
      0;

    agent.velocity.z =
      0;

    agent.behaviorTree
      .memory.set(
        "hasTarget",
        false,
      );

    agent.behaviorTree
      .memory.set(
        "targetPos",
        null,
      );

    const previousStatus =
      this.readString(
        agent.behaviorTree
          .memory.get(
            "status",
          ),
      ) ??
      "none";

    agent.behaviorTree
      .memory.set(
        "status",
        "arrived",
      );

    if (
      previousStatus !==
      "arrived"
    ) {
      this.hooks
        .onBehaviorStateChanged?.(
          agent.config.agentId,
          previousStatus,
          "arrived",
        );
    }
  }

  private clearTarget(
    agent:
      ActiveAIAgent,
  ): void {
    agent.currentWaypoints =
      EMPTY_WAYPOINTS;

    agent.currentWaypointIndex =
      0;

    agent.behaviorTree
      .memory.set(
        "hasTarget",
        false,
      );

    agent.behaviorTree
      .memory.set(
        "targetPos",
        null,
      );

    agent.targetSpotted =
      false;
  }

  private isVector3(
    value:
      BlackboardValue |
      undefined,
  ): value is Vector3AI {
    if (
      typeof value !==
        "object" ||
      value ===
        null
    ) {
      return false;
    }

    const candidate =
      value as
        Partial<Vector3AI>;

    return (
      typeof candidate.x ===
        "number" &&
      Number.isFinite(
        candidate.x,
      ) &&
      typeof candidate.y ===
        "number" &&
      Number.isFinite(
        candidate.y,
      ) &&
      typeof candidate.z ===
        "number" &&
      Number.isFinite(
        candidate.z,
      )
    );
  }

  private readString(
    value:
      BlackboardValue |
      undefined,
  ): string | undefined {
    return typeof value ===
      "string"
      ? value
      : undefined;
  }

  private createNormalizedVector(
    source:
      Vector3AI,
    fallback:
      MutableVector3AI,
  ): MutableVector3AI {
    const length =
      Math.sqrt(
        source.x *
          source.x +
        source.y *
          source.y +
        source.z *
          source.z,
      );

    if (
      length <=
      0.000001
    ) {
      return {
        x:
          fallback.x,

        y:
          fallback.y,

        z:
          fallback.z,
      };
    }

    const inverseLength =
      1 /
      length;

    return {
      x:
        source.x *
        inverseLength,

      y:
        source.y *
        inverseLength,

      z:
        source.z *
        inverseLength,
    };
  }

  private clampVectorLength(
    vector:
      MutableVector3AI,
    maximumLength:
      number,
  ): void {
    if (
      maximumLength <=
      0
    ) {
      vector.x =
        0;

      vector.y =
        0;

      vector.z =
        0;

      return;
    }

    const lengthSquared =
      vector.x *
        vector.x +
      vector.y *
        vector.y +
      vector.z *
        vector.z;

    const maximumSquared =
      maximumLength *
      maximumLength;

    if (
      lengthSquared <=
      maximumSquared
    ) {
      return;
    }

    const scale =
      maximumLength /
      Math.sqrt(
        lengthSquared,
      );

    vector.x *=
      scale;

    vector.y *=
      scale;

    vector.z *=
      scale;
  }

  private sanitizeDelta(
    value: number,
  ): number {
    if (
      !Number.isFinite(
        value,
      )
    ) {
      return 0;
    }

    /*
     * IA não tenta recuperar segundos inteiros
     * de uma vez após breakpoint/stall.
     */
    return Math.max(
      0,
      Math.min(
        value,
        0.1,
      ),
    );
  }

  private sanitizeNonNegative(
    value: number,
  ): number {
    if (
      !Number.isFinite(
        value,
      )
    ) {
      return 0;
    }

    return Math.max(
      0,
      value,
    );
  }
}