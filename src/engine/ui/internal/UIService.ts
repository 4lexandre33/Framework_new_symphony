import type { PluginContext } from "@core";
import { type UIApi } from "../../../tokens/ui";
import type {
  HUDData,
  LocaleDictionary,
  ModalConfig,
  ScreenContent,
  UIPluginBehaviorOptions,
  UIScreenId,
} from "../../../contracts/ui/types";
import { UIManager } from "./UIManager";
import { HUDDataBinder } from "./HUDDataBinder";
import { LocalizationEngine } from "./LocalizationEngine";
import { UITemplateRegistry } from "./UITemplateRegistry";
import { DOMEventListenerBridge } from "./DOMEventListenerBridge";
import { escapeHtml, sanitizeHtmlToFragment } from "./HtmlSanitizer";

export interface UIServiceOptions extends UIPluginBehaviorOptions {
  /** Documento a usar; `null` força o modo sem DOM. Padrão: `document` global se existir. */
  readonly document?: Document | null;
}

/** Telas embutidas (placeholders) e onde fica o conteúdo substituível de cada uma. */
const BUILTIN_SCREENS: ReadonlyArray<readonly [UIScreenId, string]> = [
  ["inventory", "ui.screen.inventory"],
  ["settings", "ui.screen.settings"],
  ["dialogue", "ui.screen.dialogue"],
  ["game_over", "ui.screen.gameOver"],
  ["pause_menu", "ui.screen.pause"],
];

export class UIService implements UIApi {
  private readonly uiManager: UIManager;
  private readonly dataBinder = new HUDDataBinder();
  private readonly localization = new LocalizationEngine();
  private readonly templates = new UITemplateRegistry();
  private readonly domBridge: DOMEventListenerBridge;
  private readonly doc: Document | null;
  private uiRoot: HTMLElement | null = null;
  private ownsUIRoot = false;
  private disposed = false;

  public constructor(
    private readonly ctx: PluginContext,
    options: UIServiceOptions = {},
  ) {
    this.doc =
      options.document !== undefined
        ? options.document
        : typeof document === "undefined"
          ? null
          : document;

    this.uiManager = new UIManager(
      {
        onScreenChanged: (currentScreen, previousScreen): void => {
          this.ctx.events.emit("game.ui.screen-changed", { currentScreen, previousScreen });
        },
        onModalPushed: (config, depth): void => {
          this.ctx.events.emit("game.ui.modal-pushed", { modalId: config.id, depth });
        },
        onModalClosed: (config, remaining, reason): void => {
          this.ctx.events.emit("game.ui.modal-closed", { modalId: config.id, remaining, reason });
        },
        renderModalBody: (config, body): void => {
          this.renderModalBody(config, body);
        },
        closeLabel: (): string => this.localization.translate("ui.modal.close"),
      },
      {
        // G96: por padrão a engine NÃO captura ESC para o menu de pausa.
        escapeTogglesPauseMenu: options.escapeTogglesPauseMenu ?? false,
        escapeClosesModals: options.escapeClosesModals ?? true,
      },
    );

    this.domBridge = new DOMEventListenerBridge(
      ctx,
      {
        closeModal: (modalId): void => {
          this.uiManager.popModal(modalId ?? undefined, "close-button");
        },
        openScreen: (screenId): void => {
          this.openScreen(screenId);
        },
        emitAction: (action, value, modalId): void => {
          this.ctx.events.emit("game.ui.action", {
            action,
            value,
            modalId,
            screen: this.uiManager.currentScreen,
          });
        },
      },
      { legacyDataActions: options.legacyDataActions ?? false },
    );

    if (this.doc !== null) {
      this.mountDOM(this.doc);
    }
  }

  public get currentScreen(): UIScreenId {
    return this.uiManager.currentScreen;
  }

  public get activeModalCount(): number {
    return this.uiManager.activeModalCount;
  }

  public get currentLocale(): string {
    return this.localization.currentLocale;
  }

  public get hasDOM(): boolean {
    return this.uiRoot !== null;
  }

  public openScreen(screenId: UIScreenId): void {
    if (this.disposed) {
      return;
    }

    this.uiManager.openScreen(screenId);
  }

  public pushModal(config: ModalConfig): void {
    if (this.disposed) {
      return;
    }

    this.uiManager.pushModal(config);
  }

  public popModal(modalId?: string): boolean {
    if (this.disposed) {
      return false;
    }

    return this.uiManager.popModal(modalId);
  }

  public isModalOpen(modalId: string): boolean {
    return this.uiManager.isModalOpen(modalId);
  }

  public closeAllModals(): void {
    if (this.disposed) {
      return;
    }

    this.uiManager.closeAllModals();
  }

  public bindHUDData(data: HUDData): void {
    if (this.disposed) {
      return;
    }

    this.dataBinder.bindHUDData(data);
    this.ctx.events.emit("game.ui.hud-updated", { data });
  }

  public updateHUD(key: string, value: unknown): void {
    if (this.disposed) {
      return;
    }

    const changed = this.dataBinder.updateValue(key, value);

    if (!changed) {
      return;
    }

    // Só aloca quando o valor muda (o evento é entregue por referência).
    const data = { [key]: value } as HUDData;
    this.ctx.events.emit("game.ui.hud-updated", { data });
  }

  public refreshHUDBindings(): void {
    if (this.disposed) {
      return;
    }

    this.dataBinder.refresh();
  }

  public setLocale(locale: string): boolean {
    if (this.disposed) {
      return false;
    }

    if (!this.localization.setLocale(locale)) {
      return false;
    }

    if (this.uiRoot) {
      this.localization.updateDOMTranslations(this.uiRoot);
    }

    this.ctx.events.emit("game.ui.locale-changed", { locale: this.localization.currentLocale });
    return true;
  }

