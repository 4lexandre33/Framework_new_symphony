// Harness de navegador real para os GAPS de storage (G12/G101/G102):
// Web Storage real (cota, SecurityError em origem opaca), WebCrypto (HMAC)
// e persistência entre recarregamentos. Empacotado por tests/browser/storage-gaps.mjs.
import type { PluginContext } from "@core";

import { StorageService } from "../../src/engine/storage/internal/StorageService";

const emitted: Array<[string, unknown]> = [];
const ctx = {
  events: {
    emit: (type: string, payload: unknown): void => {
      emitted.push([type, payload]);
    },
  },
} as unknown as PluginContext;

function make(): StorageService {
  return new StorageService(ctx);
}

async function errorOf(promise: Promise<unknown>): Promise<Record<string, unknown> | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    const e = error as { code?: unknown; reason?: unknown; name?: unknown; message?: unknown };
    return { code: e.code, reason: e.reason, name: e.name, message: String(e.message) };
  }
}

(window as unknown as { storageGaps: unknown }).storageGaps = {
  async opaqueOrigin(): Promise<Record<string, unknown>> {
    let webStorageThrows = false;
    try {
      void window.localStorage.length;
    } catch {
      webStorageThrows = true;
    }
    const svc = make();
    await svc.saveGame("slot", { a: 1 });
    return { webStorageThrows, info: svc.getBackendInfo(), loaded: await svc.loadGame("slot") };
  },

  async persistWrite(): Promise<Record<string, unknown>> {
    window.localStorage.clear();
    const svc = make();
    svc.configureSaves({ namespace: "meu-jogo", integrityKey: "k", backupCount: 2 });
    await svc.saveGame("Slot Um/ç%", { gold: 1 }, undefined, { playTimeSeconds: 12 });
    await svc.saveGame("Slot Um/ç%", { gold: 2 }, undefined, { playTimeSeconds: 30 });
    return { info: svc.getBackendInfo(), keys: Object.keys(window.localStorage) };
  },

  async persistRead(): Promise<Record<string, unknown>> {
    const svc = make();
    svc.configureSaves({ namespace: "meu-jogo", integrityKey: "k", backupCount: 2 });
    const other = make();
    other.configureSaves({ namespace: "outro-jogo" });
    const key = Object.keys(window.localStorage).find((k) => k.startsWith("ns:meu-jogo:local_db_save_S")) ?? "";
    const before = await svc.loadGame("Slot Um/ç%");
    // adulteração: HMAC/checksum pegam e o backup recupera
    const raw = JSON.parse(window.localStorage.getItem(key) ?? "{}") as { payload: string };
    raw.payload = "{\"gold\":999}";
    window.localStorage.setItem(key, JSON.stringify(raw));
    const recovered = await svc.loadGameDetailed("Slot Um/ç%");
    return {
      key,
      before,
      recovered,
      list: (await svc.listSaves()).map((m) => [m.slotName, m.signed, m.playTimeSeconds]),
      otherList: (await other.listSaves()).length,
      events: emitted.map(([t]) => t),
    };
  },

  async quota(): Promise<Record<string, unknown>> {
    window.localStorage.clear();
    // Enche o Web Storage até a cota real do Chromium.
    const chunk = "x".repeat(256 * 1024);
    let filled = 0;
    for (;;) {
      try {
        window.localStorage.setItem(`filler_${filled}`, chunk);
        filled += 1;
      } catch {
        break;
      }
    }
    const svc = make();
    const big = { blob: "y".repeat(512 * 1024) };
    const failure = await errorOf(svc.saveGame("big", big));
    const failedEvent = emitted.filter(([t]) => t === "game.storage.save-completed").pop();
    // libera espaço para um save (mas não para save + backup)
    for (let i = 0; i < 3; i += 1) window.localStorage.removeItem(`filler_${i}`);
    const ok = await errorOf(svc.saveGame("big", big));
    const second = await errorOf(svc.saveGame("big", { blob: "z".repeat(512 * 1024) }));
    const loaded = (await svc.loadGame<{ blob: string }>("big"))?.blob.slice(0, 1);
    const backupKept = Object.keys(window.localStorage).some((k) => k.includes("#bak1:big"));
    window.localStorage.clear();
    return { filledChunks: filled, failure, failedEvent: failedEvent?.[1], ok, second, loaded, backupKept };
  },
};
