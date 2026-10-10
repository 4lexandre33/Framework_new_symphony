// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { Kernel, type Plugin, type PluginContext } from "@core";

import { UIService, type UIServiceOptions } from "../src/engine/ui/internal/UIService";
import { createUIPlugin } from "../src/plugins/ui/plugin";
import { UIToken, type UIApi } from "../src/tokens/ui";

interface Harness {
  service: UIService;
  emitted: Array<[string, unknown]>;
  sent: Array<[string, unknown]>;
}

function createService(options: UIServiceOptions = {}): Harness {
  const emitted: Array<[string, unknown]> = [];
  const sent: Array<[string, unknown]> = [];
  const ctx = {
    events: {
      emit: (type: string, payload: unknown): void => {
        emitted.push([type, payload]);
      },
    },
    commands: {
      send: async (type: string, payload: unknown): Promise<void> => {
        sent.push([type, payload]);
      },
    },
  } as unknown as PluginContext;
  return { service: new UIService(ctx, options), emitted, sent };
}

function click(element: Element | null): void {
  element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function escape(): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
}

afterEach((): void => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("G11 — templateId e HTML seguro", () => {
  it("templateId instancia o template com valores escapados", () => {
    const { service } = createService();
    service.registerTemplate("player", '<p class="who">{{name}}</p><b>{{score}}</b>');
    service.pushModal({
      id: "m",
      title: "Jogador",
      templateId: "player",
      templateData: { name: "<img src=x onerror=alert(1)>", score: 42 },
    });
    const body = document.querySelector(".ui-modal-body")!;
    expect(body.querySelector("p.who")?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(body.querySelector("img")).toBeNull();
    expect(body.querySelector("b")?.textContent).toBe("42");
    expect(service.renderTemplate("player", { name: "<i>", score: 1 })).toBe('<p class="who">&lt;i&gt;</p><b>1</b>');
    service.dispose();
  });

  it("contentHtml é sanitizado; contentText é texto puro; trustedHtml preserva", () => {
    const { service } = createService();
    service.pushModal({
      id: "a",
      title: "A",
      contentHtml:
        '<p onclick="x()">ok<script>alert(1)</script></p><a href="javascript:alert(1)">l</a><img src="data:image/png;base64,AA" onerror="y()"><iframe src="//evil"></iframe><svg><a xlink:href="javascript:1"></a><animate attributeName="href" values="javascript:1"/></svg>',
    });
    const body = document.querySelector('[data-modal-id="a"] .ui-modal-body')!;
    expect(body.querySelector("script")).toBeNull();
    expect(body.querySelector("iframe")).toBeNull();
    expect(body.querySelector("animate")).toBeNull();
    expect(body.querySelector("p")?.getAttribute("onclick")).toBeNull();
    expect(body.querySelector("a")?.getAttribute("href")).toBeNull();
    expect(body.querySelector("img")?.getAttribute("onerror")).toBeNull();
    expect(body.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AA");
    expect(body.innerHTML).not.toContain("javascript:");

    service.pushModal({ id: "b", title: "B", contentText: "<b>chat</b>" });
    expect(document.querySelector('[data-modal-id="b"] .ui-modal-body')?.textContent).toBe("<b>chat</b>");
    expect(document.querySelector('[data-modal-id="b"] .ui-modal-body b')).toBeNull();

    service.pushModal({ id: "c", title: "C", contentHtml: '<button onclick="go()">x</button>', trustedHtml: true });
    expect(document.querySelector('[data-modal-id="c"] .ui-modal-body button')?.getAttribute("onclick")).toBe("go()");
    service.dispose();
  });

  it("setScreenContent substitui o placeholder de uma tela embutida", () => {
    const { service } = createService();
    expect(service.setScreenContent("pause_menu", { html: "<button data-ui-action='resume'>Voltar</button>" })).toBe(true);
    expect(document.querySelector("#screen-pause_menu .ui-screen-content button")?.textContent).toBe("Voltar");
    expect(service.setScreenContent("game_over", { text: "Você perdeu" })).toBe(true);
    expect(document.querySelector("#screen-game_over .ui-screen-content")?.textContent).toBe("Você perdeu");
    service.dispose();
  });
});

describe("G96 — sem sequestro de [data-action] e ESC por padrão", () => {
  it("padrão: [data-action] do jogo e ESC não disparam nada da engine", () => {
    const { service, sent, emitted } = createService();
    const overlay = document.getElementById("hud-overlay")!;
    overlay.innerHTML = '<button data-action="start-game">Jogo</button>';
    click(overlay.querySelector("button"));
    escape();
    expect(sent).toEqual([]);
    expect(service.currentScreen).toBe("hud");
    expect(emitted.filter(([type]) => type === "game.ui.screen-changed")).toEqual([]);
    service.dispose();
  });

  it("[data-ui-action] desconhecida vira game.ui.action; open-screen e close-modal são tratados", () => {
    const { service, emitted } = createService();
    click(document.querySelector('#screen-main_menu [data-ui-action="start-game"]'));
    expect(emitted).toContainEqual([
      "game.ui.action",
      { action: "start-game", value: null, modalId: null, screen: "hud" },
    ]);
    click(document.querySelector('#screen-main_menu [data-ui-action="open-screen"]'));
    expect(service.currentScreen).toBe("settings");

    service.pushModal({ id: "under", title: "U", depth: 0 });
    service.pushModal({ id: "over", title: "O", depth: 5 });
    click(document.querySelector('[data-modal-id="under"] [data-ui-action="close-modal"]'));
    expect(service.isModalOpen("under")).toBe(false);
    expect(service.isModalOpen("over")).toBe(true);
    service.dispose();
  });

  it("opt-in: legacyDataActions e escapeTogglesPauseMenu restauram o comportamento antigo", async () => {
    const { service, sent } = createService({ legacyDataActions: true, escapeTogglesPauseMenu: true });
    const overlay = document.getElementById("hud-overlay")!;
    overlay.innerHTML = '<button data-action="start-game">Jogo</button>';
    click(overlay.querySelector("button"));
    await Promise.resolve();
    expect(sent[0]?.[0]).toBe("game.world.load-scene");
    escape();
    expect(service.currentScreen).toBe("pause_menu");
    service.dispose();
  });
});

describe("G97 — dicionários do jogo e setLocale sem apagar DOM do jogo", () => {
  it("registra dicionários, preserva chaves desconhecidas e faz fallback por idioma", () => {
    const { service } = createService();
    const overlay = document.getElementById("hud-overlay")!;
    overlay.innerHTML =
      '<span id="own" data-i18n="meujogo.titulo">Trem Fora de Controle</span><span id="reg" data-i18n="hud.speed">x</span><input id="ph" data-i18n="hud.speed" data-i18n-attr="placeholder">';
    service.registerDictionary("pt-BR", { "hud.speed": "Velocidade" });
    service.registerDictionary("en-US", { "hud.speed": "Speed" });
    expect(document.getElementById("reg")?.textContent).toBe("Velocidade");

    expect(service.setLocale("en-GB")).toBe(true);
    expect(document.getElementById("reg")?.textContent).toBe("Speed");
    expect(document.getElementById("ph")?.getAttribute("placeholder")).toBe("Speed");
    expect(document.getElementById("own")?.textContent).toBe("Trem Fora de Controle");
    expect(service.translate("ui.menu.start")).toBe("Start Game");

    expect(service.setLocale("")).toBe(false);
    expect(service.currentLocale).toBe("en-GB");

    service.setLocale("ja-JP");
    expect(service.translate("hud.speed")).toBe("Velocidade"); // fallback pt-BR
    service.setFallbackLocale("en-US");
    expect(service.translate("hud.speed")).toBe("Speed");
    expect(service.getAvailableLocales()).toEqual(expect.arrayContaining(["pt-BR", "en-US"]));
    expect(service.hasTranslation("hud.speed")).toBe(true);
    expect(service.hasTranslation("nada")).toBe(false);
    service.dispose();
  });
});

describe("G98 — pop por id, depth e modal-closed", () => {
  it("popModal(id), ordem por depth e evento modal-closed com motivo", () => {
    const { service, emitted } = createService();
    service.pushModal({ id: "top", title: "T", depth: 10 });
    service.pushModal({ id: "low", title: "L", depth: 1 });
    service.pushModal({ id: "mid", title: "M", depth: 5 });
    const zOf = (id: string): number => Number((document.querySelector(`[data-modal-id="${id}"]`) as HTMLElement).style.zIndex);
    expect(zOf("top")).toBeGreaterThan(zOf("mid"));
    expect(zOf("mid")).toBeGreaterThan(zOf("low"));

    expect(service.popModal("mid")).toBe(true);
    expect(service.isModalOpen("mid")).toBe(false);
    expect(service.popModal("mid")).toBe(false);
    escape(); // fecha o do topo (depth 10)
    expect(service.isModalOpen("top")).toBe(false);
    service.closeAllModals();

    const closed = emitted.filter(([type]) => type === "game.ui.modal-closed").map(([, p]) => p);
    expect(closed).toEqual([
      { modalId: "mid", remaining: 2, reason: "pop" },
      { modalId: "top", remaining: 1, reason: "escape" },
      { modalId: "low", remaining: 0, reason: "pop" },
    ]);
    service.dispose();
  });

  it("o comando game.ui.pop-modal respeita modalId (Kernel real)", async () => {
    let ui: UIApi | undefined;
    let probeCtx: PluginContext | undefined;
    const probe: Plugin = {
      manifest: {
        id: "test.ui-probe",
        name: "probe",
        version: "1.0.0",
        kind: "preloaded",
        permissions: { capabilities: [UIToken.id] },
        capabilities: {
          provides: [],
          consumes: [{ id: UIToken.id, range: "^1.0.0", optional: false }],
          conflicts: [],
        },
        lifecycleHooks: {
          onBoot(ctx): void {
            ui = ctx.caps.require(UIToken);
          },
        },
      },
      setup(ctx): void {
        probeCtx = ctx;
        ctx.lifecycle.ready();
      },
    };
    const kernel = new Kernel();
    kernel.register(createUIPlugin());
    kernel.register(probe);
    await kernel.boot();
    try {
      ui!.pushModal({ id: "a", title: "A" });
      ui!.pushModal({ id: "b", title: "B" });
      await probeCtx!.commands.send("game.ui.pop-modal", { modalId: "a" });
      expect(ui!.isModalOpen("a")).toBe(false);
      expect(ui!.isModalOpen("b")).toBe(true);
    } finally {
      await kernel.stop();
    }
  });
});

describe("G99 — HUD não bloqueia o canvas, binder indexado, máximos < 1", () => {
  it("#screen-hud não captura ponteiro; telas/modais marcam data-input-ignore", () => {
    const { service } = createService();
    expect(document.getElementById("screen-hud")?.style.pointerEvents).toBe("none");
    expect(document.getElementById("screen-pause_menu")?.hasAttribute("data-input-ignore")).toBe(true);
    service.pushModal({ id: "m", title: "M" });
    expect(document.querySelector('[data-modal-id="m"]')?.hasAttribute("data-input-ignore")).toBe(true);
    service.dispose();
  });

  it("updateHUD não varre o DOM a cada chamada e aceita máximos < 1", async () => {
    const { service } = createService();
    const overlay = document.getElementById("hud-overlay")!;
    overlay.innerHTML =
      '<span data-bind="speed"></span><div id="fuel" data-hud-fill="fuel"></div><div id="heat" data-hud-fill="heat" data-hud-max="heatLimit"></div>';
    await Promise.resolve(); // MutationObserver reindexa
    const root = document.getElementById("ui-root")!;
    const spy = vi.spyOn(root, "querySelectorAll");
    for (let index = 0; index < 50; index += 1) {
      service.updateHUD("speed", index);
    }
    service.bindHUDData({ fuel: 0.25, maxFuel: 0.5, heat: 3, heatLimit: 4 });
    expect(spy).not.toHaveBeenCalled();
    expect(overlay.querySelector('[data-bind="speed"]')?.textContent).toBe("49");
    expect((document.getElementById("fuel") as HTMLElement).style.width).toBe("50%");
    expect((document.getElementById("heat") as HTMLElement).style.width).toBe("75%");

    // HUD montado depois: valores em cache são aplicados após a mutação.
    overlay.insertAdjacentHTML("beforeend", '<b id="late" data-bind="speed"></b>');
    await Promise.resolve();
    expect(document.getElementById("late")?.textContent).toBe("49");
    service.dispose();
  });

  it("sem DOM o serviço funciona em modo headless", () => {
    const { service, emitted } = createService({ document: null });
    expect(service.hasDOM).toBe(false);
    service.pushModal({ id: "x", title: "X" });
    expect(service.activeModalCount).toBe(1);
    expect(service.popModal("x")).toBe(true);
    service.openScreen("pause_menu");
    service.updateHUD("hp", 3);
    expect(service.setLocale("en-US")).toBe(true);
    expect(service.setScreenContent("hud", { text: "x" })).toBe(false);
    expect(emitted.map(([type]) => type)).toEqual(
      expect.arrayContaining(["game.ui.modal-pushed", "game.ui.modal-closed", "game.ui.screen-changed", "game.ui.hud-updated"]),
    );
    service.dispose();
  });
});
