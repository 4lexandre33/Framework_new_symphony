import type {
  ViewportAutoResizeMode,
  ViewportDimensions,
} from "../../../contracts/render/types";

export interface ViewportResizeCallback {
  (dimensions: Readonly<ViewportDimensions>): void;
}

const MAX_PIXEL_RATIO = 2;
const NOOP_DISPOSER = (): void => {};

function normalizeDimension(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }

  return Math.max(1, Math.floor(value));
}

function normalizePixelRatio(
  value: number | undefined,
  maxPixelRatio: number = MAX_PIXEL_RATIO,
): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return 1;
  }

  return Math.min(maxPixelRatio, value);
}

export class ViewportManager {
  private readonly dimensions: ViewportDimensions;

  private resizeListener: (() => void) | null = null;
  private readonly callbacks = new Set<ViewportResizeCallback>();

  private disposed = false;

  // G43: política de tamanho. "window" preserva o comportamento original.
  private autoResizeMode: ViewportAutoResizeMode = "window";
  private maxPixelRatio = MAX_PIXEL_RATIO;
  private lastRequestedPixelRatio: number | undefined;
  private parentObserver: ResizeObserver | null = null;

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly hostWindow: Window = window,
  ) {
    this.dimensions = {
      width: 1,
      height: 1,
      aspectRatio: 1,
      pixelRatio: 1,
    };

    this.updateDimensions(
      hostWindow.innerWidth,
      hostWindow.innerHeight,
      hostWindow.devicePixelRatio,
    );
  }

  public attachResizeListener(): void {
    if (this.disposed || this.resizeListener !== null) {
      return;
    }

    this.resizeListener = (): void => {
      if (this.disposed) {
        return;
      }

      this.applyAutoResize();
    };

    this.hostWindow.addEventListener(
      "resize",
      this.resizeListener,
      { passive: true },
    );
  }

  public detachResizeListener(): void {
    if (this.resizeListener === null) {
      return;
    }

    this.hostWindow.removeEventListener(
      "resize",
      this.resizeListener,
    );

    this.resizeListener = null;
  }

  public onResize(callback: ViewportResizeCallback): () => void {
    if (this.disposed) {
      return NOOP_DISPOSER;
    }

    this.callbacks.add(callback);

    return (): void => {
      this.callbacks.delete(callback);
    };
  }

  public setManualSize(
    width: number,
    height: number,
    pixelRatio?: number,
  ): void {
    if (this.disposed) {
      return;
    }

    this.updateDimensions(
      width,
      height,
      pixelRatio ?? this.hostWindow.devicePixelRatio,
    );

    this.notifyCallbacks();
  }

  public getAutoResizeMode(): ViewportAutoResizeMode {
    return this.autoResizeMode;
  }

  public getMaxPixelRatio(): number {
    return this.maxPixelRatio;
  }

  /**
   * Muda a política de auto-resize e/ou o limite de pixelRatio.
   * Reaplica o tamanho imediatamente quando o modo segue janela/pai.
   */
  public setOptions(
    autoResize: ViewportAutoResizeMode | undefined,
    maxPixelRatio: number | undefined,
  ): void {
    if (this.disposed) {
      return;
    }

    if (maxPixelRatio !== undefined) {
      if (!Number.isFinite(maxPixelRatio) || maxPixelRatio <= 0) {
        throw new RangeError("maxPixelRatio precisa ser finito e > 0.");
      }

      this.maxPixelRatio = maxPixelRatio;
    }

    if (autoResize !== undefined) {
      if (
        autoResize !== "window" &&
        autoResize !== "parent" &&
        autoResize !== "none"
      ) {
        throw new RangeError(`autoResize inválido: ${String(autoResize)}.`);
      }

      this.autoResizeMode = autoResize;
    }

    this.syncParentObserver();

    if (this.autoResizeMode === "none") {
      this.updateDimensions(
        this.dimensions.width,
        this.dimensions.height,
        this.lastRequestedPixelRatio ?? this.hostWindow.devicePixelRatio,
      );
      this.notifyCallbacks();
      return;
    }

    this.applyAutoResize();
  }

  public getDimensions(): Readonly<ViewportDimensions> {
    return this.dimensions;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.detachResizeListener();
    this.disconnectParentObserver();
    this.callbacks.clear();
    this.disposed = true;
  }

  private updateDimensions(
    width: number,
    height: number,
    pixelRatio?: number,
  ): void {
    const validWidth = normalizeDimension(width);
    const validHeight = normalizeDimension(height);
    this.lastRequestedPixelRatio = pixelRatio;
    const validPixelRatio = normalizePixelRatio(
      pixelRatio,
      this.maxPixelRatio,
    );

    this.dimensions.width = validWidth;
    this.dimensions.height = validHeight;
    this.dimensions.aspectRatio = validWidth / validHeight;
    this.dimensions.pixelRatio = validPixelRatio;

    // O WebGLRenderer é o owner do drawing buffer (canvas.width/height).
    // ViewportManager governa apenas CSS + dimensões lógicas.
    this.canvas.style.width = `${validWidth}px`;
    this.canvas.style.height = `${validHeight}px`;
  }

  private syncParentObserver(): void {
    this.disconnectParentObserver();

    const parent = this.canvas.parentElement;
    const observerCtor = (
      this.hostWindow as Window & { ResizeObserver?: typeof ResizeObserver }
    ).ResizeObserver;

    if (
      this.autoResizeMode !== "parent" ||
      parent === null ||
      typeof observerCtor !== "function"
    ) {
      return;
    }

    this.parentObserver = new observerCtor((): void => {
      if (!this.disposed) {
        this.applyAutoResize();
      }
    });
    this.parentObserver.observe(parent);
  }

  private disconnectParentObserver(): void {
    if (this.parentObserver !== null) {
      this.parentObserver.disconnect();
      this.parentObserver = null;
    }
  }

  private applyAutoResize(): void {
    if (this.autoResizeMode === "none") {
      return;
    }

    if (this.autoResizeMode === "parent") {
      const parent = this.canvas.parentElement;

      if (parent !== null) {
        this.updateDimensions(
          parent.clientWidth,
          parent.clientHeight,
          this.hostWindow.devicePixelRatio,
        );
        this.notifyCallbacks();
        return;
      }
    }

    this.updateDimensions(
      this.hostWindow.innerWidth,
      this.hostWindow.innerHeight,
      this.hostWindow.devicePixelRatio,
    );

    this.notifyCallbacks();
  }

  private notifyCallbacks(): void {
    for (const callback of this.callbacks) {
      callback(this.dimensions);
    }
  }
}
