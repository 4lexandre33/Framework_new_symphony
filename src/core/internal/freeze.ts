import type { Envelope } from "../contracts/envelope";

const env = (import.meta as unknown as { env?: Record<string, string | boolean> }).env;
const isDev = env?.DEV === true;
/**
 * Escape hatch: em casos raros (benchmarks, plugins que precisam mutar por
 * contrato com sistemas legados) o host pode desligar o congelamento.
 * Por padrão, congelamos SEMPRE — prod inclusive.
 */
const unsafeMutable = env?.VITE_UNSAFE_MUTABLE === "1" || env?.VITE_UNSAFE_MUTABLE === "true";
/**
 * Deep freeze de valores (config, etc.) só em DEV ou quando explicitamente
 * pedido em prod. Congelamento profundo é caro e pode quebrar libs que
 * mutam por dentro.
 */
const deepFreezeEnabled =
  isDev || env?.VITE_STRICT_FREEZE === "1" || env?.VITE_STRICT_FREEZE === "true";

const DEEP_FREEZE_MAX_DEPTH = 12;

/**
 * Congela o envelope e seu `meta` (shallow) — sempre, exceto opt-out.
 * Barato e impede mutação acidental do envelope por handlers hostis.
 */
export function freezeEnvelope<E extends Envelope>(env: E): E {
  if (unsafeMutable) return env;
  if (!Object.isFrozen(env)) Object.freeze(env);
  if (!Object.isFrozen(env.meta)) Object.freeze(env.meta);
  return env;
}

/**
 * Congela profundamente um valor (config, snapshot). Só em DEV ou com
 * VITE_STRICT_FREEZE. Depth-limitado para não explodir em grafos grandes.
 */
export function freezeValue<T>(value: T): T {
  if (unsafeMutable) return value;
  if (!deepFreezeEnabled) return value;
  try {
    deepFreeze(value);
  } catch {
    /* getters hostis */
  }
  return value;
}

function deepFreeze(o: unknown, seen = new WeakSet<object>(), depth = 0): void {
  if (depth > DEEP_FREEZE_MAX_DEPTH) return;
  if (o === null || typeof o !== "object" || seen.has(o as object)) return;
  seen.add(o as object);
  Object.freeze(o);
  for (const key of Object.keys(o)) {
    deepFreeze((o as Record<string, unknown>)[key], seen, depth + 1);
  }
}