import type {
  PluginContext,
} from "../../core/contracts/plugin-context";

export class DOMEventListenerBridge {
  private rootElement:
    HTMLElement | null = null;

  public constructor(
    private readonly ctx:
      PluginContext,
  ) {
    this.handleClick =
      this.handleClick.bind(
        this,
      );
  }

  public attach(
    root: HTMLElement,
  ): void {
    if (
      this.rootElement ===
      root
    ) {
      return;
    }

    this.detach();

    this.rootElement =
      root;

    root.addEventListener(
      "click",
      this.handleClick,
    );
  }

  public detach(): void {
    const root =
      this.rootElement;

    if (!root) {
      return;
    }

    root.removeEventListener(
      "click",
      this.handleClick,
    );

    this.rootElement = null;
  }

  private handleClick(
    event: MouseEvent,
  ): void {
    const rawTarget =
      event.target;

    if (
      !(
        rawTarget instanceof
        Element
      )
    ) {
      return;
    }

    const actionElement =
      rawTarget.closest<HTMLElement>(
        "[data-action]",
      );

    if (!actionElement) {
      return;
    }

    const root =
      this.rootElement;

    if (
      !root ||
      !root.contains(
        actionElement,
      )
    ) {
      return;
    }

    const action =
      actionElement.dataset.action;

    if (!action) {
      return;
    }

    console.log(
      `[DOMEventListenerBridge] 🕹️ Ação de UI clicada: '${action}'`,
    );

    void this.dispatchAction(
      action,
    );
  }

  private async dispatchAction(
    action: string,
  ): Promise<void> {
    try {
      switch (action) {
        case "start-game": {
          await this.ctx.commands.send(
            "game.world.load-scene",
            {
              scene: {
                sceneId:
                  "level_01",

                sceneName:
                  "Fase 1",

                assetsToPreload:
                  [],
              },
            },
          );

          await this.ctx.commands.send(
            "game.ui.open-screen",
            {
              screenId:
                "hud",
            },
          );

          return;
        }

        case "open-settings": {
          await this.ctx.commands.send(
            "game.ui.open-screen",
            {
              screenId:
                "settings",
            },
          );

          return;
        }

        case "close-modal": {
          await this.ctx.commands.send(
            "game.ui.pop-modal",
            {},
          );

          return;
        }

        default: {
          console.warn(
            `[DOMEventListenerBridge] Ação desconhecida: '${action}'.`,
          );
        }
      }
    } catch (error: unknown) {
      console.error(
        `[DOMEventListenerBridge] Falha ao processar ação '${action}':`,
        error,
      );
    }
  }
}