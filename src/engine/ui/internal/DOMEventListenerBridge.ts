import type {
  PluginContext,
} from "@core";

import type {
  UIScreenId,
} from "../../../contracts/ui/types";

const SCREEN_IDS: ReadonlySet<string> = new Set([
  "main_menu",
  "hud",
  "inventory",
  "settings",
  "dialogue",
  "game_over",
  "pause_menu",
]);

export interface DOMActionSink {
  /** Fecha o modal que contém o botão (ou o do topo). */
  closeModal(modalId: string | null): void;
  openScreen(screenId: UIScreenId): void;
  /** Ação não tratada pela engine → evento `game.ui.action`. */
  emitAction(action: string, value: string | null, modalId: string | null): void;
}

export interface DOMEventListenerBridgeOptions {
  /** Trata `[data-action]` com o comportamento legado (padrão false, G96). */
  readonly legacyDataActions?: boolean;
}

/**
 * Cliques em `#ui-root`. Por padrão só `[data-ui-action]` (atributo da
 * engine) é tratado (G96): `close-modal` fecha o modal que contém o botão,
 * `open-screen` abre `data-ui-value`; qualquer outra ação é publicada como
 * `game.ui.action` para o jogo decidir. `[data-action]` do jogo é ignorado,
 * salvo `legacyDataActions: true` (start-game → load-scene "level_01").
 */
export class DOMEventListenerBridge {
  private rootElement: HTMLElement | null = null;
  private legacyDataActions: boolean;

  public constructor(
    private readonly ctx: PluginContext,
    private readonly sink: DOMActionSink | null = null,
    options: DOMEventListenerBridgeOptions = {},
  ) {
    this.legacyDataActions = options.legacyDataActions ?? false;
    this.handleClick = this.handleClick.bind(this);
  }

  public setLegacyDataActions(enabled: boolean): void {
    this.legacyDataActions = enabled;
  }

  public attach(root: HTMLElement): void {
    if (this.rootElement === root) {
      return;
    }

    this.detach();
    this.rootElement = root;
    root.addEventListener("click", this.handleClick);
  }

  public detach(): void {
    const root = this.rootElement;

    if (!root) {
      return;
    }

    root.removeEventListener("click", this.handleClick);
    this.rootElement = null;
  }

  private handleClick(event: MouseEvent): void {
    const rawTarget = event.target;

    if (!(rawTarget instanceof Element)) {
      return;
    }

    const root = this.rootElement;

    if (!root) {
      return;
    }

    const uiActionElement = rawTarget.closest<HTMLElement>("[data-ui-action]");

    if (uiActionElement && root.contains(uiActionElement)) {
      const action = uiActionElement.getAttribute("data-ui-action");

      if (action) {
        this.handleUIAction(action, uiActionElement);
      }

      return;
    }

    if (!this.legacyDataActions) {
      return;
    }

    const actionElement = rawTarget.closest<HTMLElement>("[data-action]");

    if (!actionElement || !root.contains(actionElement)) {
      return;
    }

    const action = actionElement.dataset.action;

    if (!action) {
      return;
    }

    void this.dispatchLegacyAction(action);
  }

  private handleUIAction(action: string, element: HTMLElement): void {
    const modalElement = element.closest<HTMLElement>("[data-modal-id]");
    const modalId = modalElement?.dataset.modalId ?? null;
    const value = element.getAttribute("data-ui-value");
    const sink = this.sink;

    if (sink === null) {
      return;
    }

    if (action === "close-modal") {
      sink.closeModal(modalId);
      return;
    }

    if (action === "open-screen" && value !== null && SCREEN_IDS.has(value)) {
      sink.openScreen(value as UIScreenId);
      return;
    }

    sink.emitAction(action, value, modalId);
  }

  private async dispatchLegacyAction(action: string): Promise<void> {
    try {
      switch (action) {
        case "start-game": {
          await this.ctx.commands.send("game.world.load-scene", {
            scene: {
              sceneId: "level_01",
              sceneName: "Fase 1",
              assetsToPreload: [],
            },
          });
          await this.ctx.commands.send("game.ui.open-screen", { screenId: "hud" });
          return;
        }

        case "open-settings": {
          await this.ctx.commands.send("game.ui.open-screen", { screenId: "settings" });
          return;
        }

        case "close-modal": {
          await this.ctx.commands.send("game.ui.pop-modal", {});
          return;
        }

        default: {
          this.sink?.emitAction(action, null, null);
        }
      }
    } catch (error: unknown) {
      console.error(`[DOMEventListenerBridge] Falha ao processar ação '${action}':`, error);
    }
  }
}
