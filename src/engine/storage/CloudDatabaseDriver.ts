import type { PlayerOnlineProfile } from "../../contracts/storage/types";

export class CloudDatabaseDriver {
  private readonly profilesCache = new Map<string, PlayerOnlineProfile>();

  public async syncProfile(profile: PlayerOnlineProfile): Promise<boolean> {
    try {
      // Simulação de comunicação com API REST do BaaS (Supabase / Firebase / PostgreSQL)
      this.profilesCache.set(profile.playerId, profile);
      console.log(`[CloudDatabaseDriver] 🌐 Perfil online do jogador '${profile.displayName}' sincronizado no BaaS.`);
      return true;
    } catch (err) {
      console.error(`[CloudDatabaseDriver] ❌ Falha ao sincronizar perfil remoto:`, err);
      return false;
    }
  }

  public async fetchProfile(playerId: string): Promise<PlayerOnlineProfile | null> {
    try {
      const profile = this.profilesCache.get(playerId) || null;
      if (profile) {
        console.log(`[CloudDatabaseDriver] 🌐 Perfil do jogador '${playerId}' baixado do servidor remoto.`);
      }
      return profile;
    } catch (err) {
      console.error(`[CloudDatabaseDriver] ❌ Erro ao consultar perfil remoto:`, err);
      return null;
    }
  }
}