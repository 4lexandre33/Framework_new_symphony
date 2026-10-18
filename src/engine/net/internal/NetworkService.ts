import type {
  PluginContext,
} from "@core";

import type {
  NetworkApi,
} from "../../../tokens/net";

import type {
  SteamApi,
} from "../../../tokens/steam";

import type {
  SteamNetworkApi,
} from "../../../tokens/steam-net";

import type {
  AutoSnapshotOptions,
  EntitySnapshot,
  NetHostEndpoint,
  NetHostOptions,
  NetMode,
  NetPeerInfo,
  NetSessionOptions,
  NetworkStats,
  StateReplicationApi,
  TransportType,
  WorldStateSnapshot,
} from "../../../contracts/net/types";

import {
  BroadcastChannelTransport,
  parseBroadcastTarget,
} from "./BroadcastChannelTransport";

import {
  LoopbackTransport,
  parseLoopbackTarget,
} from "./LoopbackTransport";

import {
  DEFAULT_MAX_CLIENTS,
  MAX_CLIENTS_LIMIT,
  NetSession,
} from "./NetSession";

import type {
  NetworkTransport,
} from "./NetworkTransport";

import {
  SteamP2PTransport,
} from "./SteamP2PTransport";

import {
  LOCAL_ENTITY_OWNER,
  StateReplicator,
} from "./StateReplicator";

import {
  DEDICATED_SERVER_PEER_ID,
  WebSocketTransport,
} from "./WebSocketTransport";

const STEAM_ID_PATTERN = /^\d{1,20}$/u;
const WEBSOCKET_PATTERN = /^wss?:\/\//iu;

export interface NetworkServiceOptions {
  /** Relógio (ms). Padrão `performance.now()`. */
  readonly now?: () => number;
  /** Fábricas de transporte (testes/injeção). */
  readonly createTransport?: Partial<Record<TransportType, () => NetworkTransport>>;
}

function isSupportedTransportType(type: unknown): type is TransportType {
  return (
    type === "steam_p2p" ||
    type === "websocket" ||
    type === "mock" ||
    type === "broadcast_channel" ||
    type === "webrtc"
  );
}

