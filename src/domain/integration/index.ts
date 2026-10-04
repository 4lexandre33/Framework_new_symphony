export {
  ConditionStateIntegrationStructuralError,
  resolveConditionsFromState,
} from "./ConditionStateIntegration";

export type {
  ConditionStateIntegrationError,
  ConditionStateIntegrationErrorCode,
  ConditionStateIntegrationResult,
  ConditionStateResolution,
} from "./ConditionStateIntegration";

export {
  InteractionConditionIntegrationStructuralError,
  resolveInteractionWithConditions,
} from "./InteractionConditionIntegration";

export type {
  InteractionConditionBinding,
  InteractionConditionEvaluationError,
  InteractionConditionIntegrationErrorCode,
  InteractionConditionIntegrationResult,
} from "./InteractionConditionIntegration";

export {
  createLocationEnteredEvent,
  LOCATION_ENTERED_EVENT_TYPE_ID,
  LOCATION_EVENT_SOURCE_TYPE_ID,
} from "./LocationEventIntegration";

export type {
  CreateLocationEnteredEventOptions,
} from "./LocationEventIntegration";

export {
  advanceStatusEffectsByTime,
} from "./StatusEffectTimeIntegration";

export type {
  StatusEffectTimeAdvanceResult,
} from "./StatusEffectTimeIntegration";

export {
  createQuestStateProjection,
  createQuestUpdatedEvent,
  projectQuestStateToState,
  QUEST_EVENT_SOURCE_TYPE_ID,
  QUEST_UPDATED_EVENT_TYPE_ID,
} from "./QuestIntegration";

export type {
  CreateQuestUpdatedEventOptions,
} from "./QuestIntegration";

export {
  grantRewardAtomically,
  RewardGrantIntegrationError,
} from "./RewardGrantIntegration";

export type {
  RewardGrantAccepted,
  RewardGrantContext,
  RewardGrantIntegrationErrorCode,
  RewardGrantRejected,
  RewardGrantRejectionReason,
  RewardGrantResult,
} from "./RewardGrantIntegration";

export {
  applyProgressionUnlocks,
  ProgressionUnlockPlan,
  ProgressionUnlockPlanError,
} from "./ProgressionUnlockIntegration";

export type {
  LevelUnlockRule,
  ProgressionUnlockApplyResult,
  ProgressionUnlockPlanErrorCode,
} from "./ProgressionUnlockIntegration";
