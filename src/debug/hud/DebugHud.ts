export type HudTone =
  | "ok"
  | "warning"
  | "error"
  | "neutral";

interface HudElements {
  root: HTMLDivElement | null;
  fps: HTMLElement | null;
  steamStatus: HTMLElement | null;
  inputStatus: HTMLElement | null;
  assetsStatus: HTMLElement | null;
  mouseDelta: HTMLElement | null;
  logContent: HTMLElement | null;
  lockPointerButton:
    HTMLButtonElement | null;
  clearVramButton:
    HTMLButtonElement | null;
}

const COLOR_OK =
  "#00ffcc";

const COLOR_WARNING =
  "#ffcc00";

const COLOR_ERROR =
  "#ff3366";

const COLOR_NEUTRAL =
  "#cccccc";

const MAX_LOG_LINES =
  200;

export class DebugHud {
  private readonly elements:
    HudElements = {
      root: null,
      fps: null,
      steamStatus: null,
      inputStatus: null,
      assetsStatus: null,
      mouseDelta: null,
      logContent: null,
      lockPointerButton: null,
      clearVramButton: null,
    };

  public mount(): void {
    this.unmount();

    const container =
      document.createElement(
        "div",
      );

    container.id =
      "engine-debug-overlay";

    container.style.position =
      "fixed";

    container.style.top =
      "12px";

    container.style.left =
      "12px";

    container.style.width =
      "620px";

    container.style.padding =
      "14px";

    container.style.background =
      "rgba(10, 10, 18, 0.94)";

    container.style.color =
      COLOR_OK;

    container.style.fontFamily =
      "'Consolas', 'Courier New', monospace";

    container.style.fontSize =
      "12px";

    container.style.lineHeight =
      "1.5";

    container.style.borderRadius =
      "8px";

    container.style.border =
      "1px solid rgba(0, 255, 204, 0.4)";

    container.style.boxShadow =
      "0 8px 32px rgba(0, 0, 0, 0.6)";

    container.style.zIndex =
      "999999";

    container.style.pointerEvents =
      "auto";

    container.style.userSelect =
      "none";

    container.innerHTML = `
      <div
        style="
          font-weight: bold;
          font-size: 13px;
          margin-bottom: 8px;
          color: #ffffff;
          border-bottom: 1px solid rgba(255, 255, 255, 0.15);
          padding-bottom: 4px;
          display: flex;
          justify-content: space-between;
          gap: 16px;
        "
      >
        <span>
          🚀 Core Engine Debug Overlay
        </span>

        <span
          id="hud-fps-counter"
          style="
            color: #00ffcc;
            font-size: 11px;
            font-weight: bold;
            white-space: nowrap;
          "
        >
          -- FPS | -- ms | Frame 0
        </span>
      </div>

      <div
        id="debug-steam-status"
        style="
          margin-bottom: 4px;
          color: #ffcc00;
        "
      >
        Steam: Aguardando Kernel...
      </div>

      <div
        id="debug-input-status"
        style="
          margin-bottom: 4px;
          color: #ffcc00;
          white-space: normal;
        "
      >
        Input: Aguardando Kernel...
      </div>

      <div
        id="debug-assets-status"
        style="
          margin-bottom: 4px;
          color: #ffcc00;
        "
      >
        Assets: Aguardando Kernel...
      </div>

      <div
        id="debug-mouse-delta"
        style="
          margin-bottom: 10px;
          color: #00ffcc;
        "
      >
        Mouse Delta: X: 0 | Y: 0
      </div>

      <div
        style="
          display: flex;
          gap: 8px;
          margin-bottom: 10px;
        "
      >
        <button
          id="btn-lock-pointer"
          type="button"
          style="
            background: #00ffcc;
            color: #050508;
            border: none;
            padding: 6px 10px;
            cursor: pointer;
            border-radius: 4px;
            font-weight: bold;
            font-size: 11px;
            font-family: inherit;
          "
        >
          Travar Mouse 3D
        </button>

        <button
          id="btn-clear-vram"
          type="button"
          style="
            background: #ff3366;
            color: #ffffff;
            border: none;
            padding: 6px 10px;
            cursor: pointer;
            border-radius: 4px;
            font-weight: bold;
            font-size: 11px;
            font-family: inherit;
          "
        >
          Limpar VRAM
        </button>
      </div>

      <div
        style="
          font-weight: bold;
          font-size: 11px;
          color: #aaaaaa;
          margin-bottom: 4px;
        "
      >
        Console de Eventos:
      </div>

      <div
        id="hud-log-content"
        style="
          background: rgba(0, 0, 0, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.1);
          padding: 6px;
          height: 120px;
          overflow-y: auto;
          font-size: 11px;
          border-radius: 4px;
          word-break: break-word;
        "
      ></div>
    `;

    document.body.appendChild(
      container,
    );

    this.elements.root =
      container;

    this.elements.fps =
      document.getElementById(
        "hud-fps-counter",
      );

    this.elements.steamStatus =
      document.getElementById(
        "debug-steam-status",
      );

    this.elements.inputStatus =
      document.getElementById(
        "debug-input-status",
      );

    this.elements.assetsStatus =
      document.getElementById(
        "debug-assets-status",
      );

    this.elements.mouseDelta =
      document.getElementById(
        "debug-mouse-delta",
      );

    this.elements.logContent =
      document.getElementById(
        "hud-log-content",
      );

    this.elements.lockPointerButton =
      document.getElementById(
        "btn-lock-pointer",
      ) as HTMLButtonElement | null;

    this.elements.clearVramButton =
      document.getElementById(
        "btn-clear-vram",
      ) as HTMLButtonElement | null;
  }

