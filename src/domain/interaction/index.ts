export {
  Affordance,
  AffordanceError,
} from "./Affordance";

export type {
  AffordanceCreateOptions,
  AffordanceErrorCode,
  AffordanceSnapshot,
} from "./Affordance";

export {
  createInteractionId,
} from "./InteractionId";

export type {
  InteractionId,
} from "./InteractionId";

export {
  createInteractionActorId,
  createInteractionActorRef,
  createInteractionActorTypeId,
  createInteractionIntent,
  createInteractionTargetId,
  createInteractionTargetRef,
  createInteractionTargetTypeId,
  sameInteractionTargetRef,
} from "./InteractionIntent";

export type {
  InteractionActorId,
  InteractionActorRef,
  InteractionActorTypeId,
  InteractionIntent,
  InteractionTargetId,
  InteractionTargetRef,
  InteractionTargetTypeId,
} from "./InteractionIntent";

export {
  InteractionOutcomeError,
  resolveInteractionOutcome,
} from "./InteractionOutcome";

export type {
  InteractionAcceptedOutcome,
  InteractionOutcome,
  InteractionOutcomeErrorCode,
  InteractionRejectedOutcome,
  InteractionRejectionReason,
} from "./InteractionOutcome";

export {
  createInteractionRequirement,
  createInteractionRequirementId,
  createInteractionRequirementResolution,
} from "./InteractionRequirement";

export type {
  InteractionRequirement,
  InteractionRequirementId,
  InteractionRequirementResolution,
} from "./InteractionRequirement";
