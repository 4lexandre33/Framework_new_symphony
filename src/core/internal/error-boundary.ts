import { PluginError } from "../contracts/errors";
import type { Logger } from "../contracts/plugin-context";

export interface GuardOptions {
  /**
   * Se true, propaga o erro como `PluginError` em vez de engolir.
   * O kernel passa `strict` do `KernelOptions`.
   */
  readonly strict?: boolean;
}

/**
 * Executa uma operação async isolando falhas.
 *
 * Contrato:
 * - `strict: false` (default): NUNCA rejeita. Erros viram log.
 * - `strict: true`: rejeita com `PluginError(pluginId, "handler failed", cause)`.
 *
 * A convenção anterior de inspecionar `err.message.includes("__kernel_rethrow__")`
 * foi REMOVIDA — era uma mágica em string que não escalava. Use `strict`.
 */
export async function guardAsync<T>(
  pluginId: string,
  log: Logger,
  fn: () => Promise<T> | T,
  opts: GuardOptions = {},
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    log.error("handler threw", { err: String(err) });
    if (opts.strict) {
      throw new PluginError(pluginId, "handler failed in strict mode", err);
    }
    return undefined;
  }
}