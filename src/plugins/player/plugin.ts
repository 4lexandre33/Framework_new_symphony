import type { Plugin, PluginContext } from "@core";
import { defineCapability } from "@core";

export interface PlayerStats {
  readonly hp: number;
  readonly maxHp: number;
  readonly level: number;
}

export interface PlayerApi {
  getStats(): PlayerStats;
  defeatBoss(bossId: string, noDamageTaken: boolean): void;
}

export const PlayerToken = defineCapability<PlayerApi>("game.player", "1.0.0");

export const playerManifest: Plugin["manifest"] = {
  id: "game.player",
  name: "Player System Plugin",
  version: "1.0.0",
  kind: "preloaded",
  authority: "game",
  permissions: {
    capabilities: [PlayerToken.id],
    events: ["game.boss-defeated"],
  },
  capabilities: {
    provides: [
      {
        id: PlayerToken.id,
        version: "1.0.0",
      },
    ],
    conflicts: [],
  },
};

export class PlayerService implements PlayerApi {
  private hp = 100;
  private maxHp = 100;
  private level = 1;

  constructor(private readonly ctx: PluginContext) {}

  getStats(): PlayerStats {
    return {
      hp: this.hp,
      maxHp: this.maxHp,
      level: this.level,
    };
  }

  defeatBoss(bossId: string, noDamageTaken: boolean): void {
    this.ctx.events.emit("game.boss-defeated", {
      bossId,
      durationSeconds: 45,
      noDamageTaken,
    });
  }
}

export function createPlayerPlugin(): Plugin {
  return {
    manifest: playerManifest,

    setup(ctx: PluginContext) {
      const playerService = new PlayerService(ctx);

      ctx.caps.provide(PlayerToken, playerService);

      ctx.lifecycle.ready();
    },
  };
}