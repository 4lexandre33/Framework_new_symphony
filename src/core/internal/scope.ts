export interface ResourceScope {
  readonly signal: AbortSignal;
  add(dispose: () => void | Promise<void>): void;
  fork(): ResourceScope;
  run(): Promise<void>;
  readonly disposed: boolean;
}

class ResourceScopeImpl implements ResourceScope {
  private readonly disposers: Array<() => void | Promise<void>> = [];
  private readonly controller = new AbortController();
  private readonly children = new Set<ResourceScopeImpl>();
  private _disposed = false;

  constructor(private readonly parent?: ResourceScopeImpl) {
    if (parent) parent.children.add(this);
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get disposed(): boolean {
    return this._disposed;
  }

  add(dispose: () => void | Promise<void>): void {
    if (this._disposed) throw new Error("scope já fechado");
    this.disposers.push(dispose);
  }

  fork(): ResourceScope {
    if (this._disposed) throw new Error("scope já fechado");
    return new ResourceScopeImpl(this);
  }

  async run(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;
    this.controller.abort();
    for (const child of [...this.children].reverse()) {
      await child.run();
    }
    this.children.clear();
    for (const d of this.disposers.reverse()) {
      try {
        await d();
      } catch {
        /* recurso hostil */
      }
    }
    this.disposers.length = 0;
    if (this.parent) this.parent.children.delete(this);
  }
}

export function createScope(): ResourceScope {
  return new ResourceScopeImpl();
}