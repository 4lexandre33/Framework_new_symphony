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
  saveGame( slotName: string, data: Record<string, unknown>, driverPreference?: StorageDriverType, options?: SaveGameOptions ): Promise<SaveGameMetadata>; // Salva o estado do jogo em um slot.
  loadGame<T = Record<string, unknown>>( slotName: string, driverPreference?: StorageDriverType ): Promise<T | null>; // Carrega os dados (migrados para o schema atual).
  loadGameDetailed<T = Record<string, unknown>>( slotName: string, driverPreference?: StorageDriverType ): Promise<LoadGameResult<T>>; // Como `loadGame`, mas NUNCA rejeita por corrupção: devolve `{ status: "ok" | "recovered" | "missing" | "corrup…
  listSaves(driverPreference?: StorageDriverType): Promise<SaveGameMetadata[]>; // Lista os metadados (lidos de um índice; não lê cada save inteiro).
  deleteSave(slotName: string, driverPreference?: StorageDriverType): Promise<boolean>; // Remove permanentemente um save (e seus backups).
  configureSaves(configuration: SaveConfiguration): void; // Namespace por jogo, schemaVersion, gameVersion padrão, backups e chave HMAC.
  getSaveConfiguration(): SaveConfiguration; // Configuração atual (a chave HMAC nunca é devolvida).
  registerMigration(fromVersion: number, migrate: SaveMigration): void; // Migração `fromVersion` → `fromVersion + 1` aplicada no load.
  getBackendInfo(): StorageBackendInfo; // Backend em uso; `persistent: false` = memória (node/vitest/headless).
  syncOnlineProfile(profile: PlayerOnlineProfile): Promise<boolean>; // Envia o perfil ao backend remoto.
  fetchOnlineProfile(playerId: string): Promise<PlayerOnlineProfile | null>; // Busca o perfil remoto.
  isOnlineProfileSupported(): boolean; // true se há um backend remoto real configurado.
  getLastOnlineProfileError(): string | null;
  setOnlineProfileBackend(backend: OnlineProfileBackend | null): void; // Backend remoto próprio; null volta ao padrão "unsupported".
  configureOnlineProfile(config: OnlineProfileEndpointConfig): void; // Backend HTTP/JSON genérico: `PUT`/`GET {endpoint}/{playerId}`.
  setDriver(driverType: StorageDriverType): void; // Define o driver principal ativo do sistema de salvamento.
}
capability StorageToken = "game.storage"@1.0.0 api StorageApi
```
## contract src/contracts/storage/types.ts
```ts
export type StorageDriverType = "steam_cloud" | "sqlite_local" | "cloud_database";
interface SaveGameMetadata { // Metadados de um save.
  readonly saveId: string;
  readonly slotName: string;
  readonly playTimeSeconds: number;
  readonly timestamp: number;
  readonly gameVersion: string;
  readonly checksum: string; // Checksum de integridade (FNV-1a) do payload.
  readonly schemaVersion?: number; // Versão do schema do jogo gravada com o save (migrações).
  readonly label?: string; // Rótulo livre para a UI de saves.
  readonly signed?: boolean; // true se o save tem assinatura HMAC (chave configurada no momento do save).
}
interface SaveGameOptions {
  readonly playTimeSeconds?: number;
  readonly gameVersion?: string;
  readonly schemaVersion?: number; // Padrão: a versão configurada em `configureSaves({ schemaVersion })`.
  readonly label?: string;
}
export type SaveMigration = ( data: Record<string, unknown>, ) => Record<string, unknown>; // Migração de schema: recebe os dados na versão `fromVersion` e devolve os dados na versão `fromVersion + 1`.
interface SaveConfiguration {
  readonly namespace?: string; // Namespace do jogo (G32/G102): isola as chaves de save entre jogos que compartilham o mesmo armazenamento.
  readonly adoptLegacySaves?: boolean; // Com namespace novo: lê saves antigos (sem namespace) do mesmo slot e os adota.
  readonly schemaVersion?: number; // Versão atual do schema dos dados do jogo (migrações rodam no load).
  readonly gameVersion?: string; // `gameVersion` padrão dos metadados.
  readonly backupCount?: number; // Quantas cópias anteriores manter por slot para recuperação (0–5, padrão 1).
  readonly integrityKey?: string | null; // Chave para assinar saves com HMAC-SHA256 (detecta adulteração casual).
  readonly requireSignature?: boolean; // Com chave: rejeitar saves sem assinatura (padrão false: aceita e re-assina no próximo save).
}
export type StorageBackendKind = "local-storage" | "memory" | "custom";
interface StorageBackendInfo {
  readonly kind: StorageBackendKind;
  readonly persistent: boolean; // false = os dados somem ao fechar (backend em memória).
  readonly namespace: string | null;
}
export type LoadGameStatus = "ok" | "recovered" | "missing" | "corrupted";
interface LoadGameResult<T> {
  readonly status: LoadGameStatus;
  readonly data: T | null; // Dados (já migrados); null em "missing"/"corrupted".
  readonly metadata: SaveGameMetadata | null;
  readonly backupIndex?: number; // "recovered": índice do backup usado (1 = mais recente).
  readonly migratedFrom?: ReadonlyArray<number>; // Versões de schema migradas (ex.: [1, 2] = 1→2→3).
  readonly error?: string; // Motivo da corrupção do slot principal (quando houve).
}
interface OnlineProfileBackend { // Backend remoto de perfis (G100).
  readonly supported?: boolean;
  write(profile: PlayerOnlineProfile): Promise<void>;
  read(playerId: string): Promise<PlayerOnlineProfile | null>;
  dispose?(): void;
}
interface OnlineProfileEndpointConfig {
  readonly endpoint: string; // URL base; o perfil fica em `${endpoint}/${encodeURIComponent(playerId)}`.
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
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
  readonly errorCode?: string; // Em falha: código do erro ("quota-exceeded", "unavailable"...).
}
event SaveCompletedEvent = "game.storage.save-completed" payload SaveCompletedPayload
interface ProfileSyncedPayload {
  readonly playerId: string;
  readonly driver: StorageDriverType;
  readonly syncedAt: number;
  readonly success: boolean;
  readonly error?: string; // Em falha: "unsupported" (sem backend remoto configurado) ou a mensagem do erro.
}
event ProfileSyncedEvent = "game.storage.profile-synced" payload ProfileSyncedPayload
interface SaveRecoveredPayload {
  readonly slotName: string;
  readonly driver: StorageDriverType;
  readonly backupIndex: number; // 1 = backup mais recente.
  readonly reason: string;
}
event SaveRecoveredEvent = "game.storage.save-recovered" payload SaveRecoveredPayload // O slot principal estava corrompido e um backup foi usado.
interface SaveGameRequest {
  readonly slotName: string;
  readonly data: Record<string, unknown>;
  readonly driverPreference?: StorageDriverType;
  readonly options?: SaveGameOptions;
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
- Ponha no TOPO de `data` os campos `playTimeSeconds` (número) e `gameVersion` (string), e um `schemaVersion` seu (G103). Slots só `[A-Za-z0-9_-]` com prefixo do jogo (G102). Save corrompido REJEITA (`code:"corrupted"`): try/catch sempre (G101). Perfil online é falso (G100).
