import { invoke } from "@tauri-apps/api/core";
import type { SteamApi, SteamUser } from "../../../tokens/steam";
import type { SteamNetworkApi } from "../../../tokens/steam-net";
import type {
  P2PSendType,
  P2PSessionState,
  SteamLobbyDetails,
  SteamLobbySearchOptions,
  SteamLobbyType,
  SteamP2PPacket,
} from "../../../contracts/steam/net-types";
import type { SetStatOptions, SteamStatType } from "../../../contracts/steam/types";

interface NativeSteamUserDto {
  readonly steamId: string;
  readonly personaName: string;
  readonly isOverlayEnabled: boolean;
}

interface NativeSteamLobbyDto {
  readonly lobbyId: string;
  readonly ownerSteamId: string;
  readonly memberCount: number;
  readonly maxMembers: number;
  readonly metadata?: Readonly<Record<string, string>>;
}

interface NativeSteamP2PPacketDto {
  readonly sourceSteamId: string;
  readonly channel: number;
  readonly data: readonly number[];
  readonly bytesReceived: number;
}

interface NativeSteamP2PBatchDto {
  readonly packets: readonly NativeSteamP2PPacketDto[];
  readonly droppedOversized: number;
}

interface NativeSteamP2PSessionStateDto {
  readonly isConnectionActive: boolean;
  readonly isConnecting: boolean;
  readonly lastError: number;
  readonly usingRelay: boolean;
  readonly bytesQueuedForSend: number;
  readonly packetsQueuedForSend: number;
  readonly remoteSteamId: string;
}

/** Eventos nativos drenados de `steam_poll_events` (espelho de `SteamEventDto` em Rust). */
export type SteamNativeEvent =
  | { readonly kind: "p2pSessionRequest"; readonly remoteSteamId: string }
  | { readonly kind: "p2pSessionConnectFail"; readonly remoteSteamId: string; readonly error: number }
  | {
      readonly kind: "lobbyChatUpdate";
      readonly lobbyId: string;
      readonly userSteamId: string;
      readonly makingChangeSteamId: string;
      readonly change: "entered" | "left" | "disconnected" | "kicked" | "banned";
    }
  | {
      readonly kind: "lobbyDataUpdate";
      readonly lobbyId: string;
      readonly memberSteamId: string;
      readonly success: boolean;
    }
  | { readonly kind: "lobbyJoinRequested"; readonly lobbyId: string; readonly friendSteamId: string }
  | {
      readonly kind: "userStatsReceived";
      readonly steamId: string;
      readonly success: boolean;
      readonly error?: string | null;
    }
  | {
      readonly kind: "microTxnAuthorization";
      readonly appId: number;
      readonly orderId: string;
      readonly authorized: boolean;
    }
  | {
      readonly kind: "workshopDownloadResult";
      readonly publishedFileId: string;
      readonly success: boolean;
      readonly error?: string | null;
    }
  | { readonly kind: "inventoryResultReady"; readonly handle: number; readonly success: boolean }
  | { readonly kind: "steamServersConnected" }
  | { readonly kind: "steamServersDisconnected" }
  | { readonly kind: "eventsDropped"; readonly count: number };

export type SteamNativeEventListener = (event: SteamNativeEvent) => void;
export type SteamAvailabilityListener = (isAvailable: boolean) => void;

const STEAM_ID_PATTERN = /^\d{1,20}$/u;
const MAX_LOBBY_MEMBERS = 250;
const MAX_P2P_CHANNEL = 255;
const MAX_UNRELIABLE_PACKET_BYTES = 1_200;
const MAX_RELIABLE_PACKET_BYTES = 1024 * 1024;
const MAX_P2P_BATCH_PACKETS = 512;
const MAX_P2P_BATCH_BYTES = 4 * 1024 * 1024;
const MAX_EVENTS_PER_POLL = 128;
const DEFAULT_EVENT_PUMP_INTERVAL_MS = 50;
const DEFAULT_STATS_READY_TIMEOUT_MS = 10_000;
const STATS_NOT_READY = "STATS_NOT_READY";
const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;
const MAX_FLOAT32 = 3.4028234663852886e38;

