import {
  defineCommand,
  defineEvent,
} from "@core";

export type NodeStatus =
  | "SUCCESS"
  | "FAILURE"
  | "RUNNING";

export type PerceptionSenseType =
  | "vision"
  | "hearing"
  | "none";

export interface Vector3AI {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface NavMeshPolygon {
  readonly id: number;

  readonly vertices:
    ReadonlyArray<Vector3AI>;

  readonly neighbors:
    ReadonlyArray<number>;

  readonly center:
    Vector3AI;
}

export interface NavMeshGraph {
  readonly polygons:
    ReadonlyArray<NavMeshPolygon>;
}

export interface NavMeshPathRequest {
  readonly start:
    Vector3AI;

  readonly target:
    Vector3AI;

  readonly agentRadius?:
    number;
}

export interface NavMeshPathResult {
  readonly found:
    boolean;

  readonly waypoints:
    ReadonlyArray<Vector3AI>;

  readonly totalDistance:
    number;
}

export interface PerceptionSenseConfig {
  readonly visionAngleDegrees?:
    number;

  readonly visionDistance?:
    number;

  readonly hearingRadius?:
    number;

  readonly checkLineOfSight?:
    boolean;
}

export type BlackboardValue =
  | string
  | number
  | boolean
  | Vector3AI
  | object
  | null;

export interface AIAgentConfig {
  readonly agentId:
    string;

  readonly entityId:
    string;

  readonly perceptionConfig?:
    PerceptionSenseConfig;

  readonly maxSpeed?:
    number;

  readonly maxForce?:
    number;

  readonly stoppingDistance?:
    number;

  readonly navAgentRadius?:
    number;

  readonly initialPosition?:
    Vector3AI;

  readonly initialForwardDirection?:
    Vector3AI;
}

/* ============================================================================
 * EVENTS
 * ========================================================================== */

export interface PathCalculatedPayload {
  readonly agentId:
    string;

  readonly waypointsCount:
    number;

  readonly success:
    boolean;

  readonly totalDistance:
    number;
}

export const PathCalculatedEvent =
  defineEvent<
    "game.ai.path-calculated",
    PathCalculatedPayload
  >(
    "game.ai.path-calculated",
  );

export interface BehaviorStateChangedPayload {
  readonly agentId:
    string;

  readonly previousState:
    string;

  readonly newState:
    string;
}

export const BehaviorStateChangedEvent =
  defineEvent<
    "game.ai.behavior-changed",
    BehaviorStateChangedPayload
  >(
    "game.ai.behavior-changed",
  );

export interface TargetSpottedPayload {
  readonly agentId:
    string;

  readonly targetEntityId?:
    string;

  readonly position:
    Vector3AI;

  readonly senseType:
    Exclude<
      PerceptionSenseType,
      "none"
    >;
}

export const TargetSpottedEvent =
  defineEvent<
    "game.ai.target-spotted",
    TargetSpottedPayload
  >(
    "game.ai.target-spotted",
  );

/* ============================================================================
 * COMMANDS
 * ========================================================================== */

export interface RequestPathRequest {
  readonly agentId:
    string;

  readonly targetPosition:
    Vector3AI;
}

export const RequestPathCommand =
  defineCommand<
    "game.ai.request-path",
    RequestPathRequest
  >(
    "game.ai.request-path",
  );

export interface SetAgentTargetRequest {
  readonly agentId:
    string;

  readonly targetEntityId:
    string;
}

export const SetAgentTargetCommand =
  defineCommand<
    "game.ai.set-agent-target",
    SetAgentTargetRequest
  >(
    "game.ai.set-agent-target",
  );

export interface SetBlackboardValueRequest {
  readonly agentId:
    string;

  readonly key:
    string;

  readonly value:
    BlackboardValue;
}

export const SetBlackboardValueCommand =
  defineCommand<
    "game.ai.set-blackboard",
    SetBlackboardValueRequest
  >(
    "game.ai.set-blackboard",
  );