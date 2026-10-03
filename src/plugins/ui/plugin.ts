import type {
  Plugin,
  PluginContext,
} from "../../core/contracts/plugin-context";

import {
  UIToken,
  type UIApi,
} from "../../tokens/ui";

import {
  ScreenChangedEvent,
  ModalPushedEvent,
  LocaleChangedEvent,
  HUDUpdatedEvent,
  OpenScreenCommand,
  PushModalCommand,
  PopModalCommand,
  SetLocaleCommand,
  BindHUDValueCommand,
  type UIScreenId,
  type ModalConfig,
  type PlayerHUDData,
  type OpenScreenRequest,
  type PushModalRequest,
  type SetLocaleRequest,
  type BindHUDValueRequest,
} from "../../contracts/ui/types";

import {
  UIManager,
} from "../../engine/ui/UIManager";

import {
  HUDDataBinder,
} from "../../engine/ui/HUDDataBinder";

import {
  LocalizationEngine,
} from "../../engine/ui/LocalizationEngine";

import {
  UITemplateRegistry,
} from "../../engine/ui/UITemplateRegistry";

import {
  DOMEventListenerBridge,
} from "../../engine/ui/DOMEventListenerBridge";

export const uiManifest:
  Plugin["manifest"] = {
    id:
      "game.ui",

    name:
      "Reactive User Interface & HUD Plugin",

    version:
      "1.0.0",

    kind:
      "preloaded",

    authority:
      "game",

    permissions: {
      capabilities: [
        UIToken.id,
      ],

      events: [
        "game.ui.screen-changed",
        "game.ui.modal-pushed",
        "game.ui.locale-changed",
        "game.ui.hud-updated",
      ],
    },

    capabilities: {
      provides: [
        {
          id:
            UIToken.id,

          version:
            "1.0.0",
        },
      ],
    },
  };

