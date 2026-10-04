// @vitest-environment jsdom

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  UIManager,
  type UIManagerHooks,
} from "../src/engine/ui/internal/UIManager";

import {
  HUDDataBinder,
} from "../src/engine/ui/internal/HUDDataBinder";

import {
  LocalizationEngine,
} from "../src/engine/ui/internal/LocalizationEngine";

import {
  UITemplateRegistry,
} from "../src/engine/ui/internal/UITemplateRegistry";

describe(
  "Camada de Interface de Usuário & HUD (game.ui)",
  (): void => {
    let uiManager:
      UIManager;

    let dataBinder:
      HUDDataBinder;

    let localization:
      LocalizationEngine;

    let templates:
      UITemplateRegistry;

    beforeEach(
      (): void => {
        document.body.innerHTML =
          "";

        uiManager =
          new UIManager();

        dataBinder =
          new HUDDataBinder();

        localization =
          new LocalizationEngine();

        templates =
          new UITemplateRegistry();
      },
    );

    afterEach(
      (): void => {
        uiManager.unmount();

        dataBinder.detach();

        document.body.innerHTML =
          "";

        vi.restoreAllMocks();
      },
    );

    it(
      "deve gerenciar navegação entre telas e manter somente a tela ativa visível",
      (): void => {
        const root =
          document.createElement(
            "div",
          );

        root.innerHTML = `
          <div
            id="screen-hud"
            class="ui-screen active"
          ></div>

          <div
            id="screen-settings"
            class="ui-screen"
          ></div>

          <div
            id="screen-pause_menu"
            class="ui-screen"
          ></div>
        `;

        document.body.appendChild(
          root,
        );

        uiManager.mount(
          root,
        );

        expect(
          uiManager.currentScreen,
        ).toBe(
          "hud",
        );

        expect(
          root
            .querySelector(
              "#screen-hud",
            )
            ?.classList.contains(
              "active",
            ),
        ).toBe(
          true,
        );

        uiManager.openScreen(
          "settings",
        );

        expect(
          uiManager.currentScreen,
        ).toBe(
          "settings",
        );

        expect(
          root
            .querySelector(
              "#screen-hud",
            )
            ?.classList.contains(
              "active",
            ),
        ).toBe(
          false,
        );

        expect(
          root
            .querySelector(
              "#screen-settings",
            )
            ?.classList.contains(
              "active",
            ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "deve gerenciar a pilha de modais sem remover mais de um modal por operação",
      (): void => {
        const root =
          document.createElement(
            "div",
          );

        document.body.appendChild(
          root,
        );

        uiManager.mount(
          root,
        );

        const firstPush =
          uiManager.pushModal({
            id:
              "modal_1",

            title:
              "Opções de Áudio",
          });

        const secondPush =
          uiManager.pushModal({
            id:
              "modal_2",

            title:
              "Opções de Vídeo",
          });

        expect(
          firstPush,
        ).toBe(
          true,
        );

        expect(
          secondPush,
        ).toBe(
          true,
        );

        expect(
          uiManager
            .activeModalCount,
        ).toBe(
          2,
        );

        expect(
          root.querySelectorAll(
            ".ui-modal-backdrop",
          ),
        ).toHaveLength(
          2,
        );

        const popped =
          uiManager.popModal();

        expect(
          popped,
        ).toBe(
          true,
        );

        expect(
          uiManager
            .activeModalCount,
        ).toBe(
          1,
        );

        expect(
          root.querySelectorAll(
            ".ui-modal-backdrop",
          ),
        ).toHaveLength(
          1,
        );

        expect(
          uiManager.popModal(),
        ).toBe(
          true,
        );

        expect(
          uiManager.popModal(),
        ).toBe(
          false,
        );

        expect(
          uiManager
            .activeModalCount,
        ).toBe(
          0,
        );
      },
    );

    it(
      "deve publicar mudança de tela também quando Escape alterna HUD e pause menu",
      (): void => {
        const onScreenChanged =
          vi.fn();

        const hooks:
          UIManagerHooks = {
            onScreenChanged,
          };

        uiManager =
          new UIManager(
            hooks,
          );

        const root =
          document.createElement(
            "div",
          );

        root.innerHTML = `
          <div
            id="screen-hud"
            class="ui-screen active"
          ></div>

          <div
            id="screen-pause_menu"
            class="ui-screen"
          ></div>
        `;

        document.body.appendChild(
          root,
        );

        uiManager.mount(
          root,
        );

        window.dispatchEvent(
          new KeyboardEvent(
            "keydown",
            {
              key:
                "Escape",
            },
          ),
        );

        expect(
          uiManager.currentScreen,
        ).toBe(
          "pause_menu",
        );

        expect(
          onScreenChanged,
        ).toHaveBeenLastCalledWith(
          "pause_menu",
          "hud",
        );

        window.dispatchEvent(
          new KeyboardEvent(
            "keydown",
            {
              key:
                "Escape",
            },
          ),
        );

        expect(
          uiManager.currentScreen,
        ).toBe(
          "hud",
        );

        expect(
          onScreenChanged,
        ).toHaveBeenLastCalledWith(
          "hud",
          "pause_menu",
        );
      },
    );

    it(
      "deve vincular dados do HUD, atualizar DOM e recalcular a barra de vida",
      (): void => {
        const root =
          document.createElement(
            "div",
          );

        root.innerHTML = `
          <span data-bind="hp">0</span>
          <span data-bind="maxHp">0</span>

          <div
            id="hud-hp-bar"
          ></div>
        `;

        document.body.appendChild(
          root,
        );

        dataBinder.attach(
          root,
        );

        dataBinder.bindHUDData({
          hp: 80,
          maxHp: 100,
        });

        const snapshot =
          dataBinder
            .getSnapshot();

        expect(
          snapshot.hp,
        ).toBe(
          80,
        );

        expect(
          snapshot.maxHp,
        ).toBe(
          100,
        );

        expect(
          root.querySelector(
            '[data-bind="hp"]',
          )?.textContent,
        ).toBe(
          "80",
        );

        expect(
          root.querySelector(
            '[data-bind="maxHp"]',
          )?.textContent,
        ).toBe(
          "100",
        );

        const hpBar =
          root.querySelector<HTMLElement>(
            "#hud-hp-bar",
          );

        expect(
          hpBar?.style.width,
        ).toBe(
          "80%",
        );
      },
    );

    it(
      "deve limitar a porcentagem visual do HUD entre zero e cem",
      (): void => {
        const root =
          document.createElement(
            "div",
          );

        root.innerHTML = `
          <div id="hud-hp-bar"></div>
          <div id="hud-mp-bar"></div>
        `;

        document.body.appendChild(
          root,
        );

        dataBinder.attach(
          root,
        );

        dataBinder.bindHUDData({
          hp: 250,
          maxHp: 100,

          mp: -10,
          maxMp: 100,
        });

        const hpBar =
          root.querySelector<HTMLElement>(
            "#hud-hp-bar",
          );

        const mpBar =
          root.querySelector<HTMLElement>(
            "#hud-mp-bar",
          );

        expect(
          hpBar?.style.width,
        ).toBe(
          "100%",
        );

        expect(
          mpBar?.style.width,
        ).toBe(
          "0%",
        );
      },
    );

    it(
      "deve rejeitar atualização de HUD com tipo incompatível",
      (): void => {
        const before =
          dataBinder
            .getSnapshot();

        const changed =
          dataBinder
            .updateValue(
              "hp",
              "oitenta",
            );

        const after =
          dataBinder
            .getSnapshot();

        expect(
          changed,
        ).toBe(
          false,
        );

        expect(
          after.hp,
        ).toBe(
          before.hp,
        );
      },
    );

    it(
      "deve traduzir chaves e interpolar variáveis dinâmicas",
      (): void => {
        localization.setLocale(
          "pt-BR",
        );

        expect(
          localization.translate(
            "ui.hud.hp",
          ),
        ).toBe(
          "VIDA",
        );

        const welcome =
          localization.translate(
            "ui.welcome",
            {
              name:
                "Alexandre",
            },
          );

        expect(
          welcome,
        ).toBe(
          "Bem-vindo, Alexandre!",
        );

        localization.setLocale(
          "en-US",
        );

        expect(
          localization.translate(
            "ui.hud.hp",
          ),
        ).toBe(
          "HEALTH",
        );
      },
    );

    it(
      "deve atualizar traduções diretamente no DOM",
      (): void => {
        const root =
          document.createElement(
            "div",
          );

        root.innerHTML = `
          <span
            data-i18n="ui.hud.hp"
          ></span>

          <span
            data-i18n="ui.hud.ammo"
          ></span>
        `;

        localization.setLocale(
          "pt-BR",
        );

        localization
          .updateDOMTranslations(
            root,
          );

        expect(
          root
            .querySelector(
              '[data-i18n="ui.hud.hp"]',
            )
            ?.textContent,
        ).toBe(
          "VIDA",
        );

        expect(
          root
            .querySelector(
              '[data-i18n="ui.hud.ammo"]',
            )
            ?.textContent,
        ).toBe(
          "MUNIÇÃO",
        );
      },
    );

    it(
      "deve instanciar templates HTML com múltiplas substituições",
      (): void => {
        templates.registerTemplate(
          "card",
          "<div class='item'>{{title}} - {{title}} - x{{quantity}}</div>",
        );

        const html =
          templates.instantiate(
            "card",
            {
              title:
                "Espada Mágica",

              quantity:
                2,
            },
          );

        expect(
          html,
        ).toBe(
          "<div class='item'>Espada Mágica - Espada Mágica - x2</div>",
        );
      },
    );

    it(
      "deve retornar marcador previsível quando um template não existir",
      (): void => {
        expect(
          templates.instantiate(
            "nao_existe",
          ),
        ).toBe(
          "<!-- Template 'nao_existe' não encontrado -->",
        );
      },
    );
  },
);