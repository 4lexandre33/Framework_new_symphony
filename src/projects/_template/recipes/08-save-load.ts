// Saves por slot (localStorage; em node/vitest cai em memória). Só dados serializáveis.
import type { StorageApi } from "../../../tokens/storage";

interface SaveData extends Record<string, unknown> {
  level: number;
  hp: number;
}

/** Uma vez no boot: isola os slots deste jogo e define a versão do schema. */
export function configureSaves(storage: StorageApi): void {
  storage.configureSaves({ namespace: "meu-jogo", schemaVersion: 2, gameVersion: "1.0.0", backupCount: 1 });
  // v1 não tinha hp: a migração roda no load.
  storage.registerMigration(1, (data) => ({ ...data, hp: 100 }));
}

export async function save(storage: StorageApi, data: SaveData, playTimeSeconds: number): Promise<void> {
  await storage.saveGame("slot-1", data, undefined, { playTimeSeconds }); // rejeita em falha (ex.: code "quota-exceeded")
}

/** Nunca rejeita por save corrompido: usa backup ou devolve null. */
export async function load(storage: StorageApi): Promise<SaveData | null> {
  const result = await storage.loadGameDetailed<SaveData>("slot-1");
  return result.status === "ok" || result.status === "recovered" ? result.data : null;
}
