// Lógica de jogo no tick fixo. A física já avança sozinha no mesmo tick; aqui só a sua lógica.
import type { PluginContext } from "@core";
import type { GameTickPayload } from "../../../contracts/game-loop/types";
import { GameTickEvent } from "../../../contracts/game-loop/types";

export function onFixedTick(ctx: PluginContext, update: (dt: number, total: number) => void): () => void {
  // GameTickEvent.type === "game.loop.tick"; declare-o em permissions.events se o plugin também emitir
  return ctx.events.on<"game.loop.tick", GameTickPayload>(GameTickEvent.type, (env): void => {
    update(env.payload.deltaSeconds, env.payload.totalTimeSeconds);
  });
}
// Não aloque objetos por tick. Pause/retome com ctx.commands.send("game.loop.pause" | "game.loop.resume", {}).
