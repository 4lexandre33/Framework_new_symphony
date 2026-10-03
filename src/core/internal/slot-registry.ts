import { KernelError } from "../contracts/errors";
import type { SlotDescriptor, SlotEntry, SlotView } from "../contracts/slot";
import { kernelErrors } from "./errors";

interface Contribution<T = unknown> {
  readonly pluginId: string;
  readonly value: T;
  readonly order: number;
  readonly dispose?: () => void;
}

interface OwnedDescriptor {
  readonly owner: string;
  readonly descriptor: SlotDescriptor;
}

interface Watcher {
  readonly pluginId: string;
  readonly cb: (view: SlotView) => void;
}

export class SlotRegistry {
  private readonly descriptors = new Map<string, OwnedDescriptor>();
  private readonly entries = new Map<string, Contribution[]>();
  private readonly watchers = new Map<string, Set<Watcher>>();
  private readonly watchersByPlugin = new Map<string, Set<() => void>>();

  define(descriptor: SlotDescriptor): () => void {
    const existing = this.descriptors.get(descriptor.id);
    if (existing) {
      throw kernelErrors.slotDuplicate(descriptor.id, existing.owner);
    }
    const owned: OwnedDescriptor = {
      owner: descriptor.owner,
      descriptor,
    };
    this.descriptors.set(descriptor.id, owned);
    return () => {
      // Só remove se AINDA é a nossa declaração — evita que um dispose
      // tardio de um plugin substituído remova a declaração do novo.
      const current = this.descriptors.get(descriptor.id);
      if (current === owned) this.descriptors.delete(descriptor.id);
    };
  }

  contribute<T>(
    slotId: string,
    pluginId: string,
    value: T,
    order = 0,
    dispose?: () => void,
  ): () => void {
    if (!this.descriptors.has(slotId)) {
      throw new KernelError("SLOT_UNKNOWN", `slot "${slotId}" não definido`);
    }
    const list = this.entries.get(slotId) ?? [];
    const entry: Contribution<T> = { pluginId, value, order, dispose };
    list.push(entry);
    list.sort((a, b) => a.order - b.order);
    this.entries.set(slotId, list);
    this.notify(slotId);
    return () => {
      const current = this.entries.get(slotId) ?? [];
      const idx = current.indexOf(entry as Contribution);
      if (idx >= 0) {
        const removed = current.splice(idx, 1)[0];
        try {
          removed?.dispose?.();
        } catch {
          /* dispose hostil */
        }
      }
      this.notify(slotId);
    };
  }

  read<T = unknown>(slotId: string): SlotView<T> {
    const owned = this.descriptors.get(slotId);
    if (!owned) {
      throw new KernelError("SLOT_UNKNOWN", `slot "${slotId}" não definido`);
    }
    const list = this.entries.get(slotId) ?? [];
    return {
      descriptor: owned.descriptor,
      entries: list.map<SlotEntry<T>>((c) => ({
        pluginId: c.pluginId,
        value: c.value as T,
        order: c.order,
        dispose: c.dispose,
      })),
    };
  }

  watch<T = unknown>(
    slotId: string,
    pluginId: string,
    cb: (view: SlotView<T>) => void,
  ): () => void {
    const set = this.watchers.get(slotId) ?? new Set();
    const watcher: Watcher = { pluginId, cb: cb as (view: SlotView) => void };
    set.add(watcher);
    this.watchers.set(slotId, set);

    const dispose = () => {
      set.delete(watcher);
      if (set.size === 0) this.watchers.delete(slotId);
      this.watchersByPlugin.get(pluginId)?.delete(dispose);
    };
    const bucket = this.watchersByPlugin.get(pluginId) ?? new Set();
    bucket.add(dispose);
    this.watchersByPlugin.set(pluginId, bucket);

    if (this.descriptors.has(slotId)) {
      try {
        cb(this.read(slotId));
      } catch {
        /* watcher hostil */
      }
    }
    return dispose;
  }

  /** Lista os descriptors (devtools). */
  list(): readonly SlotDescriptor[] {
    return [...this.descriptors.values()].map((o) => o.descriptor);
  }

  /**
   * Remove: (1) descriptors declarados pelo plugin, (2) contribuições,
   * (3) watchers. Cobre o caso em que o kernel esqueceu de chamar o
   * disposer explícito.
   */
  disposePlugin(pluginId: string): void {
    // 1) Descriptors
    for (const [id, owned] of [...this.descriptors]) {
      if (owned.owner === pluginId) this.descriptors.delete(id);
    }
    // 2) Contribuições
    for (const [slotId, list] of this.entries) {
      for (const entry of [...list]) {
        if (entry.pluginId !== pluginId) continue;
        try {
          entry.dispose?.();
        } catch {
          /* dispose hostil */
        }
        const idx = list.indexOf(entry);
        if (idx >= 0) list.splice(idx, 1);
      }
      this.notify(slotId);
    }
    // 3) Watchers
    const disposers = this.watchersByPlugin.get(pluginId);
    if (disposers) {
      for (const d of [...disposers]) {
        try {
          d();
        } catch {
          /* handler hostil */
        }
      }
      this.watchersByPlugin.delete(pluginId);
    }
  }

  private notify(slotId: string): void {
    const set = this.watchers.get(slotId);
    if (!set || set.size === 0) return;
    let view: SlotView;
    try {
      view = this.read(slotId);
    } catch {
      return;
    }
    for (const w of [...set]) {
      try {
        w.cb(view);
      } catch {
        /* watcher hostil */
      }
    }
  }
}