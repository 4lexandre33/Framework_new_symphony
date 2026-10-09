import type { PluginContext } from "@core";
import { type UIApi } from "../../../tokens/ui";
import { type UIScreenId, type ModalConfig, type HUDData } from "../../../contracts/ui/types";
import { UIManager } from "./UIManager";
import { HUDDataBinder } from "./HUDDataBinder";
import { LocalizationEngine } from "./LocalizationEngine";
import { UITemplateRegistry } from "./UITemplateRegistry";
import { DOMEventListenerBridge } from "./DOMEventListenerBridge";

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

  private disposed =
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
    if (this.disposed) {
      return;
    }

    this.uiManager.openScreen(
      screenId,
    );
  }

  public pushModal(
    config: ModalConfig,
  ): void {
    if (this.disposed) {
      return;
    }

    this.uiManager.pushModal(
      config,
    );
  }

  public popModal():
    boolean {
    if (this.disposed) {
      return false;
    }

    return this.uiManager
      .popModal();
  }

  public bindHUDData(
    data:
      HUDData,
  ): void {
    if (this.disposed) {
      return;
    }

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
    key: string,
    value:
      unknown,
  ): void {
    if (this.disposed) {
      return;
    }

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
    } as HUDData;

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
    if (this.disposed) {
      return;
    }

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
    if (this.disposed) {
      return;
    }

    this.templates
      .registerTemplate(
        templateId,
        htmlContent,
      );
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed =
      true;

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
        <!-- Contêiner genérico: o HUD é montado pelo projeto (ver src/projects). -->
        <div id="hud-overlay" class="hud-overlay"></div>
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