export interface CapabilityWatcher {
  readonly pluginId: string;
  readonly capabilityId: string;
  readonly cb: (value: unknown) => void;
}

/**
 * Registro central de watchers de capabilities. Mantém agrupamento por
 * plugin para que `disposePlugin` limpe tudo — antes vivia como array
 * plano dentro do Kernel e vazava.
 */
export class CapabilityWatchers {
  private list: CapabilityWatcher[] = [];

  add(watcher: CapabilityWatcher): () => void {
    this.list.push(watcher);
    return () => {
      const i = this.list.indexOf(watcher);
      if (i >= 0) this.list.splice(i, 1);
    };
  }

  notify(capabilityId: string, value: unknown): void {
    for (const w of [...this.list]) {
      if (w.capabilityId !== capabilityId) continue;
      try {
        w.cb(value);
      } catch {
        /* watcher hostil */
      }
    }
  }

  disposePlugin(pluginId: string): void {
    this.list = this.list.filter((w) => w.pluginId !== pluginId);
  }

  clear(): void {
    this.list = [];
  }
}