const NATIVE_EVENT_KINDS: ReadonlySet<string> = new Set([
  "p2pSessionRequest",
  "p2pSessionConnectFail",
  "lobbyChatUpdate",
  "lobbyDataUpdate",
  "lobbyJoinRequested",
  "userStatsReceived",
  "microTxnAuthorization",
  "workshopDownloadResult",
  "inventoryResultReady",
  "steamServersConnected",
  "steamServersDisconnected",
  "eventsDropped",
]);

function isValidSteamId(value: string): boolean {
  return typeof value === "string" && STEAM_ID_PATTERN.test(value);
}

function isValidChannel(channel: number): boolean {
  return Number.isInteger(channel) && channel >= 0 && channel <= MAX_P2P_CHANNEL;
}

function isValidLobbySize(maxMembers: number): boolean {
  return Number.isInteger(maxMembers) && maxMembers >= 1 && maxMembers <= MAX_LOBBY_MEMBERS;
}

function isValidPacketSize(sendType: P2PSendType, byteLength: number): boolean {
  const limit =
    sendType === "unreliable" || sendType === "unreliableNoDelay"
      ? MAX_UNRELIABLE_PACKET_BYTES
      : MAX_RELIABLE_PACKET_BYTES;

  return byteLength <= limit;
}

function isNonEmptyIdentifier(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !value.includes("\0");
}

function isValidLobbyKey(key: string): boolean {
  return typeof key === "string" && key.length > 0 && key.length <= 255 && !key.includes("\0");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNativeEvent(value: unknown): value is SteamNativeEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { kind?: unknown }).kind === "string" &&
    NATIVE_EVENT_KINDS.has((value as { kind: string }).kind)
  );
}

function toPacket(raw: NativeSteamP2PPacketDto | null | undefined): SteamP2PPacket | null {
  if (
    raw === null ||
    raw === undefined ||
    !isValidSteamId(raw.sourceSteamId) ||
    !isValidChannel(raw.channel) ||
    !Array.isArray(raw.data) ||
    raw.data.length > MAX_RELIABLE_PACKET_BYTES
  ) {
    return null;
  }

  const data = Uint8Array.from(raw.data);
  if (raw.bytesReceived !== data.byteLength) {
    return null;
  }

  return {
    sourceSteamId: raw.sourceSteamId,
    channel: raw.channel,
    data,
    bytesReceived: raw.bytesReceived,
  };
}

export interface SteamBridgeOptions {
  /** Timeout de espera pelas stats antes de set/unlock (padrão 10 s). */
  readonly statsReadyTimeoutMs?: number;
}

export class SteamBridgeService implements SteamApi, SteamNetworkApi {
  private available = false;
  private availabilityResolved = false;
  private statsReadyFlag = false;
  private readonly statsReadyTimeoutMs: number;
  private readonly statsWaiters = new Set<(ready: boolean) => void>();
  private readonly nativeListeners = new Set<SteamNativeEventListener>();
  private readonly availabilityListeners = new Set<SteamAvailabilityListener>();
  private readonly packetListeners = new Set<(packet: SteamP2PPacket) => void>();
  private readonly joinedLobbies = new Map<string, SteamLobbyType | null>();
  private pumpTimer: ReturnType<typeof setInterval> | null = null;
  private pumpInFlight = false;
  private disposed = false;
  private droppedOversizedPackets = 0;

  public constructor(options: SteamBridgeOptions = {}) {
    this.statsReadyTimeoutMs =
      Number.isFinite(options.statsReadyTimeoutMs) && (options.statsReadyTimeoutMs ?? 0) >= 0
        ? (options.statsReadyTimeoutMs as number)
        : DEFAULT_STATS_READY_TIMEOUT_MS;
    void this.checkAvailability();
  }

  public get isAvailable(): boolean {
    return this.available;
  }

  /** `true` quando a primeira verificação de disponibilidade já terminou. */
  public get isAvailabilityResolved(): boolean {
    return this.availabilityResolved;
  }

  public get statsReady(): boolean {
    return this.statsReadyFlag;
  }

