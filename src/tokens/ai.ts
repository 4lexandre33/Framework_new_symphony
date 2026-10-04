import {
  defineCapability,
} from "@core";

import type {
  AIAgentConfig,
  BlackboardValue,
  NavMeshGraph,
  NavMeshPathRequest,
  NavMeshPathResult,
  Vector3AI,
} from "../contracts/ai/types";

export interface AiApi {
  loadNavMesh(
    graph: NavMeshGraph,
  ): void;

  findPath(
    request: NavMeshPathRequest,
  ): NavMeshPathResult;

  registerAgent(
    config: AIAgentConfig,
  ): boolean;

  unregisterAgent(
    agentId: string,
  ): boolean;

  setAgentTarget(
    agentId: string,
    targetPos: Vector3AI,
  ): NavMeshPathResult;

  setAgentTargetEntity(
    agentId: string,
    targetEntityId: string,
  ): boolean;

  setBlackboardValue(
    agentId: string,
    key: string,
    value: BlackboardValue,
  ): void;

  getBlackboardValue(
    agentId: string,
    key: string,
  ): BlackboardValue | undefined;

  getAgentPosition(
    agentId: string,
  ): Vector3AI | null;

  triggerAudioStimulus(
    position: Vector3AI,
    loudnessRadius: number,
    sourceEntityId?: string,
  ): void;

  update(
    deltaSeconds: number,
  ): void;
}

export const AiToken =
  defineCapability<AiApi>(
    "game.ai",
    "1.0.0",
  );