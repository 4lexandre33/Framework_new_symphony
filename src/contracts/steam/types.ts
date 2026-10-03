import { defineEvent, defineCommand } from "../../core/contracts";

export interface BossDefeatedPayload {
  readonly bossId: string;
  readonly durationSeconds: number;
  readonly noDamageTaken: boolean;
}

export const BossDefeatedEvent = defineEvent<"game.boss-defeated", BossDefeatedPayload>(
  "game.boss-defeated"
);

export interface UnlockAchievementRequest {
  readonly achievementId: string;
}

export const UnlockAchievementCommand = defineCommand<
  "game.steam.unlock-achievement",
  UnlockAchievementRequest
>("game.steam.unlock-achievement");