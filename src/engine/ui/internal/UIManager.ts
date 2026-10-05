import type {
  ModalConfig,
  UIScreenId,
} from "../../../contracts/ui/types";

interface ModalStackEntry {
  readonly config:
    ModalConfig;

  readonly element:
    HTMLDivElement;

  readonly previousFocus:
    HTMLElement | null;
}

export interface UIManagerHooks {
  readonly onScreenChanged?:
    (
      currentScreen:
        UIScreenId,
      previousScreen:
        UIScreenId,
    ) => void;

  readonly onModalPushed?:
    (
      config:
        ModalConfig,
      depth:
        number,
    ) => void;

  readonly onModalPopped?:
    (
      config:
        ModalConfig,
      depth:
        number,
    ) => void;
}

const FOCUSABLE_SELECTOR =
  [
    "button:not([disabled])",
    "[href]",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");

export class UIManager {
  private activeScreen:
    UIScreenId =
      "hud";

  private readonly modalStack:
    ModalStackEntry[] =
      [];

  private rootElement:
    HTMLElement | null =
      null;

  private readonly hooks:
    UIManagerHooks;

  public constructor(
    hooks:
      UIManagerHooks =
        {},
  ) {
    this.hooks =
      hooks;

    this.handleKeyDown =
      this.handleKeyDown.bind(
        this,
      );
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
    return this.rootElement !==
      null;
  }

  public mount(
    container:
      HTMLElement,
  ): void {
    if (
      this.rootElement ===
      container
    ) {
      this.syncScreenVisibility();

      return;
    }

    this.unmount();

    this.rootElement =
      container;

    container.classList.add(
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

    while (
      this.modalStack.length >
      0
    ) {
      const entry =
        this.modalStack.pop();

      entry?.element.remove();
    }

    this.rootElement
      ?.classList.remove(
        "ui-root-container",
      );

    this.rootElement =
      null;

    this.activeScreen =
      "hud";
  }

  public openScreen(
    screenId:
      UIScreenId,
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
  }

  public pushModal(
    config:
      ModalConfig,
  ): boolean {
    const root =
      this.rootElement;

    if (
      root ===
      null
    ) {
      return false;
    }

    const normalizedId =
      config.id.trim();

    if (
      normalizedId.length ===
      0
    ) {
      return false;
    }

    const existingIndex =
      this.findModalIndex(
        normalizedId,
      );

    if (
      existingIndex >=
      0
    ) {
      this.removeModalAt(
        existingIndex,
        false,
      );
    }

    const previousFocus =
      document.activeElement instanceof
        HTMLElement
        ? document.activeElement
        : null;

    const backdrop =
      document.createElement(
        "div",
      );

    backdrop.className =
      "ui-modal-backdrop";

    backdrop.dataset.modalId =
      normalizedId;

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

    container.setAttribute(
      "aria-label",
      config.title,
    );

    container.tabIndex =
      -1;

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
      config.contentHtml !==
      undefined
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
        config: {
          ...config,
          id:
            normalizedId,
        },

        element:
          backdrop,

        previousFocus,
      };

    this.modalStack.push(
      entry,
    );

    this.focusModal(
      container,
    );

    this.hooks
      .onModalPushed?.(
        entry.config,
        this.modalStack.length,
      );

    return true;
  }

  public popModal():
    boolean {
    if (
      this.modalStack.length ===
      0
    ) {
      return false;
    }

    return this.removeModalAt(
      this.modalStack.length -
        1,
      true,
    );
  }

  private syncScreenVisibility():
    void {
    const root =
      this.rootElement;

    if (
      root ===
      null
    ) {
      return;
    }

    const screens =
      root.querySelectorAll<
        HTMLElement
      >(
        ".ui-screen",
      );

    for (
      let index =
        0;
      index <
      screens.length;
      index +=
        1
    ) {
      const element =
        screens[
          index
        ];

      if (
        element ===
        undefined
      ) {
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

      if (
        "inert" in
        element
      ) {
        element.inert =
          !isActive;
      }
    }
  }

  private handleKeyDown(
    event:
      KeyboardEvent,
  ): void {
    if (
      event.key ===
      "Tab" &&
      this.modalStack.length >
        0
    ) {
      this.keepFocusInsideTopModal(
        event,
      );

      return;
    }

    if (
      event.key !==
      "Escape"
    ) {
      return;
    }

    const top =
      this.modalStack[
        this.modalStack.length -
          1
      ];

    if (
      top !==
      undefined
    ) {
      if (
        top.config.closable !==
        false
      ) {
        event.preventDefault();

        this.popModal();
      }

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

  private keepFocusInsideTopModal(
    event:
      KeyboardEvent,
  ): void {
    const top =
      this.modalStack[
        this.modalStack.length -
          1
      ];

    if (
      top ===
      undefined
    ) {
      return;
    }

    const container =
      top.element
        .querySelector<
          HTMLElement
        >(
          ".ui-modal-container",
        );

    if (
      container ===
      null
    ) {
      return;
    }

    const focusable =
      container
        .querySelectorAll<
          HTMLElement
        >(
          FOCUSABLE_SELECTOR,
        );

    if (
      focusable.length ===
      0
    ) {
      event.preventDefault();

      container.focus();

      return;
    }

    const first =
      focusable[
        0
      ];

    const last =
      focusable[
        focusable.length -
          1
      ];

    const active =
      document.activeElement;

    if (
      event.shiftKey &&
      active ===
        first
    ) {
      event.preventDefault();

      last?.focus();

      return;
    }

    if (
      !event.shiftKey &&
      active ===
        last
    ) {
      event.preventDefault();

      first?.focus();
    }
  }

  private removeModalAt(
    index:
      number,
    restoreFocus:
      boolean,
  ): boolean {
    if (
      index <
        0 ||
      index >=
        this.modalStack.length
    ) {
      return false;
    }

    const entry =
      this.modalStack[
        index
      ];

    if (
      entry ===
      undefined
    ) {
      return false;
    }

    this.modalStack.splice(
      index,
      1,
    );

    entry.element.remove();

    this.hooks
      .onModalPopped?.(
        entry.config,
        this.modalStack.length,
      );

    if (
      restoreFocus &&
      entry.previousFocus !==
        null &&
      entry.previousFocus
        .isConnected
    ) {
      entry.previousFocus
        .focus();
    } else if (
      restoreFocus
    ) {
      const newTop =
        this.modalStack[
          this.modalStack.length -
            1
        ];

      const container =
        newTop
          ?.element
          .querySelector<
            HTMLElement
          >(
            ".ui-modal-container",
          );

      container?.focus();
    }

    return true;
  }

  private findModalIndex(
    modalId:
      string,
  ): number {
    for (
      let index =
        0;
      index <
      this.modalStack.length;
      index +=
        1
    ) {
      if (
        this.modalStack[
          index
        ]?.config.id ===
        modalId
      ) {
        return index;
      }
    }

    return -1;
  }

  private focusModal(
    container:
      HTMLElement,
  ): void {
    const focusable =
      container
        .querySelector<
          HTMLElement
        >(
          FOCUSABLE_SELECTOR,
        );

    (
      focusable ??
      container
    ).focus();
  }
}
