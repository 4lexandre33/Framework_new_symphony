import type {
  ModalCloseReason,
  ModalConfig,
  UIScreenId,
} from "../../../contracts/ui/types";

interface ModalStackEntry {
  readonly config: ModalConfig;
  readonly depth: number;
  readonly order: number;
  readonly element: HTMLDivElement | null;
  readonly previousFocus: HTMLElement | null;
}

export interface UIManagerHooks {
  readonly onScreenChanged?: (currentScreen: UIScreenId, previousScreen: UIScreenId) => void;
  readonly onModalPushed?: (config: ModalConfig, depth: number) => void;
  /** `depth` = modais restantes (compatível com a assinatura antiga). */
  readonly onModalPopped?: (config: ModalConfig, depth: number) => void;
  readonly onModalClosed?: (config: ModalConfig, remaining: number, reason: ModalCloseReason) => void;
  /** Monta o corpo do modal (template/texto/HTML sanitizado). */
  readonly renderModalBody?: (config: ModalConfig, body: HTMLElement) => void;
  /** Texto do botão de fechar (localização). */
  readonly closeLabel?: () => string;
}

export interface UIManagerOptions {
  /** ESC alterna hud ⇄ pause_menu (padrão true aqui; o plugin usa false). */
  readonly escapeTogglesPauseMenu?: boolean;
  /** ESC fecha o modal do topo (padrão true). */
  readonly escapeClosesModals?: boolean;
}

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const MODAL_BASE_Z = 2000;

function sanitizeDepth(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : 0;
}

export class UIManager {
  private activeScreen: UIScreenId = "hud";
  private readonly modalStack: ModalStackEntry[] = [];
  private rootElement: HTMLElement | null = null;
  private readonly hooks: UIManagerHooks;
  private escapeTogglesPauseMenu: boolean;
  private escapeClosesModals: boolean;
  private keyListenerInstalled = false;
  private nextOrder = 1;