  /** Pacotes P2P acima do limite descartados pelo lado nativo (G111). */
  public get droppedOversizedPacketCount(): number {
    return this.droppedOversizedPackets;
  }

  public async checkAvailability(): Promise<boolean> {
    const previous = this.available;
    const wasResolved = this.availabilityResolved;

    try {
      this.available = (await invoke<boolean>("steam_is_initialized")) === true;
    } catch {
      this.available = false;
    }

    this.availabilityResolved = true;

    if (this.disposed) {
      this.available = false;
      return false;
    }

    if (!wasResolved || previous !== this.available) {
      for (const listener of this.availabilityListeners) {
        try {
          listener(this.available);
        } catch {
          // listener do consumidor não interrompe o bridge
        }
      }
    }

    return this.available;
  }

  public onAvailabilityChanged(listener: SteamAvailabilityListener): () => void {
    this.availabilityListeners.add(listener);
    return () => {
      this.availabilityListeners.delete(listener);
    };
  }

  /** Observa todo pacote P2P lido pelo bridge (por qualquer consumidor). */
  public onP2PPacket(listener: (packet: SteamP2PPacket) => void): () => void {
    this.packetListeners.add(listener);
    return () => {
      this.packetListeners.delete(listener);
    };
  }

  private notifyPacket(packet: SteamP2PPacket): void {
    for (const listener of this.packetListeners) {
      try {
        listener(packet);
      } catch {
        // listener do consumidor não interrompe o bridge
      }
    }
  }

  public onNativeEvent(listener: SteamNativeEventListener): () => void {
    this.nativeListeners.add(listener);
    return () => {
      this.nativeListeners.delete(listener);
    };
  }

  /** Inicia a drenagem periódica de eventos nativos (idempotente). */
  public startEventPump(intervalMs = DEFAULT_EVENT_PUMP_INTERVAL_MS): void {
    if (this.disposed || this.pumpTimer !== null) return;
    const interval = Number.isFinite(intervalMs) && intervalMs >= 10 ? intervalMs : DEFAULT_EVENT_PUMP_INTERVAL_MS;
    this.pumpTimer = setInterval(() => {
      void this.pollEvents();
    }, interval);
  }

  public stopEventPump(): void {
    if (this.pumpTimer !== null) {
      clearInterval(this.pumpTimer);
      this.pumpTimer = null;
    }
  }

  /** Drena eventos nativos e os entrega aos ouvintes. Sem Steam resolve `[]`. */
  public async pollEvents(maxEvents = MAX_EVENTS_PER_POLL): Promise<ReadonlyArray<SteamNativeEvent>> {
    if (this.disposed || !this.available || this.pumpInFlight) {
      return [];
    }

    this.pumpInFlight = true;
    let events: SteamNativeEvent[] = [];

    try {
      const raw = await invoke<unknown>("steam_poll_events", {
        maxEvents: Math.max(1, Math.min(MAX_EVENTS_PER_POLL, Math.trunc(maxEvents) || 1)),
      });
      events = Array.isArray(raw) ? raw.filter(isNativeEvent) : [];
    } catch {
      events = [];
    } finally {
      this.pumpInFlight = false;
    }

    for (const event of events) {
      this.handleNativeEvent(event);
    }

    return events;
  }

  /** Aplica um evento nativo ao estado interno e repassa aos ouvintes. */
  public handleNativeEvent(event: SteamNativeEvent): void {
    if (this.disposed) return;

    if (event.kind === "userStatsReceived" && event.success) {
      this.markStatsReady(true);
    } else if (event.kind === "lobbyChatUpdate" && event.change !== "entered") {
      // o próprio usuário saiu/foi expulso
      void this.getLocalSteamIdCached().then((localId) => {
        if (localId !== null && localId === event.userSteamId) {
          this.joinedLobbies.delete(event.lobbyId);
        }
      });
    }

    for (const listener of this.nativeListeners) {
      try {
        listener(event);
      } catch {
        // listener do consumidor não interrompe o bridge
      }
    }
  }

  private localSteamId: string | null = null;

  private async getLocalSteamIdCached(): Promise<string | null> {
    if (this.localSteamId !== null) return this.localSteamId;
    const user = await this.getUser();
    this.localSteamId = user?.steamId ?? null;
    return this.localSteamId;
  }

