import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

export type QuestId =
  DomainId<"quest">;

export function createQuestId(
  value: string,
): QuestId {
  return createDomainId<
    "quest"
  >(value);
}
