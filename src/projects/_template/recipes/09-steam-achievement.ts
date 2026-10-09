// Conquistas: a regra "quando" é do jogo. Envie o comando (Promise<void>, sem valor de retorno); sem Steam o desbloqueio é no-op e nada quebra.
import type { PluginContext } from "@core";
import { UnlockAchievementCommand } from "../../../contracts/steam/types";

export async function unlock(ctx: PluginContext, achievementId: string): Promise<void> {
  await ctx.commands.send(UnlockAchievementCommand.type, { achievementId });
}
// O jogo deve funcionar sem Steam: nunca bloqueie gameplay esperando resposta.