  public constructor(hooks: UIManagerHooks = {}, options: UIManagerOptions = {}) {
    this.hooks = hooks;
    this.escapeTogglesPauseMenu = options.escapeTogglesPauseMenu ?? true;
    this.escapeClosesModals = options.escapeClosesModals ?? true;
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  public get currentScreen(): UIScreenId {
    return this.activeScreen;
  }

  public get activeModalCount(): number {
    return this.modalStack.length;
  }

  public get isMounted(): boolean {
    return this.rootElement !== null;
  }

  public get topModalId(): string | null {
    return this.modalStack[this.modalStack.length - 1]?.config.id ?? null;
  }

  public setOptions(options: UIManagerOptions): void {
    if (options.escapeTogglesPauseMenu !== undefined) {
      this.escapeTogglesPauseMenu = options.escapeTogglesPauseMenu;
    }

    if (options.escapeClosesModals !== undefined) {
      this.escapeClosesModals = options.escapeClosesModals;
    }

    this.syncKeyListener();
  }

  public mount(container: HTMLElement): void {
    if (this.rootElement === container) {
      this.syncScreenVisibility();
      return;
    }

    this.unmount();
    this.rootElement = container;
    container.classList.add("ui-root-container");
    this.syncKeyListener();
    this.syncScreenVisibility();
  }

  public unmount(): void {
    this.removeKeyListener();

    while (this.modalStack.length > 0) {
      const entry = this.modalStack.pop();

      if (entry !== undefined) {
        entry.element?.remove();
        this.hooks.onModalClosed?.(entry.config, this.modalStack.length, "unmount");
      }
    }

    this.rootElement?.classList.remove("ui-root-container");
    this.rootElement = null;
    this.activeScreen = "hud";
  }

  public openScreen(screenId: UIScreenId): void {
    const previousScreen = this.activeScreen;

    if (previousScreen === screenId) {
      this.syncScreenVisibility();
      return;
    }

    this.activeScreen = screenId;
    this.syncScreenVisibility();
    this.hooks.onScreenChanged?.(screenId, previousScreen);
  }

  /**
   * Abre o modal. Sem DOM montado (headless) o modal é mantido só como
   * estado. `depth` maior fica por cima; empate → o mais recente.
   */
  public pushModal(config: ModalConfig): boolean {
    const normalizedId = typeof config.id === "string" ? config.id.trim() : "";

    if (normalizedId.length === 0) {
      return false;
    }

    const existingIndex = this.findModalIndex(normalizedId);

    if (existingIndex >= 0) {
      this.removeModalAt(existingIndex, false, "replaced");
    }

    const depth = sanitizeDepth(config.depth);
    const normalizedConfig: ModalConfig = { ...config, id: normalizedId };
    const root = this.rootElement;
    let element: HTMLDivElement | null = null;
    let container: HTMLElement | null = null;
    const previousFocus =
      typeof document !== "undefined" && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    if (root !== null) {
      element = this.buildModalElement(normalizedConfig);
      container = element.querySelector<HTMLElement>(".ui-modal-container");
    }

    const entry: ModalStackEntry = {
      config: normalizedConfig,
      depth,
      order: this.nextOrder,
      element,
      previousFocus,
    };

    this.nextOrder += 1;
    let insertAt = this.modalStack.length;

    while (insertAt > 0) {
      const below = this.modalStack[insertAt - 1];

      if (below === undefined || below.depth <= depth) {
        break;
      }

      insertAt -= 1;
    }

    this.modalStack.splice(insertAt, 0, entry);

    if (root !== null && element !== null) {
      root.appendChild(element);
      this.syncModalLayers();

      if (insertAt === this.modalStack.length - 1 && container !== null) {
        this.focusModal(container);
      }
    }

    this.hooks.onModalPushed?.(entry.config, this.modalStack.length);
    return true;
  }

  /** Fecha `modalId` (ou o do topo). */
  public popModal(modalId?: string, reason: ModalCloseReason = "pop"): boolean {
    if (this.modalStack.length === 0) {
      return false;
    }

    if (modalId === undefined) {
      return this.removeModalAt(this.modalStack.length - 1, true, reason);
    }

    return this.removeModalAt(this.findModalIndex(modalId.trim()), true, reason);
  }

  public isModalOpen(modalId: string): boolean {
    return this.findModalIndex(modalId) >= 0;
  }

  public closeAllModals(reason: ModalCloseReason = "pop"): void {
    while (this.modalStack.length > 0) {
      this.removeModalAt(this.modalStack.length - 1, this.modalStack.length === 1, reason);
    }
  }

  private buildModalElement(config: ModalConfig): HTMLDivElement {
    const backdrop = document.createElement("div");
    backdrop.className = "ui-modal-backdrop";
    backdrop.dataset.modalId = config.id;
    // Cliques em modais/menus não viram ações de jogo (game.input, G51).
    backdrop.setAttribute("data-input-ignore", "");

    const container = document.createElement("div");
    container.className = "ui-modal-container";
    container.setAttribute("role", "dialog");
    container.setAttribute("aria-modal", "true");
    container.setAttribute("aria-label", config.title);
    container.tabIndex = -1;

    const header = document.createElement("div");
    header.className = "ui-modal-header";
    const title = document.createElement("div");
    title.className = "ui-modal-title";
    title.textContent = config.title;
    header.appendChild(title);

    if (config.closable !== false) {
      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "ui-modal-close-btn";
      closeButton.setAttribute("data-ui-action", "close-modal");
      closeButton.setAttribute("aria-label", this.hooks.closeLabel?.() ?? "Fechar");
      closeButton.textContent = "×";
      header.appendChild(closeButton);
    }

    const body = document.createElement("div");
    body.className = "ui-modal-body";

    if (this.hooks.renderModalBody !== undefined) {
      this.hooks.renderModalBody(config, body);
    } else if (config.contentText !== undefined) {
      body.textContent = config.contentText;
    } else if (config.contentHtml !== undefined) {
      body.innerHTML = config.contentHtml;
    }

    container.appendChild(header);
    container.appendChild(body);
    backdrop.appendChild(container);
    return backdrop;
  }

  private syncModalLayers(): void {
    for (let index = 0; index < this.modalStack.length; index += 1) {
      const entry = this.modalStack[index];

      if (entry?.element) {
        entry.element.style.zIndex = String(MODAL_BASE_Z + index * 10);
        entry.element.dataset.modalDepth = String(entry.depth);
      }
    }
  }

  private syncScreenVisibility(): void {
    const root = this.rootElement;

    if (root === null) {
      return;
    }

    const screens = root.querySelectorAll<HTMLElement>(".ui-screen");

    for (let index = 0; index < screens.length; index += 1) {
      const element = screens[index];

      if (element === undefined) {
        continue;
      }

      const isActive = element.id === `screen-${this.activeScreen}`;
      element.classList.toggle("active", isActive);
      element.setAttribute("aria-hidden", isActive ? "false" : "true");

      if ("inert" in element) {
        element.inert = !isActive;
      }
    }
  }

  private syncKeyListener(): void {
    // Tab-trap dos modais precisa do listener mesmo sem os atalhos de ESC.
    const wanted = this.rootElement !== null;

    if (wanted && !this.keyListenerInstalled && typeof window !== "undefined") {
      window.addEventListener("keydown", this.handleKeyDown);
      this.keyListenerInstalled = true;
    } else if (!wanted) {
      this.removeKeyListener();
    }
  }

  private removeKeyListener(): void {
    if (this.keyListenerInstalled && typeof window !== "undefined") {
      window.removeEventListener("keydown", this.handleKeyDown);
    }

    this.keyListenerInstalled = false;
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Tab" && this.modalStack.length > 0) {
      this.keepFocusInsideTopModal(event);
      return;
    }

    if (event.key !== "Escape") {
      return;
    }

    const top = this.modalStack[this.modalStack.length - 1];

    if (top !== undefined) {
      if (this.escapeClosesModals && top.config.closable !== false) {
        event.preventDefault();
        this.popModal(undefined, "escape");
      }

      return;
    }

    if (!this.escapeTogglesPauseMenu) {
      return;
    }

    if (this.activeScreen === "hud") {
      event.preventDefault();
      this.openScreen("pause_menu");
      return;
    }

    if (this.activeScreen === "pause_menu") {
      event.preventDefault();
      this.openScreen("hud");
    }
  }

