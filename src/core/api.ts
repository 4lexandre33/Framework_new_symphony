import { Kernel } from "./kernel";
import type { Plugin } from "./contracts/plugin-context";
import type { KernelOptions } from "./kernel-types";

let singleton: Kernel | null = null;

/**
 * Kernel singleton — atalho para o app rodando.
 *
 * O singleton é útil em produção (uma instância por processo); para testes,
 * multi-instância, ou controle explícito de ciclo de vida, use `createKernel`.
 *
 * Se chamado duas vezes com opções diferentes, a segunda chamada devolve o
 * kernel já criado (as opções são ignoradas). Isso é intencional: quem precisa
 * de isolamento chama `createKernel` diretamente.
 */
export function getKernel(options?: KernelOptions): Kernel {
  if (!singleton) singleton = new Kernel({ tolerant: true, ...options });
  return singleton;
}

/**
 * Cria um kernel novo, isolado. Não toca no singleton nem é afetado por ele.
 * Use em testes, em múltiplas instâncias por processo, ou quando o caller
 * quer controlar `KernelOptions` explicitamente.
 */
export function createKernel(options: KernelOptions = {}): Kernel {
  return new Kernel(options);
}

/**
 * Boot do singleton com a lista de plugins. Conveniência para o entrypoint
 * da aplicação: registra tudo e chama `boot()`.
 */
export async function bootKernel(plugins: readonly Plugin[]): Promise<Kernel> {
  const k = getKernel();
  for (const p of plugins) k.register(p);
  await k.boot();
  return k;
}

/** Zera o singleton. Só para testes. */
export function resetKernelForTests(): void {
  singleton = null;
}