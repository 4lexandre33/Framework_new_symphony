import type { ViewportDimensions } from "../../contracts/render/types";

export interface ViewportResizeCallback {
  (dimensions: ViewportDimensions): void;
}

export class ViewportManager {
  private readonly dimensions: ViewportDimensions = {
    width: window.innerWidth,
    height: window.innerHeight,
    aspectRatio: window.innerWidth / Math.max(1, window.innerHeight),
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2.0),
  };

  private resizeListener: (() => void) | null = null;
  private readonly callbacks = new Set<ViewportResizeCallback>();

  public constructor(private readonly canvas: HTMLCanvasElement) {
    this.updateDimensions(window.innerWidth, window.innerHeight);
  }

  public attachResizeListener(): void {
    if (this.resizeListener) return;

    this.resizeListener = () => {
      this.updateDimensions(window.innerWidth, window.innerHeight);
      this.notifyCallbacks();
    };

    window.addEventListener("resize", this.resizeListener, { passive: true });
  }

  public detachResizeListener(): void {
    if (!this.resizeListener) return;
    window.removeEventListener("resize", this.resizeListener);
    this.resizeListener = null;
  }

  public onResize(callback: ViewportResizeCallback): () => void {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }

  public setManualSize(width: number, height: number, pixelRatio?: number): void {
    this.updateDimensions(width, height, pixelRatio);
    this.notifyCallbacks();
  }

  public getDimensions(): Readonly<ViewportDimensions> {
    return this.dimensions;
  }

  private updateDimensions(width: number, height: number, customPixelRatio?: number): void {
    const validWidth = Math.max(1, width);
    const validHeight = Math.max(1, height);
    const pr = customPixelRatio ?? Math.min(window.devicePixelRatio || 1, 2.0);

    this.dimensions.width = validWidth;
    this.dimensions.height = validHeight;
    this.dimensions.aspectRatio = validWidth / validHeight;
    this.dimensions.pixelRatio = pr;

    this.canvas.width = Math.floor(validWidth * pr);
    this.canvas.height = Math.floor(validHeight * pr);
    this.canvas.style.width = `${validWidth}px`;
    this.canvas.style.height = `${validHeight}px`;
  }

  private notifyCallbacks(): void {
    for (const callback of this.callbacks) {
      callback(this.dimensions);
    }
  }

  public dispose(): void {
    this.detachResizeListener();
    this.callbacks.clear();
  }
}