  public unmount(): void {
    const existing =
      document.getElementById(
        "engine-debug-overlay",
      );

    if (existing) {
      existing.remove();
    }

    this.elements.root = null;
    this.elements.fps = null;
    this.elements.steamStatus = null;
    this.elements.inputStatus = null;
    this.elements.assetsStatus = null;
    this.elements.mouseDelta = null;
    this.elements.logContent = null;
    this.elements.lockPointerButton = null;
    this.elements.clearVramButton = null;
  }

  public setFps(
    fps: number,
    frameTimeMs: number,
    totalFrames: number,
  ): void {
    const element =
      this.elements.fps;

    if (!element) {
      return;
    }

    element.textContent =
      `${fps.toFixed(2)} FPS | ` +
      `${frameTimeMs.toFixed(2)} ms | ` +
      `Frame ${totalFrames}`;

    element.style.color =
      COLOR_OK;
  }

  public setSteamStatus(
    text: string,
    tone: HudTone,
  ): void {
    this.setElementStatus(
      this.elements.steamStatus,
      text,
      tone,
    );
  }

  public setInputStatus(
    text: string,
    tone: HudTone,
  ): void {
    this.setElementStatus(
      this.elements.inputStatus,
      text,
      tone,
    );
  }

  public setAssetsStatus(
    text: string,
    tone: HudTone,
  ): void {
    this.setElementStatus(
      this.elements.assetsStatus,
      text,
      tone,
    );
  }

  public setMouseDelta(
    x: number,
    y: number,
  ): void {
    const element =
      this.elements.mouseDelta;

    if (!element) {
      return;
    }

    element.textContent =
      `Mouse Delta: X: ${x} | Y: ${y}`;
  }

  public setBootFailure(): void {
    if (this.elements.fps) {
      this.elements.fps.textContent =
        "-- FPS | -- ms | Frame 0";

      this.elements.fps.style.color =
        COLOR_ERROR;
    }

    this.setSteamStatus(
      "Steam: Falha no Kernel",
      "error",
    );

    this.setInputStatus(
      "Input: Falha no Kernel",
      "error",
    );

    this.setAssetsStatus(
      "Assets: Falha no Kernel",
      "error",
    );

    this.setMouseDelta(
      0,
      0,
    );
  }

  public appendLog(
    message: string,
  ): void {
    const container =
      this.elements.logContent;

    if (!container) {
      return;
    }

    const timestamp =
      new Date().toLocaleTimeString();

    const line =
      document.createElement(
        "div",
      );

    line.style.marginBottom =
      "2px";

    const timestampElement =
      document.createElement(
        "span",
      );

    timestampElement.style.color =
      "#888888";

    timestampElement.textContent =
      `[${timestamp}] `;

    const messageElement =
      document.createElement(
        "span",
      );

    messageElement.textContent =
      message;

    line.appendChild(
      timestampElement,
    );

    line.appendChild(
      messageElement,
    );

    container.insertBefore(
      line,
      container.firstChild,
    );

    while (
      container.childElementCount >
      MAX_LOG_LINES
    ) {
      const last =
        container.lastElementChild;

      if (!last) {
        break;
      }

      last.remove();
    }
  }

  public onPointerLockClick(
    handler:
      () => void | Promise<void>,
  ): () => void {
    const button =
      this.elements.lockPointerButton;

    if (!button) {
      return (): void => {};
    }

    const listener =
      (): void => {
        void handler();
      };

    button.addEventListener(
      "click",
      listener,
    );

    return (): void => {
      button.removeEventListener(
        "click",
        listener,
      );
    };
  }

  public onClearVramClick(
    handler: () => void,
  ): () => void {
    const button =
      this.elements.clearVramButton;

    if (!button) {
      return (): void => {};
    }

    button.addEventListener(
      "click",
      handler,
    );

    return (): void => {
      button.removeEventListener(
        "click",
        handler,
      );
    };
  }

  private setElementStatus(
    element: HTMLElement | null,
    text: string,
    tone: HudTone,
  ): void {
    if (!element) {
      return;
    }

    element.textContent =
      text;

    element.style.color =
      this.getToneColor(
        tone,
      );
  }

  private getToneColor(
    tone: HudTone,
  ): string {
    switch (tone) {
      case "ok":
        return COLOR_OK;

      case "warning":
        return COLOR_WARNING;

      case "error":
        return COLOR_ERROR;

      case "neutral":
      default:
        return COLOR_NEUTRAL;
    }
  }
}