import type { HitTestResult } from "../../../contracts/overlay/types";

export interface ThreeRaycastCallback {
  (cursorX: number, cursorY: number): { hit: boolean; entityId?: string };
}

export class RaycastHitTestPassthrough {
  private lastHitState = false;

  public performHitTest(
    cursorX: number,
    cursorY: number,
    threeRaycast?: ThreeRaycastCallback
  ): HitTestResult {
    // 1. Hit-Test no DOM (#ui-root) se o ambiente possuir APIs de DOM (Webview)
    if (typeof document !== "undefined" && typeof document.elementFromPoint === "function") {
      const domElement = document.elementFromPoint(cursorX, cursorY);
      if (
        domElement &&
        domElement.id !== "game-canvas" &&
        domElement.id !== "ui-root" &&
        domElement.tagName !== "BODY"
      ) {
        const isPointerEventsAuto =
          typeof window !== "undefined" && typeof window.getComputedStyle === "function"
            ? window.getComputedStyle(domElement).pointerEvents !== "none"
            : true;

        if (isPointerEventsAuto) {
          this.lastHitState = true;
          return {
            hit: true,
            targetType: "dom_ui",
            elementId: domElement.id || domElement.tagName,
          };
        }
      }
    }

    // 2. Hit-Test no Grafo 3D (Three.js)
    if (threeRaycast) {
      const threeResult = threeRaycast(cursorX, cursorY);
      if (threeResult.hit) {
        this.lastHitState = true;
        return {
          hit: true,
          targetType: "three_mesh",
          entityId: threeResult.entityId,
        };
      }
    }

    // 3. Fundo transparente (sem colisão)
    this.lastHitState = false;
    return {
      hit: false,
      targetType: "none",
    };
  }

  public get isHoveringInteractiveObject(): boolean {
    return this.lastHitState;
  }
}