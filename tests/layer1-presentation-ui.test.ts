// @vitest-environment jsdom

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  UIManager,
} from "../src/engine/ui/internal/UIManager";

describe(
  "Layer 1 Stage 80 — UI presentation",
  (): void => {
    afterEach(
      (): void => {
        document.body.innerHTML =
          "";

        vi.restoreAllMocks();
      },
    );

    it(
      "fecha o modal antes de alternar pause e restaura foco anterior",
      (): void => {
        const manager =
          new UIManager();

        const root =
          document.createElement(
            "div",
          );

        root.innerHTML = `
          <button id="open">Abrir</button>
          <div id="screen-hud" class="ui-screen"></div>
          <div id="screen-pause_menu" class="ui-screen"></div>
        `;

        document.body.appendChild(
          root,
        );

        manager.mount(
          root,
        );

        const open =
          root.querySelector<
            HTMLButtonElement
          >(
            "#open",
          );

        open?.focus();

        expect(
          manager.pushModal({
            id:
              "settings-modal",
            title:
              "Settings",
            contentHtml:
              '<button id="inside">Dentro</button>',
          }),
        ).toBe(
          true,
        );

        expect(
          manager.activeModalCount,
        ).toBe(
          1,
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
          manager.activeModalCount,
        ).toBe(
          0,
        );

        expect(
          document.activeElement,
        ).toBe(
          open,
        );

        expect(
          manager.currentScreen,
        ).toBe(
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
          manager.currentScreen,
        ).toBe(
          "pause_menu",
        );

        manager.unmount();
      },
    );

    it(
      "unmount é idempotente e remove listener global de Escape",
      (): void => {
        const manager =
          new UIManager();

        const root =
          document.createElement(
            "div",
          );

        root.innerHTML = `
          <div id="screen-hud" class="ui-screen"></div>
          <div id="screen-pause_menu" class="ui-screen"></div>
        `;

        document.body.appendChild(
          root,
        );

        manager.mount(
          root,
        );

        manager.unmount();
        manager.unmount();

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
          manager.currentScreen,
        ).toBe(
          "hud",
        );
      },
    );
  },
);
