# storage — Persistência & Banco de Dados
capability: game.storage@1.0.0 | category: functional | engine plugin id: game.storage
consumes: SteamToken
use (from src/projects/<jogo>/**):
  import { StorageToken } from "../../tokens/storage";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/storage.ts
```ts
interface StorageApi {
  readonly activeDriver: StorageDriverType; // Driver ativo no momento para operações padrão.
  saveGame( slotName: string, data: Record<string, unknown>, driverPreference?: StorageDriverType ): Promise<SaveGameMetadata>; // Salva o estado do jogo em um slot específico.
  loadGame<T = Record<string, unknown>>( slotName: string, driverPreference?: StorageDriverType ): Promise<T | null>; // Carrega os dados de um slot salvo.
  listSaves(driverPreference?: StorageDriverType): Promise<SaveGameMetadata[]>; // Lista os metadados de todos os salvamentos disponíveis.
  deleteSave(slotName: string, driverPreference?: StorageDriverType): Promise<boolean>; // Remove permanentemente um arquivo de save.
  syncOnlineProfile(profile: PlayerOnlineProfile): Promise<boolean>; // Sincroniza o perfil online do jogador com o banco de dados remoto.
  fetchOnlineProfile(playerId: string): Promise<PlayerOnlineProfile | null>; // Busca o perfil online atualizado do jogador.
  setDriver(driverType: StorageDriverType): void; // Define o driver principal ativo do sistema de salvamento.
}
capability StorageToken = "game.storage"@1.0.0 api StorageApi
```
## contract src/contracts/storage/types.ts
```ts
export type StorageDriverType = "steam_cloud" | "sqlite_local" | "cloud_database";
interface SaveGameMetadata {
  readonly saveId: string;
  readonly slotName: string;
  readonly playTimeSeconds: number;
  readonly timestamp: number;
  readonly gameVersion: string;
  readonly checksum: string;
}
interface PlayerOnlineProfile {
  readonly playerId: string;
  readonly displayName: string;
  readonly rankScore: number;
  readonly inventoryData: Record<string, unknown>;
  readonly lastSyncedTimestamp: number;
}
interface SaveCompletedPayload {
  readonly saveId: string;
  readonly slotName: string;
  readonly driver: StorageDriverType;
  readonly timestamp: number;
  readonly success: boolean;
}
event SaveCompletedEvent = "game.storage.save-completed" payload SaveCompletedPayload
interface ProfileSyncedPayload {
  readonly playerId: string;
  readonly driver: StorageDriverType;
  readonly syncedAt: number;
  readonly success: boolean;
}
event ProfileSyncedEvent = "game.storage.profile-synced" payload ProfileSyncedPayload
interface SaveGameRequest {
  readonly slotName: string;
  readonly data: Record<string, unknown>;
  readonly driverPreference?: StorageDriverType;
}
command SaveGameCommand = "game.storage.save-game" request SaveGameRequest
interface LoadGameRequest {
  readonly slotName: string;
  readonly driverPreference?: StorageDriverType;
}
command LoadGameCommand = "game.storage.load-game" request LoadGameRequest
interface SyncProfileRequest {
  readonly profile: PlayerOnlineProfile;
}
command SyncProfileCommand = "game.storage.sync-profile" request SyncProfileRequest
```
## notas verificadas (comportamento)
- Driver padrão `sqlite_local` = `localStorage` do navegador (não precisa de Tauri). `steam_cloud` também usa `localStorage` (prefixo `steam_cloud_save_`). `cloud_database` não salva slots (lança).
- Slot inexistente: `loadGame` resolve `null`. Falhas de escrita rejeitam a Promise.
- Em vitest no ambiente node não há `localStorage` (lança): nos testes do jogo use um mock de `StorageApi`.
- Só dados serializáveis em JSON.