  private keepFocusInsideTopModal(event: KeyboardEvent): void {
    const top = this.modalStack[this.modalStack.length - 1];
    const container = top?.element?.querySelector<HTMLElement>(".ui-modal-container") ?? null;

    if (container === null) {
      return;
    }

    const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);

    if (focusable.length === 0) {
      event.preventDefault();
      container.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last?.focus();
      return;
    }

    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  private removeModalAt(index: number, restoreFocus: boolean, reason: ModalCloseReason): boolean {
    if (index < 0 || index >= this.modalStack.length) {
      return false;
    }

    const entry = this.modalStack[index];

    if (entry === undefined) {
      return false;
    }

    const wasTop = index === this.modalStack.length - 1;
    this.modalStack.splice(index, 1);
    entry.element?.remove();
    this.syncModalLayers();
    this.hooks.onModalPopped?.(entry.config, this.modalStack.length);
    this.hooks.onModalClosed?.(entry.config, this.modalStack.length, reason);

    if (!restoreFocus || !wasTop) {
      return true;
    }

    if (entry.previousFocus !== null && entry.previousFocus.isConnected) {
      entry.previousFocus.focus();
    } else {
      const newTop = this.modalStack[this.modalStack.length - 1];
      newTop?.element?.querySelector<HTMLElement>(".ui-modal-container")?.focus();
    }

    return true;
  }

  private findModalIndex(modalId: string): number {
    for (let index = 0; index < this.modalStack.length; index += 1) {
      if (this.modalStack[index]?.config.id === modalId) {
        return index;
      }
    }

    return -1;
  }

  private focusModal(container: HTMLElement): void {
    const focusable = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (focusable ?? container).focus();
  }
}
