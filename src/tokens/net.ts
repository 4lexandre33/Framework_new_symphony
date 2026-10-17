import {
  defineCapability,
} from "@core";

import type {
  AutoSnapshotOptions,
  EntitySnapshot,
  NetHostOptions,
  NetMode,
  NetPeerInfo,
  NetSessionOptions,
  NetworkStats,
  TransportType,
  StateReplicationApi,
  WorldStateSnapshot,
} from "../contracts/net/types";


export interface NetworkApi {
  readonly mode:
    NetMode;

  readonly transportType:
    TransportType;

  /**
   * Abre uma sessão de host. Transporte: `options.transport`, o preferido
   * (`setPreferredTransport`) ou Steam se disponível, senão `mock`
   * (loopback em memória, `loopback://<room|port>`). `maxClients` é imposto
   * no handshake; `port`/`room` nomeiam a sala do loopback/BroadcastChannel
   * (Steam não usa portas). WebSocket não hospeda: resolve `false`.
   */
  startHost(
    options?: NetHostOptions,
  ): Promise<boolean>;

  /**
   * Conecta a um host e resolve `true` só após o handshake (WELCOME).
   * `ws(s)://…` (servidor que fala o protocolo do game.net),
   * `loopback://sala`, `bc://sala`, ou SteamID64 (exige Steam).
   */
  connect(
    targetAddressOrSteamId:
      string,
  ): Promise<boolean>;

  disconnect():
    Promise<void>;

  /**
   * Envia a um par conectado. Canal 0..255 preservado; mensagens
   * confiáveis grandes são fragmentadas (até 16 MiB); não confiáveis acima
   * do MTU do transporte são recusadas (`false`).
   */
  sendTo(
    targetId: string,
    channel: number,
    data: Uint8Array,
    reliable?: boolean,
  ): Promise<boolean>;

  broadcast(
    channel: number,
    data: Uint8Array,
    reliable?: boolean,
  ): Promise<boolean>;

  /** Não destrutivo: RTT e perda reais medidos por ping/pong da sessão. */
  getStats():
    NetworkStats;

  getStateReplicator():
    StateReplicationApi;

  registerEntity(
    entityId: string,
    initialSnapshot:
      EntitySnapshot,
  ): void;

  unregisterEntity(
    entityId: string,
  ): void;

  updateEntityState(
    entityId: string,
    state:
      Partial<EntitySnapshot>,
  ): void;

  /**
   * Estado interpolado. Objeto REUTILIZADO (por entidade) — leia na hora e
   * use `copyEntitySnapshot` (contracts/net/types) para guardar (G31).
   */
  getInterpolatedState(
    entityId: string,
    renderAlpha: number,
  ): EntitySnapshot | null;

  /** Transportes utilizáveis neste runtime. */
  getAvailableTransports():
    ReadonlyArray<TransportType>;

  /** Transporte padrão do `startHost()` (só offline; `false` se indisponível). */
  setPreferredTransport(
    type: TransportType | null,
  ): boolean;

  /** Heartbeat/timeouts da sessão. */
  configure(
    options: NetSessionOptions,
  ): void;

  /** Pares com handshake completo e suas métricas. */
  getPeers():
    ReadonlyArray<NetPeerInfo>;

  /**
   * Envia um snapshot de mundo aos pares (padrão: gerado do replicador). No
   * destino ele é aplicado ao replicador e emitido como `game.net.snapshot`.
   */
  broadcastSnapshot(
    snapshot?: WorldStateSnapshot,
    reliable?: boolean,
  ): Promise<boolean>;

  /** Envio automático de snapshot pelo host a cada N ticks. */
  setAutoSnapshot(
    options: AutoSnapshotOptions,
  ): boolean;
}

export const NetworkToken =
  defineCapability<NetworkApi>(
    "game.net",
    "1.0.0",
  );
