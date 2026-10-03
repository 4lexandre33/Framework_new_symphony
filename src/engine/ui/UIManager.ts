import type {
  ModalConfig,
  UIScreenId,
} from "../../contracts/ui/types";

interface ModalStackEntry {
  readonly config: ModalConfig;
  readonly element: HTMLDivElement;
}

export interface UIManagerHooks {
  readonly onScreenChanged?: (
    currentScreen: UIScreenId,
    previousScreen: UIScreenId,
  ) => void;

  readonly onModalPushed?: (
    config: ModalConfig,
    depth: number,
  ) => void;

  readonly onModalPopped?: (
    config: ModalConfig,
    depth: number,
  ) => void;
}

export class UIManager {
  private activeScreen: UIScreenId =
    "hud";

  private readonly modalStack:
    ModalStackEntry[] = [];

  private rootElement:
    HTMLElement | null = null;

  private readonly hooks:
    UIManagerHooks;

  public constructor(
    hooks: UIManagerHooks = {},
  ) {
    this.hooks = hooks;

    this.handleKeyDown =
      this.handleKeyDown.bind(this);
  }

  public get currentScreen():
    UIScreenId {
    return this.activeScreen;
  }

  public get activeModalCount():
    number {
    return this.modalStack.length;
  }

  public get isMounted():
    boolean {
    return this.rootElement !== null;
  }

  public mount(
    container: HTMLElement,
  ): void {
    if (
      this.rootElement ===
      container
    ) {
      this.syncScreenVisibility();

      return;
    }

    if (this.rootElement) {
      this.unmount();
    }

    this.rootElement =
      container;

    this.rootElement.classList.add(
      "ui-root-container",
    );

    window.addEventListener(
      "keydown",
      this.handleKeyDown,
    );

    this.syncScreenVisibility();
  }

  public unmount(): void {
    window.removeEventListener(
      "keydown",
      this.handleKeyDown,
    );

    for (
      let index =
        this.modalStack.length - 1;
      index >= 0;
      index -= 1
    ) {
      this.modalStack[
        index
      ]?.element.remove();
    }

    this.modalStack.length = 0;

    if (this.rootElement) {
      this.rootElement.classList.remove(
        "ui-root-container",
      );
    }

    this.rootElement = null;

    this.activeScreen =
      "hud";
  }

  public openScreen(
    screenId: UIScreenId,
  ): void {
    const previousScreen =
      this.activeScreen;

    if (
      previousScreen ===
      screenId
    ) {
      this.syncScreenVisibility();

      return;
    }

    this.activeScreen =
      screenId;

    this.syncScreenVisibility();

    this.hooks
      .onScreenChanged?.(
        screenId,
        previousScreen,
      );

    console.log(
      `[UIManager] 🖥️ Transição de tela: '${previousScreen}' -> '${screenId}'`,
    );
  }

  public pushModal(
    config: ModalConfig,
  ): boolean {
    const root =
      this.rootElement;

    if (!root) {
      return false;
    }

    const backdrop =
      document.createElement(
        "div",
      );

    backdrop.className =
      "ui-modal-backdrop";

    backdrop.dataset.modalId =
      config.id;

    backdrop.style.zIndex =
      String(
        2000 +
          this.modalStack.length *
            10,
      );

    const container =
      document.createElement(
        "div",
      );

    container.className =
      "ui-modal-container";

    container.setAttribute(
      "role",
      "dialog",
    );

    container.setAttribute(
      "aria-modal",
      "true",
    );

    const header =
      document.createElement(
        "div",
      );

    header.className =
      "ui-modal-header";

    const title =
      document.createElement(
        "div",
      );

    title.className =
      "ui-modal-title";

    title.textContent =
      config.title;

    header.appendChild(
      title,
    );

    if (
      config.closable !==
      false
    ) {
      const closeButton =
        document.createElement(
          "button",
        );

      closeButton.type =
        "button";

      closeButton.className =
        "ui-modal-close-btn";

      closeButton.dataset.action =
        "close-modal";

      closeButton.setAttribute(
        "aria-label",
        "Fechar",
      );

      closeButton.textContent =
        "×";

      /*
       * Não adicionamos listener direto aqui.
       *
       * O DOMEventListenerBridge é o único
       * proprietário das ações declarativas
       * data-action.
       *
       * Isso impede que um único clique
       * execute popModal() duas vezes.
       */
      header.appendChild(
        closeButton,
      );
    }

    const body =
      document.createElement(
        "div",
      );

    body.className =
      "ui-modal-body";

    if (
      config.contentHtml
    ) {
      body.innerHTML =
        config.contentHtml;
    }

    container.appendChild(
      header,
    );

    container.appendChild(
      body,
    );

    backdrop.appendChild(
      container,
    );

    root.appendChild(
      backdrop,
    );

    const entry:
      ModalStackEntry = {
        config,
        element:
          backdrop,
      };

    this.modalStack.push(
      entry,
    );

    this.hooks
      .onModalPushed?.(
        config,
        this.modalStack.length,
      );

    console.log(
      `[UIManager] 🪟 Modal empilhado: '${config.title}' (Profundidade: ${this.modalStack.length})`,
    );

    return true;
  }

  public popModal():
    boolean {
    const top =
      this.modalStack.pop();

    if (!top) {
      return false;
    }

    top.element.remove();

    this.hooks
      .onModalPopped?.(
        top.config,
        this.modalStack.length,
      );

    console.log(
      `[UIManager] 🪟 Modal desempilhado: '${top.config.title}'`,
    );

    return true;
  }

  private syncScreenVisibility():
    void {
    const root =
      this.rootElement;

    if (!root) {
      return;
    }

    const screens =
      root.querySelectorAll<HTMLElement>(
        ".ui-screen",
      );

    for (
      let index = 0;
      index <
      screens.length;
      index += 1
    ) {
      const element =
        screens[index];

      if (!element) {
        continue;
      }

      const isActive =
        element.id ===
        `screen-${this.activeScreen}`;

      element.classList.toggle(
        "active",
        isActive,
      );

      element.setAttribute(
        "aria-hidden",
        isActive
          ? "false"
          : "true",
      );
    }
  }

  private handleKeyDown(
    event: KeyboardEvent,
  ): void {
    if (
      event.key !==
      "Escape"
    ) {
      return;
    }

    if (
      this.modalStack.length >
      0
    ) {
      event.preventDefault();

      this.popModal();

      return;
    }

    if (
      this.activeScreen ===
      "hud"
    ) {
      event.preventDefault();

      this.openScreen(
        "pause_menu",
      );

      return;
    }

    if (
      this.activeScreen ===
      "pause_menu"
    ) {
      event.preventDefault();

      this.openScreen(
        "hud",
      );
    }
  }
}