  public translate(key: string, params?: Record<string, string | number>): string {
    return this.localization.translate(key, params);
  }

  public registerDictionary(locale: string, dictionary: LocaleDictionary): void {
    if (this.disposed) {
      return;
    }

    this.localization.registerDictionary(locale, dictionary);

    if (this.uiRoot) {
      this.localization.updateDOMTranslations(this.uiRoot);
    }
  }

  public setFallbackLocale(locale: string): void {
    this.localization.setFallbackLocale(locale);
  }

  public getAvailableLocales(): string[] {
    return this.localization.getAvailableLocales();
  }

  public hasTranslation(key: string): boolean {
    return this.localization.hasTranslation(key);
  }

  public registerTemplate(templateId: string, htmlContent: string): void {
    if (this.disposed) {
      return;
    }

    this.templates.registerTemplate(templateId, htmlContent);
  }

  public renderTemplate(templateId: string, data?: Readonly<Record<string, string | number>>): string {
    return this.templates.instantiateSafe(templateId, data, escapeHtml) ?? "";
  }

  public setScreenContent(screenId: UIScreenId, content: ScreenContent): boolean {
    if (this.disposed || this.uiRoot === null) {
      return false;
    }

    const screen = this.uiRoot.querySelector<HTMLElement>(`#screen-${screenId}`);

    if (screen === null) {
      return false;
    }

    const target =
      screenId === "hud"
        ? screen.querySelector<HTMLElement>("#hud-overlay")
        : screen.querySelector<HTMLElement>(".ui-screen-content");

    if (target === null) {
      return false;
    }

    this.renderContent(target, content.templateId, content.templateData, content.text, content.html, content.trustedHtml);
    this.localization.updateDOMTranslations(target);
    return true;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.domBridge.detach();
    this.dataBinder.detach();
    this.uiManager.unmount();
    const root = this.uiRoot;

    if (!root) {
      return;
    }

    if (this.ownsUIRoot) {
      root.remove();
    } else {
      // index.html é proprietário do #ui-root: o plugin apenas limpa o
      // conteúdo que montou dentro dele.
      root.replaceChildren();
      root.classList.remove("ui-root-container");
    }

    this.uiRoot = null;
    this.ownsUIRoot = false;
  }

  private renderModalBody(config: ModalConfig, body: HTMLElement): void {
    this.renderContent(
      body,
      config.templateId,
      config.templateData,
      config.contentText,
      config.contentHtml,
      config.trustedHtml,
    );
  }

  /**
   * Prioridade: template registrado → texto → HTML (sanitizado salvo
   * `trustedHtml`). Template desconhecido cai para texto/HTML com aviso.
   */
  private renderContent(
    target: HTMLElement,
    templateId: string | undefined,
    templateData: Readonly<Record<string, string | number>> | undefined,
    text: string | undefined,
    html: string | undefined,
    trustedHtml: boolean | undefined,
  ): void {
    const doc = target.ownerDocument;

    if (templateId !== undefined) {
      const rendered = this.templates.instantiateSafe(templateId, templateData, escapeHtml);

      if (rendered !== null) {
        target.innerHTML = rendered;
        return;
      }

      console.warn(`[UIService] Template '${templateId}' não registrado.`);
    }

    if (text !== undefined) {
      target.textContent = text;
      return;
    }

    if (html !== undefined) {
      if (trustedHtml === true) {
        target.innerHTML = html;
      } else {
        target.replaceChildren(sanitizeHtmlToFragment(html, doc));
      }

      return;
    }

    target.replaceChildren();
  }

  private mountDOM(doc: Document): void {
    const existingRoot = doc.getElementById("ui-root");

    if (existingRoot) {
      this.uiRoot = existingRoot;
      this.ownsUIRoot = false;
    } else {
      const createdRoot = doc.createElement("div");
      createdRoot.id = "ui-root";
      doc.body.appendChild(createdRoot);
      this.uiRoot = createdRoot;
      this.ownsUIRoot = true;
    }

    const root = this.uiRoot;
    // Telas não-HUD bloqueiam cliques do jogo (data-input-ignore, G51/G99);
    // o HUD NÃO captura ponteiro: cliques atravessam até o canvas.
    const placeholders = BUILTIN_SCREENS.map(
      ([screenId, titleKey]) => `
  <div id="screen-${screenId}" class="ui-screen" aria-hidden="true" data-input-ignore>
    <div class="ui-modal-backdrop">
      <div class="ui-modal-container">
        <h2 data-i18n="${titleKey}"></h2>
        <div class="ui-screen-content"></div>
      </div>
    </div>
  </div>`,
    ).join("");

    root.innerHTML = `
  <div id="screen-main_menu" class="ui-screen" aria-hidden="true" data-input-ignore>
    <div class="ui-modal-backdrop">
      <div class="ui-modal-container">
        <h1 data-i18n="ui.menu.title"></h1>
        <div class="ui-screen-content">
          <button type="button" data-ui-action="start-game" data-i18n="ui.menu.start"></button>
          <button type="button" data-ui-action="open-screen" data-ui-value="settings" data-i18n="ui.menu.settings"></button>
        </div>
      </div>
    </div>
  </div>
  <div id="screen-hud" class="ui-screen active" aria-hidden="false" style="pointer-events: none;">
    <!-- Contêiner genérico: o HUD é montado pelo projeto (ver src/projects). -->
    <div id="hud-overlay" class="hud-overlay" style="pointer-events: none;"></div>
  </div>${placeholders}
`;
    this.uiManager.mount(root);
    this.dataBinder.attach(root);
    this.domBridge.attach(root);
    this.localization.updateDOMTranslations(root);
  }
}
