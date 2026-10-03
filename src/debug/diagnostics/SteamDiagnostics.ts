import type {
  SteamApi,
} from "../../tokens/steam";

import {
  getErrorMessage,
} from "../../app/errors";

export type SteamDiagnosticLogger = (
  message: string,
) => void;

export async function runSteamDiagnostics(
  steam: SteamApi | null,
  log: SteamDiagnosticLogger,
): Promise<void> {
  if (!steam) {
    return;
  }

  log(
    "⏳ Consultando Steamworks via Tauri...",
  );

  try {
    const isOnline =
      await steam.checkAvailability();

    if (!isOnline) {
      log(
        "⚠️ Steam OFFLINE (Modo Fallback).",
      );

      return;
    }

    const user =
      await steam.getUser();

    if (user) {
      log(
        `🎮 Steam ONLINE: ${user.personaName} (ID: ${user.steamId})`,
      );

      return;
    }

    log(
      "🎮 Steam ONLINE, mas usuário não foi retornado.",
    );
  } catch (error: unknown) {
    console.error(
      "[SteamDiagnostics] Falha ao consultar Steam:",
      error,
    );

    log(
      `⚠️ Erro ao consultar Steam: ${getErrorMessage(error)}`,
    );
  }
}