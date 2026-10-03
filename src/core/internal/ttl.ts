import { KernelError, type KernelErrorCode } from "../contracts/errors";

/**
 * Envolve uma promise com timeout. Se `ms <= 0`, retorna a promise original
 * (sem timer). Rejeita com `KernelError(code, msgFn())` quando estoura.
 *
 * O timer é sempre limpo no `finally` — não vaza mesmo se a promise
 * resolver logo.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  msgFn: () => string,
  code: KernelErrorCode = "TIMEOUT",
): Promise<T> {
  if (ms <= 0) return promise;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new KernelError(code, msgFn()));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}