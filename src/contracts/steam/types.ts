import { defineCommand, defineEvent } from "@core";

export interface UnlockAchievementRequest {
  readonly achievementId: string;
}

export const UnlockAchievementCommand = defineCommand<
  "game.steam.unlock-achievement",
  UnlockAchievementRequest
>("game.steam.unlock-achievement");

export type SteamStatType = "int" | "float";

export interface SetStatOptions {
  /** `int` (padrão; o valor precisa ser inteiro de 32 bits) ou `float`. */
  readonly type?: SteamStatType;
}

// ── EVENTOS DE PLATAFORMA (G112) ─────────────────────────────────────────

export interface SteamAvailabilityChangedPayload {
  readonly isAvailable: boolean;
}

/** Emitido assim que a disponibilidade da Steam é resolvida no boot e a cada mudança. */
export const SteamAvailabilityChangedEvent = defineEvent<
  "game.steam.availability-changed",
  SteamAvailabilityChangedPayload
>("game.steam.availability-changed");

export interface SteamStatsReadyPayload {
  readonly steamId: string;
}

/** As stats/conquistas do usuário chegaram da Steam: a partir daqui set/unlock são confiáveis. */
export const SteamStatsReadyEvent = defineEvent<
  "game.steam.stats-ready",
  SteamStatsReadyPayload
>("game.steam.stats-ready");

export interface SteamMicroTxnAuthorizationPayload {
  readonly appId: number;
  readonly orderId: string;
  readonly authorized: boolean;
}

/** Resposta do usuário ao diálogo de compra da Steam (MicroTxnAuthorizationResponse_t). */
export const SteamMicroTxnAuthorizationEvent = defineEvent<
  "game.steam.microtxn-authorization",
  SteamMicroTxnAuthorizationPayload
>("game.steam.microtxn-authorization");

export interface SteamWorkshopDownloadResultPayload {
  readonly publishedFileId: string;
  readonly success: boolean;
  readonly error?: string;
}

export const SteamWorkshopDownloadResultEvent = defineEvent<
  "game.steam.workshop-download-result",
  SteamWorkshopDownloadResultPayload
>("game.steam.workshop-download-result");
