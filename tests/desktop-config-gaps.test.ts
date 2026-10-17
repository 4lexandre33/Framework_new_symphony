// @vitest-environment node
import fs from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error módulo .mjs sem tipos
import { buildProjectTauriConfig, SAFE_WINDOW_DEFAULTS } from "../scripts/tauri-project-config.mjs";

describe("G32 tauri.conf.json e identidade por jogo", () => {
  it("janela do host tem defaults seguros (bordas, não sempre-no-topo, opaca)", () => {
    const cfg = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
    expect(cfg.app.windows[0]).toMatchObject({ decorations: true, alwaysOnTop: false, transparent: false });
  });

  it("gera identidade por jogo com defaults seguros e overlay opt-in", () => {
    const base = { width: 1280, height: 720, transparent: true, decorations: false, alwaysOnTop: true };
    const plain = buildProjectTauriConfig("meu-jogo", {}, base);
    expect(plain.identifier).toBe("com.projeto1.meujogo");
    expect(plain.productName).toBe("meu-jogo");
    expect(plain.app.windows[0]).toMatchObject({ ...SAFE_WINDOW_DEFAULTS, width: 1280, title: "meu-jogo" });

    const overlay = buildProjectTauriConfig("hud", {
      productName: "HUD Overlay",
      identifier: "com.acme.hud",
      window: { transparent: true, decorations: false, alwaysOnTop: true },
    });
    expect(overlay.app.windows[0]).toMatchObject({ transparent: true, decorations: false, alwaysOnTop: true, title: "HUD Overlay" });
    expect(overlay.identifier).toBe("com.acme.hud");
  });

  it("valida entrada (id, identifier, chaves de janela)", () => {
    expect(() => buildProjectTauriConfig("../x", {})).toThrow(/id de projeto/);
    expect(() => buildProjectTauriConfig("a", { identifier: "semponto" })).toThrow(/identifier/);
    expect(() => buildProjectTauriConfig("a", { identifier: "com.projeto1.game" })).toThrow(/host/);
    expect(() => buildProjectTauriConfig("a", { window: { url: "http://evil" } })).toThrow(/não é permitido/);
    expect(() => buildProjectTauriConfig("a", { window: { width: "100" } })).toThrow(/number/);
    expect(() => buildProjectTauriConfig("a", { extra: 1 })).toThrow(/desconhecida/);
  });
});
