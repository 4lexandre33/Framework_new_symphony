// Conquistas/stats: a regra "quando" é do jogo. Sem Steam tudo resolve false e nada quebra.
import type { SteamApi } from "../../../tokens/steam";

/** true se a Steam confirmou. Sem Steam (ou stats ainda não carregadas) devolve false: tente de novo depois. */
export async function unlock(steam: SteamApi, achievementId: string): Promise<boolean> {
  if (!steam.isAvailable && !(await steam.checkAvailability())) return false;
  return steam.unlockAchievement(achievementId);
}

export async function addDistance(steam: SteamApi, totalMeters: number): Promise<boolean> {
  const ok = await steam.setStat("distancia_total", Math.floor(totalMeters)); // int 32 bits; float: { type: "float" }
  return ok && (await steam.storeStats());
}
// Alternativa por comando: await ctx.commands.send(UnlockAchievementCommand.type, { achievementId }) também resolve com o retorno do handler.
// O jogo deve funcionar sem Steam: nunca bloqueie gameplay esperando resposta.