export class UIService
  implements UIApi {
  private readonly uiManager:
    UIManager;

  private readonly dataBinder =
    new HUDDataBinder();

  private readonly localization =
    new LocalizationEngine();

  private readonly templates =
    new UITemplateRegistry();

  private readonly domBridge:
    DOMEventListenerBridge;

  private uiRoot:
    HTMLElement | null = null;

  private ownsUIRoot =
    false;

  public constructor(
    private readonly ctx:
      PluginContext,
  ) {
    this.uiManager =
      new UIManager({
        onScreenChanged: (
          currentScreen,
          previousScreen,
        ): void => {
          this.ctx.events.emit(
            "game.ui.screen-changed",
            {
              currentScreen,
              previousScreen,
            },
          );
        },

        onModalPushed: (
          config,
          depth,
        ): void => {
          this.ctx.events.emit(
            "game.ui.modal-pushed",
            {
              modalId:
                config.id,

              depth,
            },
          );
        },
      });

    this.domBridge =
      new DOMEventListenerBridge(
        ctx,
      );

    this.mountDOM();
  }

  public get currentScreen():
    UIScreenId {
    return this.uiManager
      .currentScreen;
  }

  public get activeModalCount():
    number {
    return this.uiManager
      .activeModalCount;
  }

  public get currentLocale():
    string {
    return this.localization
      .currentLocale;
  }

  public openScreen(
    screenId: UIScreenId,
  ): void {
    this.uiManager.openScreen(
      screenId,
    );
  }

  public pushModal(
    config: ModalConfig,
  ): void {
    this.uiManager.pushModal(
      config,
    );
  }

  public popModal():
    boolean {
    return this.uiManager
      .popModal();
  }

  public bindHUDData(
    data:
      Partial<PlayerHUDData>,
  ): void {
    this.dataBinder
      .bindHUDData(
        data,
      );

    this.ctx.events.emit(
      "game.ui.hud-updated",
      {
        data,
      },
    );
  }

  public updateHUD(
    key:
      keyof PlayerHUDData,
    value:
      unknown,
  ): void {
    const changed =
      this.dataBinder
        .updateValue(
          key,
          value,
        );

    if (!changed) {
      return;
    }

    const data = {
      [key]:
        value,
    } as Partial<PlayerHUDData>;

    this.ctx.events.emit(
      "game.ui.hud-updated",
      {
        data,
      },
    );
  }

  public setLocale(
    locale: string,
  ): void {
    this.localization
      .setLocale(
        locale,
      );

    if (this.uiRoot) {
      this.localization
        .updateDOMTranslations(
          this.uiRoot,
        );
    }

    this.ctx.events.emit(
      "game.ui.locale-changed",
      {
        locale:
          this.localization
            .currentLocale,
      },
    );
  }

  public translate(
    key: string,
    params?:
      Record<
        string,
        string | number
      >,
  ): string {
    return this.localization
      .translate(
        key,
        params,
      );
  }

  public registerTemplate(
    templateId: string,
    htmlContent: string,
  ): void {
    this.templates
      .registerTemplate(
        templateId,
        htmlContent,
      );
  }

  public dispose(): void {
    this.domBridge.detach();

    this.dataBinder.detach();

    this.uiManager.unmount();

    const root =
      this.uiRoot;

    if (!root) {
      return;
    }

    if (
      this.ownsUIRoot
    ) {
      root.remove();
    } else {
      /*
       * index.html é proprietário
       * do #ui-root.
       *
       * O plugin apenas limpa o conteúdo
       * que montou dentro dele.
       */
      root.replaceChildren();

      root.classList.remove(
        "ui-root-container",
      );
    }

    this.uiRoot = null;
    this.ownsUIRoot = false;
  }

  private mountDOM(): void {
    const existingRoot =
      document.getElementById(
        "ui-root",
      );

    if (existingRoot) {
      this.uiRoot =
        existingRoot;

      this.ownsUIRoot =
        false;
    } else {
      const createdRoot =
        document.createElement(
          "div",
        );

      createdRoot.id =
        "ui-root";

      document.body.appendChild(
        createdRoot,
      );

      this.uiRoot =
        createdRoot;

      this.ownsUIRoot =
        true;
    }

    const root =
      this.uiRoot;

    root.innerHTML = `
      <div
        id="screen-main_menu"
        class="ui-screen"
        aria-hidden="true"
      >
        <div class="ui-modal-backdrop">
          <div class="ui-modal-container">
            <h1>Projeto 1</h1>

            <button
              type="button"
              data-action="start-game"
              data-i18n="ui.menu.start"
            >
              Iniciar Jogo
            </button>

            <button
              type="button"
              data-action="open-settings"
              data-i18n="ui.menu.settings"
            >
              Configurações
            </button>
          </div>
        </div>
      </div>

      <div
        id="screen-hud"
        class="ui-screen active"
        aria-hidden="false"
      >
        <div class="hud-overlay">
          <div class="hud-top-left">
            <div class="hud-bar-wrapper">
              <span
                class="hud-bar-label"
                data-i18n="ui.hud.hp"
              >
                VIDA
              </span>

              <div class="hud-bar-container">
                <div
                  id="hud-hp-bar"
                  class="hud-bar-fill-hp"
                ></div>
              </div>

              <span data-bind="hp">100</span>
              /
              <span data-bind="maxHp">100</span>
            </div>

            <div class="hud-bar-wrapper">
              <span
                class="hud-bar-label"
                data-i18n="ui.hud.mp"
              >
                MANA
              </span>

              <div class="hud-bar-container">
                <div
                  id="hud-mp-bar"
                  class="hud-bar-fill-mp"
                ></div>
              </div>

              <span data-bind="mp">50</span>
              /
              <span data-bind="maxMp">50</span>
            </div>
          </div>

          <div class="hud-stat-badge">
            <span data-i18n="ui.hud.ammo">
              MUNIÇÃO
            </span>
            :
            <span data-bind="ammo">30</span>
            /
            <span data-bind="maxAmmo">120</span>
          </div>
        </div>
      </div>

      <div
        id="screen-inventory"
        class="ui-screen"
        aria-hidden="true"
      >
        <div class="ui-modal-backdrop">
          <div class="ui-modal-container">
            <h2 data-i18n="ui.screen.inventory">
              INVENTÁRIO
            </h2>
          </div>
        </div>
      </div>

      <div
        id="screen-settings"
        class="ui-screen"
        aria-hidden="true"
      >
        <div class="ui-modal-backdrop">
          <div class="ui-modal-container">
            <h2 data-i18n="ui.screen.settings">
              CONFIGURAÇÕES
            </h2>
          </div>
        </div>
      </div>

      <div
        id="screen-dialogue"
        class="ui-screen"
        aria-hidden="true"
      >
        <div class="ui-modal-backdrop">
          <div class="ui-modal-container">
            <h2 data-i18n="ui.screen.dialogue">
              DIÁLOGO
            </h2>
          </div>
        </div>
      </div>

      <div
        id="screen-game_over"
        class="ui-screen"
        aria-hidden="true"
      >
        <div class="ui-modal-backdrop">
          <div class="ui-modal-container">
            <h2 data-i18n="ui.screen.gameOver">
              FIM DE JOGO
            </h2>
          </div>
        </div>
      </div>

      <div
        id="screen-pause_menu"
        class="ui-screen"
        aria-hidden="true"
      >
        <div class="ui-modal-backdrop">
          <div class="ui-modal-container">
            <h2 data-i18n="ui.screen.pause">
              PAUSA
            </h2>
          </div>
        </div>
      </div>
    `;

    this.uiManager.mount(
      root,
    );

    this.dataBinder.attach(
      root,
    );

    this.domBridge.attach(
      root,
    );

    this.localization
      .updateDOMTranslations(
        root,
      );
  }
}

