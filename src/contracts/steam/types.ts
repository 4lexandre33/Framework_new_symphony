import { defineCommand } from "@core";

export interface UnlockAchievementRequest {
  readonly achievementId: string;
}

export const UnlockAchievementCommand = defineCommand<
  "game.steam.unlock-achievement",
  UnlockAchievementRequest
>("game.steam.unlock-achievement");