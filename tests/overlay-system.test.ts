// @vitest-environment jsdom

import {
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  RaycastHitTestPassthrough,
} from "../src/engine/overlay/RaycastHitTestPassthrough";

import {
  OverlayWindowManager,
} from "../src/engine/overlay/OverlayWindowManager";

import {
  createOverlayPlugin,
} from "../src/plugins/overlay/plugin";

import {
  DockToTaskbarCommand,
} from "../src/contracts/overlay/types";

import {
  OverlayToken,
} from "../src/tokens/overlay";

describe("Camada de Overlay & Taskbar Docking (game.overlay)", (): void => {
  let hitTest: RaycastHitTestPassthrough;
  let windowManager: OverlayWindowManager;

  beforeEach((): void => {
    hitTest = new RaycastHitTestPassthrough();
    windowManager = new OverlayWindowManager();

    Object.defineProperty(window, "screen", {
      writable: true,
      configurable: true,
      value: {
        width: 1920,
        height: 1080,
      },
    });
  });

  describe("RaycastHitTestPassthrough", (): void => {
    it("deve identificar colisão Three.js", (): void => {
      const result = hitTest.performHitTest(
        100,
        100,
        (): { hit: boolean; entityId: string } => ({
          hit: true,
          entityId: "pet_cat_3d",
        }),
      );

      expect(result.hit).toBe(true);
      expect(result.targetType).toBe("three_mesh");
      expect(result.entityId).toBe("pet_cat_3d");
      expect(hitTest.isHoveringInteractiveObject).toBe(true);
    });

    it("deve identificar fundo transparente", (): void => {
      const result = hitTest.performHitTest(
        500,
        500,
        (): { hit: boolean } => ({ hit: false }),
      );

      expect(result.hit).toBe(false);
      expect(result.targetType).toBe("none");
      expect(hitTest.isHoveringInteractiveObject).toBe(false);
    });
  });

  describe("OverlayWindowManager", (): void => {
    it("deve calcular ancoragem na barra inferior", (): void => {
      windowManager.updateTaskbarBounds({
        x: 0,
        y: 1040,
        width: 1920,
        height: 40,
        position: "bottom",
      });

      const dockPosition = windowManager.calculateDockPosition(200, 200, "bottom");

      expect(dockPosition.y).toBe(840);
      expect(dockPosition.x).toBe(860);
    });

    it("deve gerenciar AlwaysOnTop", (): void => {
      windowManager.setAlwaysOnTop(true);
      expect(windowManager.isAlwaysOnTop).toBe(true);

      windowManager.setAlwaysOnTop(false);
      expect(windowManager.isAlwaysOnTop).toBe(false);
    });
  });

  describe("Plugin game.overlay", (): void => {
    it("deve fornecer OverlayToken e depender do game.loop", (): void => {
      const plugin = createOverlayPlugin();
      const provides = plugin.manifest.capabilities?.provides ?? [];

      expect(provides.some((item): boolean => item.id === OverlayToken.id)).toBe(true);
      expect(
        plugin.manifest.dependsOn?.some((item): boolean => item.id === "game.loop"),
      ).toBe(true);
      expect(DockToTaskbarCommand.type).toBe("game.overlay.dock-to-taskbar");
    });
  });
});
