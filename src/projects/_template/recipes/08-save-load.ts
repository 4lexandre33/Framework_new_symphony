// Saves por slot (driver padrão local). Só dados serializáveis.
import type { StorageApi } from "../../../tokens/storage";

interface SaveData extends Record<string, unknown> {
  level: number;
  hp: number;
}

export async function save(storage: StorageApi, data: SaveData): Promise<void> {
  await storage.saveGame("slot-1", data);
}
export async function load(storage: StorageApi): Promise<SaveData | null> {
  return storage.loadGame<SaveData>("slot-1");
}
