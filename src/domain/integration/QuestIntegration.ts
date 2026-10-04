import {
  createDomainEvent,
  createDomainEventMetadata,
  createDomainEventSourceId,
  createDomainEventSourceRef,
  createDomainEventSourceTypeId,
  createDomainEventTypeId,
} from "../events";

import type {
  DomainEvent,
  DomainEventId,
} from "../events";

import type {
  QuestState,
  QuestStatus,
} from "../narrative";

import type {
  StateKey,
  StateStore,
  StateValue,
} from "../state";

import type {
  SimulationTick,
} from "../time";

export const QUEST_UPDATED_EVENT_TYPE_ID =
  createDomainEventTypeId(
    "quest.updated",
  );

export const QUEST_EVENT_SOURCE_TYPE_ID =
  createDomainEventSourceTypeId(
    "quest",
  );

export interface CreateQuestUpdatedEventOptions {
  readonly eventId:
    DomainEventId;
  readonly sequence:
    number;
  readonly tick:
    SimulationTick;
  readonly quest:
    QuestState;
  readonly previousStatus:
    QuestStatus | null;
}

/**
 * Cria uma projeção serializável de QuestState adequada para StateStore/Event.
 */
export function createQuestStateProjection(
  quest:
    QuestState,
): StateValue {
  const snapshot =
    quest.toSnapshot();

  return {
    questId:
      snapshot.questId,
    status:
      snapshot.status,
    goals:
      snapshot.goals.map(
        (goal) => ({
          goalId:
            goal.id,
          status:
            goal.status,
          progress:
            goal.progress,
          requiredProgress:
            goal.requiredProgress,
        }),
      ),
  };
}

/**
 * Projeta QuestState em uma StateKey definida pelo chamador.
 */
export function projectQuestStateToState(
  quest:
    QuestState,
  state:
    StateStore,
  key:
    StateKey,
): StateValue {
  return state.set(
    key,
    createQuestStateProjection(
      quest,
    ),
  );
}

/**
 * Traduz o estado atual de uma quest em DomainEvent sem publicar.
 */
export function createQuestUpdatedEvent(
  options:
    CreateQuestUpdatedEventOptions,
): DomainEvent {
  const metadata =
    createDomainEventMetadata(
      options.sequence,
      options.tick,
      createDomainEventSourceRef(
        QUEST_EVENT_SOURCE_TYPE_ID,
        createDomainEventSourceId(
          options.quest.questId,
        ),
      ),
    );

  return createDomainEvent({
    id: options.eventId,
    typeId:
      QUEST_UPDATED_EVENT_TYPE_ID,
    metadata,
    payload: {
      previousStatus:
        options.previousStatus,
      current:
        createQuestStateProjection(
          options.quest,
        ),
    },
  });
}
