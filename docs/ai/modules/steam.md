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
  readonly isAvailable: boolean;
  checkAvailability(): Promise<boolean>;
  getUser(): Promise<SteamUser | null>;
  unlockAchievement(achievementId: string): Promise<boolean>;
  setStat(statName: string, value: number): Promise<boolean>;
  storeStats(): Promise<boolean>;
  createLobby(lobbyType: SteamLobbyType, maxMembers: number): Promise<SteamLobbyDetails | null>;
  sendP2PPacket( targetSteamId: string, data: Uint8Array, sendType?: P2PSendType, channel?: number ): Promise<boolean>;
  readP2PPacket(channel?: number): Promise<SteamP2PPacket | null>;
}
capability SteamToken = "game.steam"@1.0.0 api SteamApi
```
## token src/tokens/steam-net.ts (secundária)
```ts
interface SteamNetworkApi {
  readonly isAvailable: boolean;
  createLobby(lobbyType: SteamLobbyType, maxMembers: number): Promise<SteamLobbyDetails | null>; // Cria um novo Lobby na Steam com o tipo de visibilidade e limite de jogadores informados.
  joinLobby(lobbyId: string): Promise<boolean>; // Entra em um Lobby existente na Steam a partir de seu ID único de 64 bits.
  leaveLobby(lobbyId: string): Promise<boolean>; // Abandona o Lobby informado.
  setLobbyData(lobbyId: string, key: string, value: string): Promise<boolean>; // Define uma chave/valor de metadados no Lobby (ex: nome do mapa, modo de jogo).
  getLobbyData(lobbyId: string, key: string): Promise<string | null>; // Recupera o valor de uma chave de metadados do Lobby.
  sendP2PPacket( targetSteamId: string, data: Uint8Array, sendType?: P2PSendType, channel?: number ): Promise<boolean>; // Envia um pacote de dados P2P de alta velocidade diretamente para outro jogador via Steam.
  readP2PPacket(channel?: number): Promise<SteamP2PPacket | null>; // Lê o próximo pacote P2P pendente da fila do canal informado.
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
```
## notas verificadas (comportamento)
- `commands.send` devolve `Promise<void>`: não há valor de sucesso. Sem Steam o desbloqueio offline é no-op e nada quebra.
- Nunca bloqueie gameplay esperando a Steam.