export function createUIPlugin():
  Plugin {
  return {
    manifest:
      uiManifest,

    setup(
      ctx: PluginContext,
    ): void {
      const uiService =
        new UIService(
          ctx,
        );

      ctx.caps.provide(
        UIToken,
        uiService,
      );

      ctx.events.define(
        ScreenChangedEvent,
      );

      ctx.events.define(
        ModalPushedEvent,
      );

      ctx.events.define(
        LocaleChangedEvent,
      );

      ctx.events.define(
        HUDUpdatedEvent,
      );

      ctx.commands.define(
        OpenScreenCommand,
      );

      ctx.commands.define(
        PushModalCommand,
      );

      ctx.commands.define(
        PopModalCommand,
      );

      ctx.commands.define(
        SetLocaleCommand,
      );

      ctx.commands.define(
        BindHUDValueCommand,
      );

      const unbindOpen =
        ctx.commands.handle(
          "game.ui.open-screen",
          (
            envelope,
          ) => {
            const payload =
              envelope.payload as
                OpenScreenRequest;

            uiService.openScreen(
              payload.screenId,
            );
          },
        );

      const unbindPush =
        ctx.commands.handle(
          "game.ui.push-modal",
          (
            envelope,
          ) => {
            const payload =
              envelope.payload as
                PushModalRequest;

            uiService.pushModal(
              payload.config,
            );
          },
        );

      const unbindPop =
        ctx.commands.handle(
          "game.ui.pop-modal",
          () => {
            return uiService
              .popModal();
          },
        );

      const unbindLocale =
        ctx.commands.handle(
          "game.ui.set-locale",
          (
            envelope,
          ) => {
            const payload =
              envelope.payload as
                SetLocaleRequest;

            uiService.setLocale(
              payload.locale,
            );
          },
        );

      const unbindBind =
        ctx.commands.handle(
          "game.ui.bind-hud-value",
          (
            envelope,
          ) => {
            const payload =
              envelope.payload as
                BindHUDValueRequest;

            uiService.updateHUD(
              payload.key,
              payload.value,
            );
          },
        );

      ctx.lifecycle.onDispose(
        (): void => {
          unbindOpen();
          unbindPush();
          unbindPop();
          unbindLocale();
          unbindBind();

          uiService.dispose();
        },
      );

      ctx.lifecycle.ready();
    },
  };
}