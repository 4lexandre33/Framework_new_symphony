import type { SaveGameMetadata } from "../../../contracts/storage/types";

export class LocalDatabaseDriver {
  private readonly storagePrefix = "local_db_save_";

  public async saveGame(slotName: string, data: Record<string, unknown>): Promise<SaveGameMetadata> {
    const timestamp = Date.now();
    const saveId = `local_save_${slotName}_${timestamp}`;
    const payload = JSON.stringify(data);
    const checksum = this.calculateChecksum(payload);

    const metadata: SaveGameMetadata = {
      saveId,
      slotName,
      playTimeSeconds: (data.playTimeSeconds as number) || 0,
      timestamp,
      gameVersion: (data.gameVersion as string) || "1.0.0",
      checksum,
    };

    const container = {
      metadata,
      data,
    };

    localStorage.setItem(`${this.storagePrefix}${slotName}`, JSON.stringify(container));
    console.log(`[LocalDatabaseDriver] 💾 Save '${slotName}' gravado com sucesso no banco de dados local.`);

    return metadata;
  }

  public async loadGame<T = Record<string, unknown>>(slotName: string): Promise<T | null> {
    const raw = localStorage.getItem(`${this.storagePrefix}${slotName}`);
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      console.log(`[LocalDatabaseDriver] 💾 Save '${slotName}' carregado do banco de dados local.`);
      return parsed.data as T;
    } catch {
      return null;
    }
  }

  public async listSaves(): Promise<SaveGameMetadata[]> {
    const saves: SaveGameMetadata[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(this.storagePrefix)) {
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed.metadata) saves.push(parsed.metadata);
          }
        } catch {
          // Ignora registros corrompidos
        }
      }
    }
    return saves;
  }

  public async deleteSave(slotName: string): Promise<boolean> {
    const key = `${this.storagePrefix}${slotName}`;
    if (localStorage.getItem(key) !== null) {
      localStorage.removeItem(key);
      console.log(`[LocalDatabaseDriver] 🗑️ Save '${slotName}' removido do banco local.`);
      return true;
    }
    return false;
  }

  private calculateChecksum(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  }
}