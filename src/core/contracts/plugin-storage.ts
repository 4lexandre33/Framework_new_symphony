/**
 * Storage key-value isolado por plugin. Movido de @tokens/plugin-storage
 * para o core para que o kernel não dependa de @tokens.
 */
export interface PluginStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  clear(): void;
}