  private markStatsReady(ready: boolean): void {
    this.statsReadyFlag = ready;
    if (!ready) return;
    for (const waiter of this.statsWaiters) {
      waiter(true);
    }
    this.statsWaiters.clear();
  }

  /** Aguarda as stats chegarem (resolve `false` no timeout ou sem Steam). */
  public waitForStatsReady(timeoutMs = this.statsReadyTimeoutMs): Promise<boolean> {
    if (this.statsReadyFlag) return Promise.resolve(true);
    if (!this.available || this.disposed || timeoutMs <= 0) return Promise.resolve(false);

    return new Promise<boolean>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const waiter = (ready: boolean): void => {
        if (timer !== null) clearTimeout(timer);
        this.statsWaiters.delete(waiter);
        resolve(ready);
      };
      timer = setTimeout(() => waiter(false), timeoutMs);
      this.statsWaiters.add(waiter);
    });
  }

  private async ensureAvailable(): Promise<boolean> {
    if (this.disposed) {
      return false;
    }

    if (this.available) {
      return true;
    }

    return this.checkAvailability();
  }

  /**
   * Executa uma operação de stats; se o nativo responder STATS_NOT_READY,
   * espera `game.steam.stats-ready` e tenta UMA vez de novo.
   */
  private async withStats(command: string, args: Record<string, unknown>): Promise<boolean> {
    try {
      const result = await invoke<boolean>(command, args);
      if (result === true) this.statsReadyFlag = true;
      return result === true;
    } catch (error: unknown) {
      if (!errorMessage(error).includes(STATS_NOT_READY)) {
        return false;
      }
    }

    this.statsReadyFlag = false;
    const ready = await this.waitForStatsReady();
    if (!ready) return false;

    try {
      return (await invoke<boolean>(command, args)) === true;
    } catch {
      return false;
    }
  }

  public async getUser(): Promise<SteamUser | null> {
    if (!(await this.ensureAvailable())) {
      return null;
    }

    try {
      const raw = await invoke<NativeSteamUserDto>("steam_get_user");

      if (!raw || !isValidSteamId(raw.steamId) || typeof raw.personaName !== "string" || raw.personaName.length === 0) {
        return null;
      }

      return {
        steamId: raw.steamId,
        personaName: raw.personaName,
        isOverlayEnabled: raw.isOverlayEnabled === true,
      };
    } catch {
      return null;
    }
  }

  public async unlockAchievement(achievementId: string): Promise<boolean> {
    if (!isNonEmptyIdentifier(achievementId) || !(await this.ensureAvailable())) {
      return false;
    }

    return this.withStats("steam_unlock_achievement", { achievementId });
  }

  public async setStat(statName: string, value: number, options: SetStatOptions = {}): Promise<boolean> {
    const type: SteamStatType = options.type ?? "int";

    if (!isNonEmptyIdentifier(statName) || typeof value !== "number" || !Number.isFinite(value)) {
      return false;
    }

    if (type === "int") {
      // G112: não trunca silenciosamente; stat float use { type: "float" }.
      if (!Number.isInteger(value) || value < INT32_MIN || value > INT32_MAX) {
        return false;
      }
    } else if (type === "float") {
      if (Math.abs(value) > MAX_FLOAT32) return false;
    } else {
      return false;
    }

    if (!(await this.ensureAvailable())) {
      return false;
    }

    return type === "int"
      ? this.withStats("steam_set_stat", { statName, value })
      : this.withStats("steam_set_stat_float", { statName, value });
  }

  public async getStat(statName: string, type: SteamStatType = "int"): Promise<number | null> {
    if (!isNonEmptyIdentifier(statName) || (type !== "int" && type !== "float") || !(await this.ensureAvailable())) {
      return null;
    }

    try {
      const value = await invoke<number>("steam_get_stat", { statName, kind: type });
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  }

  public async storeStats(): Promise<boolean> {
    if (!(await this.ensureAvailable())) {
      return false;
    }

    try {
      return (await invoke<boolean>("steam_store_stats")) === true;
    } catch {
      return false;
    }
  }

  private toLobby(result: NativeSteamLobbyDto | null | undefined, knownType?: SteamLobbyType): SteamLobbyDetails | null {
    if (!result || !isValidSteamId(result.lobbyId) || !isValidSteamId(result.ownerSteamId)) {
      return null;
    }

    const metadata: Record<string, string> = {};
    if (result.metadata && typeof result.metadata === "object") {
      for (const [key, value] of Object.entries(result.metadata)) {
        if (typeof value === "string") metadata[key] = value;
      }
    }

    const tracked = this.joinedLobbies.get(result.lobbyId);
    const lobbyType: SteamLobbyType = knownType ?? tracked ?? "public";

    return {
      lobbyId: result.lobbyId,
      ownerSteamId: result.ownerSteamId,
      memberCount: Number.isInteger(result.memberCount) ? result.memberCount : 0,
      maxMembers: Number.isInteger(result.maxMembers) ? result.maxMembers : 0,
      lobbyType,
      metadata,
    };
  }

  public async createLobby(
    lobbyType: SteamLobbyType,
    maxMembers: number,
  ): Promise<SteamLobbyDetails | null> {
    if (
      !isValidLobbySize(maxMembers) ||
      !["private", "friendsOnly", "public", "invisible"].includes(lobbyType) ||
      !(await this.ensureAvailable())
    ) {
      return null;
    }

    try {
      const result = await invoke<NativeSteamLobbyDto>("steam_create_lobby", {
        lobbyType,
        maxMembers,
      });

      const lobby = this.toLobby(result, lobbyType);
      if (lobby) this.joinedLobbies.set(lobby.lobbyId, lobbyType);
      return lobby;
    } catch {
      return null;
    }
  }

  public async joinLobby(lobbyId: string): Promise<boolean> {
    if (!isValidSteamId(lobbyId) || !(await this.ensureAvailable())) {
      return false;
    }

    try {
      const joined = (await invoke<boolean>("steam_join_lobby", { lobbyId })) === true;
      if (joined && !this.joinedLobbies.has(lobbyId)) this.joinedLobbies.set(lobbyId, null);
      return joined;
    } catch {
      return false;
    }
  }

  public async leaveLobby(lobbyId: string): Promise<boolean> {
    if (!isValidSteamId(lobbyId) || !(await this.ensureAvailable())) {
      return false;
    }

    try {
      const left = (await invoke<boolean>("steam_leave_lobby", { lobbyId })) === true;
      if (left) this.joinedLobbies.delete(lobbyId);
      return left;
    } catch {
      return false;
    }
  }

  public getJoinedLobbies(): ReadonlyArray<string> {
    return Array.from(this.joinedLobbies.keys());
  }

  public async setLobbyData(lobbyId: string, key: string, value: string): Promise<boolean> {
    if (
      !isValidSteamId(lobbyId) ||
      !isValidLobbyKey(key) ||
      typeof value !== "string" ||
      value.length > 8 * 1024 ||
      value.includes("\0") ||
      !(await this.ensureAvailable())
    ) {
      return false;
    }

    try {
      return (
        (await invoke<boolean>("steam_set_lobby_data", {
          lobbyId,
          key,
          value,
        })) === true
      );
    } catch {
      return false;
    }
  }

  public async getLobbyData(lobbyId: string, key: string): Promise<string | null> {
    if (!isValidSteamId(lobbyId) || !isValidLobbyKey(key) || !(await this.ensureAvailable())) {
      return null;
    }

    try {
      const value = await invoke<string | null>("steam_get_lobby_data", { lobbyId, key });
      return typeof value === "string" ? value : null;
    } catch {
      return null;
    }
  }

  public async searchLobbies(options: SteamLobbySearchOptions = {}): Promise<ReadonlyArray<SteamLobbyDetails>> {
    const stringFilters = options.stringFilters ?? [];
    const numberFilters = options.numberFilters ?? [];

    if (
      stringFilters.length + numberFilters.length > 16 ||
      stringFilters.some(
        (filter) =>
          !isValidLobbyKey(filter.key) ||
          typeof filter.value !== "string" ||
          filter.value.length > 255 ||
          filter.value.includes("\0") ||
          (filter.comparison !== undefined && filter.comparison !== "equal" && filter.comparison !== "notEqual"),
      ) ||
      numberFilters.some(
        (filter) =>
          !isValidLobbyKey(filter.key) ||
          !Number.isInteger(filter.value) ||
          filter.value < INT32_MIN ||
          filter.value > INT32_MAX,
      ) ||
      (options.slotsAvailable !== undefined &&
        (!Number.isInteger(options.slotsAvailable) || options.slotsAvailable < 0 || options.slotsAvailable > 250)) ||
      (options.distance !== undefined && !["close", "default", "far", "worldwide"].includes(options.distance)) ||
      (options.maxResults !== undefined &&
        (!Number.isInteger(options.maxResults) || options.maxResults < 1 || options.maxResults > 50))
    ) {
      return [];
    }

    if (!(await this.ensureAvailable())) {
      return [];
    }

    try {
      const result = await invoke<NativeSteamLobbyDto[]>("steam_request_lobby_list", {
        search: {
          stringFilters: stringFilters.map((filter) => ({
            key: filter.key,
            value: filter.value,
            comparison: filter.comparison ?? "equal",
          })),
          numberFilters: numberFilters.map((filter) => ({
            key: filter.key,
            value: filter.value,
            comparison: filter.comparison ?? "equal",
          })),
          slotsAvailable: options.slotsAvailable ?? null,
          distance: options.distance ?? null,
          maxResults: options.maxResults ?? null,
        },
      });

      if (!Array.isArray(result)) return [];
      const lobbies: SteamLobbyDetails[] = [];
      for (const entry of result) {
        // RequestLobbyList só retorna lobbies públicos.
        const lobby = this.toLobby(entry, "public");
        if (lobby) lobbies.push(lobby);
      }
      return lobbies;
    } catch {
      return [];
    }
  }

  public async getLobbyDetails(lobbyId: string): Promise<SteamLobbyDetails | null> {
    if (!isValidSteamId(lobbyId) || !(await this.ensureAvailable())) {
      return null;
    }

    try {
      return this.toLobby(await invoke<NativeSteamLobbyDto>("steam_get_lobby_details", { lobbyId }));
    } catch {
      return null;
    }
  }

  public async getLobbyMembers(lobbyId: string): Promise<ReadonlyArray<string>> {
    if (!isValidSteamId(lobbyId) || !(await this.ensureAvailable())) {
      return [];
    }

    try {
      const members = await invoke<string[]>("steam_get_lobby_members", { lobbyId });
      return Array.isArray(members) ? members.filter(isValidSteamId) : [];
    } catch {
      return [];
    }
  }

  public async getLobbyOwner(lobbyId: string): Promise<string | null> {
    const details = await this.getLobbyDetails(lobbyId);
    return details && details.ownerSteamId !== "0" ? details.ownerSteamId : null;
  }

  public async inviteToLobby(lobbyId: string, inviteeSteamId: string): Promise<boolean> {
    if (!isValidSteamId(lobbyId) || !isValidSteamId(inviteeSteamId) || !(await this.ensureAvailable())) {
      return false;
    }

    try {
      return (await invoke<boolean>("steam_invite_to_lobby", { lobbyId, inviteeSteamId })) === true;
    } catch {
      return false;
    }
  }

  public async openInviteDialog(lobbyId: string): Promise<boolean> {
    if (!isValidSteamId(lobbyId) || !(await this.ensureAvailable())) {
      return false;
    }

    try {
      return (await invoke<boolean>("steam_activate_invite_dialog", { lobbyId })) === true;
    } catch {
      return false;
    }
  }

  public async setLobbyJoinable(lobbyId: string, joinable: boolean): Promise<boolean> {
    if (!isValidSteamId(lobbyId) || typeof joinable !== "boolean" || !(await this.ensureAvailable())) {
      return false;
    }

    try {
      return (await invoke<boolean>("steam_set_lobby_joinable", { lobbyId, joinable })) === true;
    } catch {
      return false;
    }
  }

  public async sendP2PPacket(
    targetSteamId: string,
    data: Uint8Array,
    sendType: P2PSendType = "unreliable",
    channel = 0,
  ): Promise<boolean> {
    if (
      !isValidSteamId(targetSteamId) ||
      !(data instanceof Uint8Array) ||
      !isValidChannel(channel) ||
      !isValidPacketSize(sendType, data.byteLength) ||
      !(await this.ensureAvailable())
    ) {
      return false;
    }

    try {
      return (
        (await invoke<boolean>("steam_send_p2p_packet", {
          targetSteamId,
          data: Array.from(data),
          sendType,
          channel,
        })) === true
      );
    } catch {
      return false;
    }
  }

  public async readP2PPacket(channel = 0): Promise<SteamP2PPacket | null> {
    if (!isValidChannel(channel) || !(await this.ensureAvailable())) {
      return null;
    }

    try {
      const result = await invoke<NativeSteamP2PPacketDto | null>("steam_read_p2p_packet", {
        channel,
      });
      const packet = toPacket(result);
      if (packet) this.notifyPacket(packet);
      return packet;
    } catch {
      return null;
    }
  }

  public async readP2PPackets(maxPackets = 256): Promise<ReadonlyArray<SteamP2PPacket>> {
    if (!(await this.ensureAvailable())) {
      return [];
    }

    const limit = Math.max(1, Math.min(MAX_P2P_BATCH_PACKETS, Number.isInteger(maxPackets) ? maxPackets : 256));

    try {
      const batch = await invoke<NativeSteamP2PBatchDto>("steam_read_p2p_packets", {
        maxPackets: limit,
        maxTotalBytes: MAX_P2P_BATCH_BYTES,
      });

      if (!batch || !Array.isArray(batch.packets)) return [];
      if (Number.isInteger(batch.droppedOversized) && batch.droppedOversized > 0) {
        this.droppedOversizedPackets += batch.droppedOversized;
      }

      const packets: SteamP2PPacket[] = [];
      for (const raw of batch.packets) {
        const packet = toPacket(raw);
        if (packet) {
          packets.push(packet);
          this.notifyPacket(packet);
        }
      }
      return packets;
    } catch {
      return [];
    }
  }

  public async acceptP2PSession(remoteSteamId: string): Promise<boolean> {
    if (!isValidSteamId(remoteSteamId) || !(await this.ensureAvailable())) {
      return false;
    }

    try {
      return (await invoke<boolean>("steam_accept_p2p_session", { remoteSteamId })) === true;
    } catch {
      return false;
    }
  }

  public async closeP2PSession(remoteSteamId: string): Promise<boolean> {
    if (!isValidSteamId(remoteSteamId) || !(await this.ensureAvailable())) {
      return false;
    }

    try {
      return (await invoke<boolean>("steam_close_p2p_session", { remoteSteamId })) === true;
    } catch {
      return false;
    }
  }

  public async getP2PSessionState(remoteSteamId: string): Promise<P2PSessionState | null> {
    if (!isValidSteamId(remoteSteamId) || !(await this.ensureAvailable())) {
      return null;
    }

    try {
      const result = await invoke<NativeSteamP2PSessionStateDto | null>(
        "steam_get_p2p_session_state",
        { remoteSteamId },
      );

      if (result === null || result === undefined || result.remoteSteamId !== remoteSteamId) {
        return null;
      }

      return {
        isConnectionActive: result.isConnectionActive,
        isConnecting: result.isConnecting,
        lastError: result.lastError,
        usingRelay: result.usingRelay,
        bytesQueuedForSend: result.bytesQueuedForSend,
        packetsQueuedForSend: result.packetsQueuedForSend,
        remoteSteamId: result.remoteSteamId,
      };
    } catch {
      return null;
    }
  }

  /** Para o pump, libera ouvintes e espera de stats. Idempotente. */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopEventPump();
    for (const waiter of this.statsWaiters) {
      waiter(false);
    }
    this.statsWaiters.clear();
    this.nativeListeners.clear();
    this.availabilityListeners.clear();
    this.packetListeners.clear();
    this.joinedLobbies.clear();
    this.available = false;
  }
}
