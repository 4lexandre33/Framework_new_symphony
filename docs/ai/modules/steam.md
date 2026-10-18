# steam — Steamworks & P2P
capability: game.steam@1.0.0 | category: functional | engine plugin id: game.steam
use (from src/projects/<jogo>/**):
  import { SteamToken } from "../../tokens/steam";
  import { SteamNetworkToken } from "../../tokens/steam-net";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/steam.ts
```ts
interface SteamUser {
  readonly steamId: string;
  readonly personaName: string;
  readonly isOverlayEnabled: boolean;
}
interface SteamApi {
  readonly isAvailable: boolean; // `true` quando a Steam está inicializada.
  readonly statsReady?: boolean; // `true` depois que as stats/conquistas do usuário chegaram (evento `game.steam.stats-ready`).
  checkAvailability(): Promise<boolean>;
  getUser(): Promise<SteamUser | null>;
  unlockAchievement(achievementId: string): Promise<boolean>; // Libera a conquista.
  setStat(statName: string, value: number, options?: SetStatOptions): Promise<boolean>; // Define uma estatística.
  getStat?(statName: string, type?: SteamStatType): Promise<number | null>; // Lê uma estatística; `null` sem Steam/stats ou stat inexistente.
  storeStats(): Promise<boolean>;
  createLobby(lobbyType: SteamLobbyType, maxMembers: number): Promise<SteamLobbyDetails | null>;
  sendP2PPacket( targetSteamId: string, data: Uint8Array, sendType?: P2PSendType, channel?: number ): Promise<boolean>;
  readP2PPacket(channel?: number): Promise<SteamP2PPacket | null>;
  readP2PPackets?(maxPackets?: number): Promise<ReadonlyArray<SteamP2PPacket>>; // Drena pacotes de TODOS os canais 0..255 numa única chamada (limitada).
}
capability SteamToken = "game.steam"@1.0.0 api SteamApi
```
## token src/tokens/steam-net.ts (secundária)
```ts
interface SteamNetworkApi { // Lobbies e sessões P2P da Steam.
  readonly isAvailable: boolean;
  createLobby(lobbyType: SteamLobbyType, maxMembers: number): Promise<SteamLobbyDetails | null>; // Cria um novo Lobby na Steam com o tipo de visibilidade e limite de jogadores informados.
  joinLobby(lobbyId: string): Promise<boolean>; // Entra em um Lobby existente na Steam a partir de seu ID único de 64 bits.
  leaveLobby(lobbyId: string): Promise<boolean>; // Abandona o Lobby informado.
  setLobbyData(lobbyId: string, key: string, value: string): Promise<boolean>; // Define uma chave/valor de metadados no Lobby (ex: nome do mapa, modo de jogo).
  getLobbyData(lobbyId: string, key: string): Promise<string | null>; // Recupera o valor de uma chave de metadados do Lobby.
  searchLobbies(options?: SteamLobbySearchOptions): Promise<ReadonlyArray<SteamLobbyDetails>>; // Busca lobbies públicos do jogo (filtros de metadata, vagas, distância).
  getLobbyDetails(lobbyId: string): Promise<SteamLobbyDetails | null>; // Dono, membros (contagem), limite e metadata atuais do lobby.
  getLobbyMembers(lobbyId: string): Promise<ReadonlyArray<string>>; // SteamIDs dos membros (só disponível para lobbies em que o usuário está).
  getLobbyOwner(lobbyId: string): Promise<string | null>; // SteamID do dono do lobby.
  inviteToLobby(lobbyId: string, inviteeSteamId: string): Promise<boolean>; // Envia convite Steam para um amigo entrar no lobby.
  openInviteDialog(lobbyId: string): Promise<boolean>; // Abre o diálogo de convite da Steam Overlay para o lobby.
  setLobbyJoinable(lobbyId: string, joinable: boolean): Promise<boolean>; // Permite/impede novas entradas no lobby.
  getJoinedLobbies(): ReadonlyArray<string>; // Lobbies criados/entrados por esta sessão e ainda não abandonados.
  sendP2PPacket( targetSteamId: string, data: Uint8Array, sendType?: P2PSendType, channel?: number ): Promise<boolean>; // Envia um pacote de dados P2P de alta velocidade diretamente para outro jogador via Steam.
  readP2PPacket(channel?: number): Promise<SteamP2PPacket | null>; // Lê o próximo pacote P2P pendente da fila do canal informado.
  readP2PPackets(maxPackets?: number): Promise<ReadonlyArray<SteamP2PPacket>>; // Drena pacotes de todos os canais 0..255 numa única chamada (limitada).
  acceptP2PSession(remoteSteamId: string): Promise<boolean>; // Aceita uma solicitação de sessão P2P vinda de um jogador remoto.
  closeP2PSession(remoteSteamId: string): Promise<boolean>; // Encerra a sessão P2P ativa com o jogador remoto.
  getP2PSessionState(remoteSteamId: string): Promise<P2PSessionState | null>; // Retorna o estado técnico da conexão P2P (latência, perda de pacotes, uso de relay).
}
capability SteamNetworkToken = "game.steam.net"@1.0.0 api SteamNetworkApi
```
## contract src/contracts/steam/types.ts
```ts
interface UnlockAchievementRequest {
  readonly achievementId: string;
}
command UnlockAchievementCommand = "game.steam.unlock-achievement" request UnlockAchievementRequest
export type SteamStatType = "int" | "float";
interface SetStatOptions {
  readonly type?: SteamStatType; // `int` (padrão; o valor precisa ser inteiro de 32 bits) ou `float`.
}
interface SteamAvailabilityChangedPayload {
  readonly isAvailable: boolean;
}
event SteamAvailabilityChangedEvent = "game.steam.availability-changed" payload SteamAvailabilityChangedPayload // Emitido assim que a disponibilidade da Steam é resolvida no boot e a cada mudança.
interface SteamStatsReadyPayload {
  readonly steamId: string;
}
event SteamStatsReadyEvent = "game.steam.stats-ready" payload SteamStatsReadyPayload // As stats/conquistas do usuário chegaram da Steam: a partir daqui set/unlock são confiáveis.
interface SteamMicroTxnAuthorizationPayload {
  readonly appId: number;
  readonly orderId: string;
  readonly authorized: boolean;
}
event SteamMicroTxnAuthorizationEvent = "game.steam.microtxn-authorization" payload SteamMicroTxnAuthorizationPayload // Resposta do usuário ao diálogo de compra da Steam (MicroTxnAuthorizationResponse_t).
interface SteamWorkshopDownloadResultPayload {
  readonly publishedFileId: string;
  readonly success: boolean;
  readonly error?: string;
}
event SteamWorkshopDownloadResultEvent = "game.steam.workshop-download-result" payload SteamWorkshopDownloadResultPayload
```
## contract src/contracts/steam/net-types.ts
```ts
export type P2PSendType = | "unreliable" | "unreliableNoDelay" | "reliable" | "reliableWithBuffering"; // Modos de envio de pacotes P2P da Steamworks API (equivalente a P2PSend da Valve).
export type SteamLobbyType = | "private" | "friendsOnly" | "public" | "invisible"; // Visibilidade e tipo do Lobby multiplayer na infraestrutura da Steam.
interface SteamLobbyDetails { // Estrutura de dados detalhada de um Lobby da Steam.
  readonly lobbyId: string;
  readonly ownerSteamId: string;
  readonly memberCount: number;
  readonly maxMembers: number;
  readonly lobbyType: SteamLobbyType;
  readonly metadata: Readonly<Record<string, string>>;
}
interface P2PSessionState { // Estado da conexão de uma sessão P2P individual entre o jogador local e um par remoto.
  readonly isConnectionActive: boolean;
  readonly isConnecting: boolean;
  readonly lastError: number;
  readonly usingRelay: boolean;
  readonly bytesQueuedForSend: number;
  readonly packetsQueuedForSend: number;
  readonly remoteSteamId: string;
}
interface SteamP2PPacket { // Pacote bruto de dados recebido ou enviado via rede P2P da Steam.
  readonly sourceSteamId: string;
  readonly channel: number;
  readonly data: Uint8Array;
  readonly bytesReceived: number;
}
interface P2PMessageReceivedPayload {
  readonly sourceSteamId: string;
  readonly channel: number;
  readonly data: Uint8Array;
  readonly bytesReceived: number;
}
event P2PMessageReceivedEvent = "game.steam.p2p-received" payload P2PMessageReceivedPayload
interface P2PSessionRequestPayload {
  readonly remoteSteamId: string;
}
event P2PSessionRequestEvent = "game.steam.p2p-session-request" payload P2PSessionRequestPayload
interface LobbyCreatedPayload {
  readonly lobbyId: string;
  readonly isSuccess: boolean;
  readonly error?: string;
}
event LobbyCreatedEvent = "game.steam.lobby-created" payload LobbyCreatedPayload
interface LobbyJoinedPayload {
  readonly lobbyId: string;
  readonly memberSteamId: string;
}
event LobbyJoinedEvent = "game.steam.lobby-joined" payload LobbyJoinedPayload
interface LobbyMemberLeftPayload {
  readonly lobbyId: string;
  readonly memberSteamId: string;
}
event LobbyMemberLeftEvent = "game.steam.lobby-member-left" payload LobbyMemberLeftPayload
interface CreateLobbyRequest {
  readonly lobbyType: SteamLobbyType;
  readonly maxMembers: number;
}
command CreateLobbyCommand = "game.steam.create-lobby" request CreateLobbyRequest
interface JoinLobbyRequest {
  readonly lobbyId: string;
}
command JoinLobbyCommand = "game.steam.join-lobby" request JoinLobbyRequest
interface LeaveLobbyRequest {
  readonly lobbyId: string;
}
command LeaveLobbyCommand = "game.steam.leave-lobby" request LeaveLobbyRequest
interface SendP2PPacketRequest {
  readonly targetSteamId: string;
  readonly data: Uint8Array;
  readonly sendType: P2PSendType;
  readonly channel: number;
}
command SendP2PPacketCommand = "game.steam.send-p2p-packet" request SendP2PPacketRequest
interface AcceptP2PSessionRequest {
  readonly remoteSteamId: string;
}
command AcceptP2PSessionCommand = "game.steam.accept-p2p-session" request AcceptP2PSessionRequest
export type SteamLobbyComparison = | "equal" | "notEqual" | "greaterThan" | "greaterThanOrEqual" | "lessThan" | "lessThanOrEqual";
export type SteamLobbyDistance = "close" | "default" | "far" | "worldwide";
interface SteamLobbySearchOptions {
  readonly stringFilters?: ReadonlyArray<{ readonly key: string; readonly value: string; readonly comparison?: "equal" | "notEqual"; }>; // Filtros de metadata string (apenas `equal`/`notEqual`).
  readonly numberFilters?: ReadonlyArray<{ readonly key: string; readonly value: number; readonly comparison?: SteamLobbyComparison; }>; // Filtros numéricos sobre metadata (inteiro de 32 bits).
  readonly slotsAvailable?: number;
  readonly distance?: SteamLobbyDistance;
  readonly maxResults?: number; // 1..50 (padrão 50).
}
interface LobbyDataUpdatedPayload {
  readonly lobbyId: string;
  readonly memberSteamId: string; // Igual a `lobbyId` quando mudou a metadata do lobby; SteamID quando foi a de um membro.
  readonly success: boolean;
}
event LobbyDataUpdatedEvent = "game.steam.lobby-data-updated" payload LobbyDataUpdatedPayload
interface LobbyInviteReceivedPayload {
  readonly lobbyId: string; // Lobby em que o jogador pediu para entrar pela Steam (convite / "Entrar no jogo").
  readonly friendSteamId: string;
}
event LobbyInviteReceivedEvent = "game.steam.lobby-invite" payload LobbyInviteReceivedPayload
interface P2PSessionFailedPayload {
  readonly remoteSteamId: string;
  readonly error: number; // EP2PSessionError da Steam.
}
event P2PSessionFailedEvent = "game.steam.p2p-session-failed" payload P2PSessionFailedPayload
```
## notas verificadas (comportamento)
- O plugin `game.steam` fornece DOIS tokens: `game.steam` (SteamApi) e `game.steam.net` (SteamNetworkToken: lobbies + P2P). Consuma `game.steam.net` com `optional: true` se quiser o jogo de pé mesmo num host sem ele.
- Sem Steam (navegador, ou app sem cliente): nada lança. `isAvailable` false; `unlockAchievement`/`setStat`/`joinLobby`… resolvem `false`; `createLobby`/`getLobbyOwner` `null`; `searchLobbies`/`getLobbyMembers`/`readP2PPackets` `[]`. Nunca bloqueie gameplay esperando a Steam.
- Boot: a disponibilidade é resolvida no `onBoot` do plugin e anunciada em `game.steam.availability-changed`; mesmo assim `await steam.checkAvailability()` antes de decidir. Stats/conquistas confiáveis após `game.steam.stats-ready` (`statsReady`).
- Conquistas: `await steam.unlockAchievement(id)` (boolean). Stats: `setStat(nome, v)` = inteiro 32 bits; `setStat(nome, v, { type: "float" })`; `getStat`; depois `storeStats()`.
- Comandos devolvem o retorno do handler (`commands.send("game.steam.create-lobby", …)` resolve com os detalhes), mas prefira os métodos do token.
- Lobby (`game.steam.net`): `createLobby(tipo, max)` → `SteamLobbyDetails`; `setLobbyData`/`getLobbyData`; `searchLobbies({ stringFilters, numberFilters, slotsAvailable, distance })`; `joinLobby`, `leaveLobby`, `getLobbyOwner`, `getLobbyMembers`, `inviteToLobby`, `openInviteDialog`, `setLobbyJoinable`. Eventos: `lobby-created`, `lobby-joined`, `lobby-member-left`, `lobby-data-updated`, `lobby-invite` (convite/"Entrar no jogo"), `p2p-session-request`, `p2p-session-failed`.
- Sessão de jogo: entre no lobby, pegue `getLobbyOwner` e chame `game.net.connect(steamIdDoDono)`; o `game.net` cuida de P2P, handshake e heartbeat.
- Não verificado com cliente Steam real (GAPS NV).