export class NetworkService
  implements NetworkApi {
  private currentMode:
    NetMode =
      "offline";

  private activeTransport:
    NetworkTransport;

  private session:
    NetSession;

  private readonly stateReplicator =
    new StateReplicator();

  private readonly transportUnbinders:
    Array<() => void> =
      [];

  private pollInFlight =
    false;

  private disposed =
    false;

  private steamApi:
    SteamApi | undefined;

  private steamNet:
    SteamNetworkApi | undefined;

  private localSteamId:
    string | null =
      null;

  private preferredTransport:
    TransportType | null =
      null;

  private sessionOptions:
    NetSessionOptions =
      {};

  private autoSnapshot:
    Required<AutoSnapshotOptions> = {
      enabled: false,
      intervalTicks: 3,
      reliable: false,
    };

  private snapshotSequence =
    0;

  private lastTick =
    0;

  /** Sessão ativa ou handshake em curso: o plugin bombeia também no render. */
  private pumpActive =
    false;

  private readonly now:
    () => number;

  private readonly factories:
    Partial<Record<TransportType, () => NetworkTransport>>;

  public constructor(
    private readonly ctx:
      PluginContext,
    options: NetworkServiceOptions = {},
  ) {
    this.now =
      options.now ??
      (() => performance.now());

    this.factories =
      options.createTransport ??
      {};

    this.activeTransport =
      this.instantiate("websocket") ??
      new WebSocketTransport();

    this.session =
      this.createSession(
        this.activeTransport,
      );

    this.bindTransportEvents();
  }

  // ── seleção de transporte (G106) ─────────────────────────────────────────

  private instantiate(
    type: TransportType,
  ): NetworkTransport | null {
    const factory =
      this.factories[type];

    if (factory) {
      return factory();
    }

    switch (type) {
      case "websocket":
        return new WebSocketTransport();
      case "mock":
        return new LoopbackTransport({ now: this.now });
      case "broadcast_channel":
        return BroadcastChannelTransport.isSupported()
          ? new BroadcastChannelTransport({ now: this.now })
          : null;
      case "steam_p2p":
        return this.steamApi && this.steamApi.isAvailable
          ? new SteamP2PTransport(this.steamApi)
          : null;
      default:
        // webrtc: não implementado — seleção falha de forma explícita.
        return null;
    }
  }

  /** Transportes utilizáveis agora neste runtime. */
  public getAvailableTransports():
    ReadonlyArray<TransportType> {
    const result: TransportType[] = ["mock"];

    if (this.factories.broadcast_channel || BroadcastChannelTransport.isSupported()) {
      result.push("broadcast_channel");
    }

    if (this.factories.websocket || typeof WebSocket !== "undefined") {
      result.push("websocket");
    }

    if (this.factories.steam_p2p || (this.steamApi && this.steamApi.isAvailable)) {
      result.push("steam_p2p");
    }

    return result;
  }

  /**
   * Define o transporte padrão de `startHost()` (só offline). Retorna
   * `false` se indisponível (ex.: `webrtc`, Steam ausente).
   */
  public setPreferredTransport(
    type: TransportType | null,
  ): boolean {
    if (this.disposed || this.currentMode !== "offline") {
      return false;
    }

    if (type === null) {
      this.preferredTransport = null;
      return true;
    }

    if (!isSupportedTransportType(type) || !this.getAvailableTransports().includes(type)) {
      return false;
    }

    this.preferredTransport = type;
    return true;
  }

  private switchTransport(
    type: TransportType,
  ): boolean {
    if (this.activeTransport.type === type) {
      return true;
    }

    const next =
      this.instantiate(type);

    if (!next) {
      return false;
    }

    this.unbindTransportEvents();
    this.activeTransport.dispose();
    this.activeTransport = next;
    this.session = this.createSession(next);
    this.bindTransportEvents();
    return true;
  }

  public bindSteamCapability(
    steamApi:
      SteamApi | undefined,
  ): void {
    if (this.disposed || !steamApi) {
      return;
    }

    this.steamApi =
      steamApi;

    if (steamApi.isAvailable) {
      void steamApi
        .getUser()
        .then((user) => {
          this.localSteamId = user?.steamId ?? null;
        })
        .catch(() => undefined);
    }

    if (
      !steamApi.isAvailable ||
      this.activeTransport.type ===
        "steam_p2p" ||
      this.currentMode !==
        "offline"
    ) {
      return;
    }

    // Steam disponível vira o transporte padrão (sem limpar o replicador: G107).
    this.switchTransport(
      "steam_p2p",
    );
  }

  /** Lobby/sessões P2P (aceitar sessão do cliente no host, fechar ao sair). */
  public bindSteamNetwork(
    steamNet:
      SteamNetworkApi | undefined,
  ): void {
    if (!this.disposed) {
      this.steamNet = steamNet;
    }
  }

  /**
   * `game.steam.p2p-session-request`: o host aceita clientes; o cliente só
   * aceita o próprio host. Retorna se aceitou.
   */
  public async handleSteamSessionRequest(
    remoteSteamId: string,
  ): Promise<boolean> {
    if (
      this.disposed ||
      this.activeTransport.type !== "steam_p2p" ||
      !STEAM_ID_PATTERN.test(remoteSteamId) ||
      !this.steamNet
    ) {
      return false;
    }

    const role =
      this.session.activeRole;

    const accept =
      role === "host" ||
      (role === "client" && this.session.hostPeerId === remoteSteamId) ||
      (role === "client" && this.pendingHostId === remoteSteamId);

    if (!accept) {
      return false;
    }

    return this.steamNet.acceptP2PSession(
      remoteSteamId,
    );
  }

  /** `game.steam.p2p-session-failed`: derruba o par imediatamente. */
  public handleSteamSessionFailed(
    remoteSteamId: string,
  ): void {
    if (this.activeTransport.type === "steam_p2p") {
      this.session.handleLinkDisconnected(
        remoteSteamId,
        "steam_session_failed",
      );
    }
  }

  private pendingHostId:
    string | null =
      null;

  public get mode():
    NetMode {
    return this.currentMode;
  }

  public get transportType():
    TransportType {
    return this.activeTransport.type;
  }

  /** Ajusta heartbeat/timeouts da sessão (vale para as próximas e a atual). */
  public configure(
    options: NetSessionOptions,
  ): void {
    this.sessionOptions = {
      ...this.sessionOptions,
      ...options,
    };
    this.session.configure(
      this.sessionOptions,
    );
  }

  private localPeerId(): string {
    if (this.activeTransport.type === "steam_p2p" && this.localSteamId) {
      return this.localSteamId;
    }

    const transport =
      this.activeTransport as NetworkTransport & { localId?: string };

    return typeof transport.localId === "string" && transport.localId.length > 0
      ? transport.localId
      : this.currentMode === "host"
        ? "host"
        : "client";
  }

  /**
   * G8: endereço do host WebSocket nativo ativo (`ws://127.0.0.1:porta` e,
   * com `bind: "lan"`, `ws://<ip-lan>:porta`); null fora desse modo.
   */
  public getHostEndpoint(): NetHostEndpoint | null {
    if (this.currentMode !== "host" || !(this.activeTransport instanceof WebSocketTransport)) {
      return null;
    }

    const info = this.activeTransport.getHostInfo();

    if (info === null) {
      return null;
    }

    return {
      transport: "websocket",
      port: info.port,
      bind: info.bind === "lan" ? "lan" : "loopback",
      localUrl: `ws://127.0.0.1:${String(info.port)}`,
      lanUrl: info.lanAddress ? `ws://${info.lanAddress}:${String(info.port)}` : null,
    };
  }

  public async startHost(
    options: NetHostOptions = {},
  ): Promise<boolean> {
    if (this.disposed) {
      return false;
    }

    const maxClients =
      options.maxClients ??
      DEFAULT_MAX_CLIENTS;

    if (
      !Number.isInteger(maxClients) ||
      maxClients < 1 ||
      maxClients > MAX_CLIENTS_LIMIT ||
      (options.port !== undefined &&
        (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535)) ||
      (options.transport !== undefined && !isSupportedTransportType(options.transport)) ||
      (options.bind !== undefined && options.bind !== "loopback" && options.bind !== "lan")
    ) {
      return false;
    }

    if (
      this.currentMode !==
      "offline"
    ) {
      await this.disconnect();
    }

    const type: TransportType =
      options.transport ??
      this.preferredTransport ??
      (this.steamApi?.isAvailable ? "steam_p2p" : "mock");

    if (!this.switchTransport(type)) {
      return false;
    }

    // WebSocket só hospeda no app nativo (servidor Rust, G8); no navegador não.
    if (!this.activeTransport.canHost) {
      return false;
    }

    const listening =
      await this.activeTransport.listen({
        ...(options.port !== undefined ? { port: options.port } : {}),
        ...(options.room !== undefined ? { room: options.room } : {}),
        ...(options.bind !== undefined ? { bind: options.bind } : {}),
        maxClients,
      });

    if (!listening || this.disposed) {
      return false;
    }

    this.session.startHost(
      maxClients,
    );

    this.currentMode =
      "host";

    this.startPump();
    return true;
  }

  private resolveTargetTransport(
    target: string,
  ): TransportType | null {
    if (WEBSOCKET_PATTERN.test(target)) {
      return "websocket";
    }
    if (parseLoopbackTarget(target) !== null) {
      return "mock";
    }
    if (parseBroadcastTarget(target) !== null) {
      return "broadcast_channel";
    }
    if (STEAM_ID_PATTERN.test(target)) {
      return this.steamApi?.isAvailable || this.factories.steam_p2p ? "steam_p2p" : null;
    }
    return null;
  }

  /**
   * Conecta a um host com handshake real (G105): resolve `true` só depois
   * do WELCOME do host; REJECT/timeout/link caído resolvem `false`.
   * Endereço define o transporte: `ws(s)://`, `loopback://sala`,
   * `bc://sala`, ou SteamID64 (exige Steam).
   */
  public async connect(
    target: string,
  ): Promise<boolean> {
    if (this.disposed || typeof target !== "string") {
      return false;
    }

    const normalizedTarget =
      target.trim();

    const type =
      this.resolveTargetTransport(
        normalizedTarget,
      );

    if (type === null) {
      return false;
    }

    if (
      this.currentMode !==
      "offline"
    ) {
      await this.disconnect();
    }

    if (!this.switchTransport(type)) {
      return false;
    }

    const linked =
      await this.activeTransport
        .connect(
          normalizedTarget,
        );

    if (!linked || this.disposed) {
      return false;
    }

    const hostLinkId =
      this.resolveHostLinkId(
        normalizedTarget,
      );

    if (hostLinkId === null) {
      await this.activeTransport.disconnect();
      return false;
    }

    this.pendingHostId =
      hostLinkId;

    this.startPump();

    const accepted =
      await this.session.connect(
        hostLinkId,
      );

    this.pendingHostId =
      null;

    if (!accepted || this.disposed) {
      this.stopPump();
      if (!this.disposed) {
        await this.activeTransport.disconnect();
      }
      return false;
    }

    this.currentMode =
      "client";

    return true;
  }

  private resolveHostLinkId(
    target: string,
  ): string | null {
    switch (this.activeTransport.type) {
      case "websocket":
        return DEDICATED_SERVER_PEER_ID;
      case "steam_p2p":
        return target;
      case "mock": {
        const room = parseLoopbackTarget(target);
        return room === null ? null : `loopback-host:${room}`;
      }
      case "broadcast_channel": {
        const room = parseBroadcastTarget(target);
        return room === null ? null : `bc-host:${room}`;
      }
      default:
        return null;
    }
  }

  public async disconnect():
    Promise<void> {
    if (this.disposed) {
      return;
    }

    const removed =
      await this.session.close(
        "local_disconnect",
      );

    for (const peerId of removed) {
      this.afterPeerRemoved(peerId);
      this.ctx.events.emit(
        "game.net.peer-disconnected",
        { peerId, reason: "local_disconnect" },
      );
    }

    this.unbindTransportEvents();

    try {
      await this.activeTransport
        .disconnect();
    } finally {
      this.bindTransportEvents();
    }

    this.stopPump();

    this.currentMode =
      "offline";

    // G107: entidades locais sobrevivem; as remotas saem com a sessão.
    this.stateReplicator.clearRemote();
  }

  public async sendTo(
    targetId: string,
    channel: number,
    data: Uint8Array,
    reliable: boolean = true,
  ): Promise<boolean> {
    if (
      this.disposed ||
      this.currentMode ===
        "offline"
    ) {
      return false;
    }

    return await this.session.send(
      targetId,
      channel,
      data,
      reliable,
    );
  }

  public async broadcast(
    channel: number,
    data: Uint8Array,
    reliable: boolean = true,
  ): Promise<boolean> {
    if (
      this.disposed ||
      this.currentMode ===
        "offline"
    ) {
      return false;
    }

    return await this.session.broadcast(
      channel,
      data,
      reliable,
    );
  }

  /** Estatísticas não destrutivas (G108): RTT/perda reais via ping/pong. */
  public getStats():
    NetworkStats {
    return {
      rttMs:
        Math.round(this.session.averageRttMs() * 100) / 100,
      packetLossRate:
        this.session.averageLossRate(),
      bytesSentPerSec:
        Math.round(this.session.bytesSentPerSec()),
      bytesReceivedPerSec:
        Math.round(this.session.bytesReceivedPerSec()),
      activeConnections:
        this.session.getPeerIds().length,
      transportType:
        this.activeTransport.type,
    };
  }

  /** Pares com handshake completo (RTT/perda individuais). */
  public getPeers():
    ReadonlyArray<NetPeerInfo> {
    return this.session.getPeers();
  }

  public getStateReplicator():
    StateReplicationApi {
    return this.stateReplicator;
  }

  // ── snapshots (G8) ───────────────────────────────────────────────────────

  public setAutoSnapshot(
    options: AutoSnapshotOptions,
  ): boolean {
    const intervalTicks =
      options.intervalTicks ??
      this.autoSnapshot.intervalTicks;

    if (
      typeof options.enabled !== "boolean" ||
      !Number.isInteger(intervalTicks) ||
      intervalTicks < 1 ||
      intervalTicks > 10_000
    ) {
      return false;
    }

    this.autoSnapshot = {
      enabled: options.enabled,
      intervalTicks,
      reliable: options.reliable ?? this.autoSnapshot.reliable,
    };

    return true;
  }

  /**
   * Envia um snapshot de mundo aos pares (padrão: gerado do replicador —
   * host envia todas as entidades; cliente só as locais).
   */
  public async broadcastSnapshot(
    snapshot?: WorldStateSnapshot,
    reliable = this.autoSnapshot.reliable,
  ): Promise<boolean> {
    if (
      this.disposed ||
      this.currentMode ===
        "offline"
    ) {
      return false;
    }

    const outgoing =
      snapshot ??
      this.generateOutgoingSnapshot();

    return this.session.broadcastSnapshot(
      outgoing,
      reliable,
    );
  }

  private generateOutgoingSnapshot():
    WorldStateSnapshot {
    this.snapshotSequence += 1;

    const full =
      this.stateReplicator.generateWorldSnapshot(
        this.snapshotSequence,
        this.lastTick,
        this.localPeerId(),
      );

    if (this.currentMode === "host") {
      return full;
    }

    return {
      ...full,
      entities: full.entities.filter(
        (entity) => this.stateReplicator.getEntityOwner(entity.entityId) === LOCAL_ENTITY_OWNER,
      ),
    };
  }

  /** Chamado a cada `game.loop.tick`. */
  public onTick(
    tickCount: number,
  ): void {
    if (this.disposed) {
      return;
    }

    if (Number.isSafeInteger(tickCount)) {
      this.lastTick = tickCount;
    }

    void this.pollPackets();

    if (
      this.autoSnapshot.enabled &&
      this.currentMode === "host" &&
      this.session.getPeerIds().length > 0 &&
      this.lastTick % this.autoSnapshot.intervalTicks === 0
    ) {
      void this.broadcastSnapshot();
    }
  }

  // ── replicação local ─────────────────────────────────────────────────────

  public registerEntity(
    entityId: string,
    initialSnapshot:
      EntitySnapshot,
  ): void {
    if (this.disposed) {
      return;
    }

    this.stateReplicator
      .registerEntity(
        entityId,
        initialSnapshot,
      );
  }

  public unregisterEntity(
    entityId: string,
  ): void {
    this.stateReplicator
      .unregisterEntity(
        entityId,
      );
  }

  public updateEntityState(
    entityId: string,
    state:
      Partial<EntitySnapshot>,
  ): void {
    if (this.disposed) {
      return;
    }

    const previous =
      this.stateReplicator
        .getInterpolatedState(
          entityId,
          1,
        );

    const snapshot:
      EntitySnapshot = {
        entityId,
        type:
          state.type ??
          previous?.type ??
          "default",
        position:
          state.position ??
          previous?.position ?? {
            x: 0,
            y: 0,
            z: 0,
          },
        rotation:
          state.rotation ??
          previous?.rotation ?? {
            x: 0,
            y: 0,
            z: 0,
            w: 1,
          },
        velocity:
          state.velocity ??
          previous?.velocity ?? {
            x: 0,
            y: 0,
            z: 0,
          },
        sequence:
          state.sequence ??
          (
            previous?.sequence ??
            -1
          ) +
            1,
        timestamp:
          state.timestamp ??
          performance.now(),
      };

    this.stateReplicator
      .pushEntitySnapshot(
        snapshot,
      );
  }

  public getInterpolatedState(
    entityId: string,
    renderAlpha: number,
  ): EntitySnapshot | null {
    return this.stateReplicator
      .getInterpolatedState(
        entityId,
        renderAlpha,
      );
  }

  public async pollPackets():
    Promise<void> {
    if (
      this.disposed ||
      this.pollInFlight
    ) {
      return;
    }

    this.pollInFlight =
      true;

    try {
      await this.activeTransport
        .pollPackets();
      this.session.update();
    } finally {
      this.pollInFlight =
        false;
    }
  }

  /*
   * Sem timers no runtime de rede (política NET004): o bombeamento é feito
   * pelo plugin em `game.loop.tick` E em `game.loop.render` (o render
   * continua durante a pausa), mantendo heartbeat/handshake vivos com o
   * jogo pausado.
   */
  private startPump(): void {
    this.pumpActive = !this.disposed;
  }

  private stopPump(): void {
    this.pumpActive = false;
  }

  /** Chamado a cada `game.loop.render`: só bombeia com sessão/handshake ativos. */
  public onRenderFrame(): void {
    if (this.pumpActive && !this.disposed) {
      void this.pollPackets();
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed =
      true;

    this.stopPump();

    this.currentMode =
      "offline";

    this.pollInFlight =
      false;

    void this.session.close("transport_disposed");

    this.unbindTransportEvents();

    this.activeTransport.dispose();

    this.stateReplicator.clear();
  }

  // ── sessão ↔ eventos ─────────────────────────────────────────────────────

  private createSession(
    transport: NetworkTransport,
  ): NetSession {
    const session = new NetSession(
      transport,
      {
        onPeerConnected: (peerId) => {
          this.ctx.events.emit(
            "game.net.peer-connected",
            { peerId, transport: transport.type },
          );
        },
        onPeerDisconnected: (peerId, reason) => {
          this.afterPeerRemoved(peerId);
          this.ctx.events.emit(
            "game.net.peer-disconnected",
            { peerId, reason },
          );
        },
        onData: (senderId, channel, data) => {
          this.ctx.events.emit(
            "game.net.packet-received",
            { senderId, channel, data },
          );
        },
        onSnapshot: (senderId, snapshot) => {
          this.stateReplicator.processWorldSnapshot(snapshot, senderId);
          this.ctx.events.emit(
            "game.net.snapshot",
            { snapshot },
          );
        },
        onSessionClosed: () => {
          // Cliente perdeu o host: volta a offline (G105).
          if (this.currentMode === "client") {
            this.currentMode = "offline";
            this.stopPump();
            void transport.disconnect();
          }
        },
      },
      this.now,
      () => this.localPeerId(),
    );

    session.configure(
      this.sessionOptions,
    );

    return session;
  }

  private afterPeerRemoved(
    peerId: string,
  ): void {
    this.stateReplicator.removeEntitiesFrom(peerId);

    if (
      this.activeTransport.type === "steam_p2p" &&
      this.steamNet &&
      STEAM_ID_PATTERN.test(peerId)
    ) {
      void this.steamNet.closeP2PSession(peerId).catch(() => false);
    }
  }

  private bindTransportEvents():
    void {
    const transport =
      this.activeTransport;

    this.transportUnbinders.push(
      transport.onPacket(
        (senderId, _channel, data): void => {
          if (this.activeTransport === transport) {
            this.session.handleRaw(senderId, data);
          }
        },
      ),
    );

    this.transportUnbinders.push(
      transport.onPeerDisconnected(
        (peerId, reason): void => {
          if (this.activeTransport === transport) {
            this.session.handleLinkDisconnected(peerId, reason);
          }
        },
      ),
    );
  }

  private unbindTransportEvents():
    void {
    for (
      let index =
        this.transportUnbinders.length -
        1;
      index >= 0;
      index -= 1
    ) {
      this.transportUnbinders[
        index
      ]?.();
    }

    this.transportUnbinders.length =
      0;
  }
}
