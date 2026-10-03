/**
 * Uma contribuição viva em um slot.
 * Pode ser qualquer coisa — componente React, handler, função, string.
 * O kernel não interpreta; quem consome o slot sabe o que esperar.
 */
export interface SlotEntry<T = unknown> {
  readonly pluginId: string;
  readonly value: T;
  readonly order: number;
  readonly dispose?: () => void;
}

export interface SlotDescriptor {
  readonly id: string;
  readonly title?: string;
  readonly description?: string;
  /** plugin que declarou o slot. "kernel" se for core. */
  readonly owner: string;
}

export interface SlotView<T = unknown> {
  readonly descriptor: SlotDescriptor;
  readonly entries: readonly SlotEntry<T>[];
}