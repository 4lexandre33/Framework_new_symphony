import type { ViewportDimensions } from "../../../contracts/render/types";

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

function normalizePixelRatio(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return 1;
  }

  return Math.min(MAX_PIXEL_RATIO, value);
}

export class ViewportManager {
  private readonly dimensions: ViewportDimensions;

  private resizeListener: (() => void) | null = null;
  private readonly callbacks = new Set<ViewportResizeCallback>();

  private disposed = false;

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

      this.updateDimensions(
        this.hostWindow.innerWidth,
        this.hostWindow.innerHeight,
        this.hostWindow.devicePixelRatio,
      );

      this.notifyCallbacks();
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

  public getDimensions(): Readonly<ViewportDimensions> {
    return this.dimensions;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.detachResizeListener();
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
    const validPixelRatio = normalizePixelRatio(pixelRatio);

    this.dimensions.width = validWidth;
    this.dimensions.height = validHeight;
    this.dimensions.aspectRatio = validWidth / validHeight;
    this.dimensions.pixelRatio = validPixelRatio;

    // O WebGLRenderer é o owner do drawing buffer (canvas.width/height).
    // ViewportManager governa apenas CSS + dimensões lógicas.
    this.canvas.style.width = `${validWidth}px`;
    this.canvas.style.height = `${validHeight}px`;
  }

  private notifyCallbacks(): void {
    for (const callback of this.callbacks) {
      callback(this.dimensions);
    }
  }
}
