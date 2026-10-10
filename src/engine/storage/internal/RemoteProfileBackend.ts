import type {
  OnlineProfileEndpointConfig,
  PlayerOnlineProfile,
} from "../../../contracts/storage/types";

import type {
  PlayerProfileBackend,
} from "./CloudDatabaseDriver";

/** Resposta mínima usada do transporte HTTP. */
export interface ProfileHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** Transporte HTTP injetável (padrão: o `fetch` global do runtime). */
export type ProfileHttpTransport = (
  url: string,
  init: {
    readonly method: "GET" | "PUT";
    readonly headers: Record<string, string>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  },
) => Promise<ProfileHttpResponse>;

function isProfile(value: unknown): value is PlayerOnlineProfile {
  if (typeof value !== "object" || value === null) return false;
  const profile = value as Partial<PlayerOnlineProfile>;
  return (
    typeof profile.playerId === "string" &&
    typeof profile.displayName === "string" &&
    typeof profile.rankScore === "number" &&
    typeof profile.inventoryData === "object" &&
    profile.inventoryData !== null &&
    typeof profile.lastSyncedTimestamp === "number"
  );
}

/**
 * Backend remoto genérico por HTTP/JSON (G100):
 * - `PUT  {endpoint}/{playerId}` com o perfil em JSON (sync);
 * - `GET  {endpoint}/{playerId}` → perfil JSON, 404 = inexistente (fetch).
 *
 * Credenciais no cliente são públicas: use tokens de sessão do jogador, nunca
 * chaves de serviço.
 */
export class HttpPlayerProfileBackend implements PlayerProfileBackend {
  public readonly supported = true;

  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly transport: ProfileHttpTransport;

  public constructor(config: OnlineProfileEndpointConfig, transport?: ProfileHttpTransport) {
    if (typeof config?.endpoint !== "string" || config.endpoint.trim().length === 0) {
      throw new Error("HttpPlayerProfileBackend: endpoint obrigatório.");
    }

    this.endpoint = config.endpoint.replace(/\/+$/u, "");
    this.headers = { "content-type": "application/json", ...(config.headers ?? {}) };
    this.timeoutMs = config.timeoutMs !== undefined && Number.isFinite(config.timeoutMs) && config.timeoutMs > 0 ? config.timeoutMs : 10_000;

    const globalTransport = (globalThis as unknown as { readonly fetch?: ProfileHttpTransport }).fetch;
    const resolved = transport ?? (globalTransport ? globalTransport.bind(globalThis) : undefined);
    if (!resolved) {
      throw new Error("HttpPlayerProfileBackend: nenhum transporte HTTP disponível neste runtime.");
    }
    this.transport = resolved;
  }

  public async write(profile: PlayerOnlineProfile): Promise<void> {
    const response = await this.request("PUT", profile.playerId, JSON.stringify(profile));
    if (!response.ok) {
      throw new Error(`HTTP ${String(response.status)} ao sincronizar o perfil.`);
    }
  }

  public async read(playerId: string): Promise<PlayerOnlineProfile | null> {
    const response = await this.request("GET", playerId);
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`HTTP ${String(response.status)} ao buscar o perfil.`);
    }
    const body = await response.json();
    if (!isProfile(body)) {
      throw new Error("Resposta do servidor não é um perfil válido.");
    }
    return body;
  }

  private async request(method: "GET" | "PUT", playerId: string, body?: string): Promise<ProfileHttpResponse> {
    const url = `${this.endpoint}/${encodeURIComponent(playerId)}`;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;

    try {
      return await this.transport(url, {
        method,
        headers: this.headers,
        ...(body !== undefined ? { body } : {}),
        ...(controller ? { signal: controller.signal } : {}),
      });
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }
}
