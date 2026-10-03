import type { Schema } from "./schema";

/**
 * Um token é um identificador tipado de "algo que alguém fornece".
 * O `__type` é fantasma — não existe em runtime, só em tipo.
 */
export interface CapabilityToken<T> {
  readonly id: string;
  readonly version: string; // versão do contrato (não do provedor)
  readonly __type?: T;
  /** Schema opcional para validar o valor no `provide()`. */
  readonly schema?: Schema<T>;
}

/**
 * Token assíncrono: o provider pode anexar o valor depois do setup inicial
 * (ex.: abrir PGlite/Postgres antes de expor a capability). O consumidor
 * aguarda com `await ctx.caps.await(token)`.
 */
export interface AsyncCapabilityToken<T> {
  readonly id: string;
  readonly version: string;
  readonly __type?: T;
  readonly __async: true;
  readonly schema?: Schema<T>;
}

export function defineCapability<T>(
  id: string,
  version = "1.0.0",
  schema?: Schema<T>,
): CapabilityToken<T> {
  return schema ? { id, version, schema } : { id, version };
}

export function defineAsyncCapability<T>(
  id: string,
  version = "1.0.0",
  schema?: Schema<T>,
): AsyncCapabilityToken<T> {
  return schema ? { id, version, __async: true, schema } : { id, version, __async: true };
}

/** Type guard: distingue token síncrono de assíncrono em runtime. */
export function isAsyncToken<T>(
  token: CapabilityToken<T> | AsyncCapabilityToken<T>,
): token is AsyncCapabilityToken<T> {
  return (token as AsyncCapabilityToken<T>).__async === true;
}

/** Declaração no manifest: "eu forneço X na versão Y, com prioridade Z". */
export interface CapabilityProvision {
  readonly id: string;
  /** versão concreta da implementação, semver exato */
  readonly version: string;
  /** maior vence quando há múltiplos. default 0. */
  readonly priority?: number;
  /** descrição curta para debug */
  readonly description?: string;
}

/** Declaração no manifest: "eu preciso de X satisfazendo a faixa Y". */
export interface CapabilityRequirement {
  readonly id: string;
  /** range semver: "^1.0.0", ">=2 <3", etc */
  readonly range: string;
  /** se true, ausência não impede boot — capability vira `undefined` */
  readonly optional?: boolean;
}