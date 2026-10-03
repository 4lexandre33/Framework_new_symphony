/**
 * Contratos de dispatch RPC por {capability, method}. Movidos de
 * @tokens/envelope para o core.
 */
export interface CapabilityHandler {
  readonly capability: string;
  readonly version: string;
  readonly method: string;
  readonly provider: string;
  handle(payload: unknown): unknown | Promise<unknown>;
}

export interface DispatchEnvelope {
  readonly capability: string;
  readonly version: string;
  readonly type: string;
  readonly payload: unknown;
}

export type DispatchResult<T = unknown> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export interface EnvelopeApi {
  registerHandler(handler: CapabilityHandler): void;
  dispatch<T = unknown>(envelope: DispatchEnvelope): Promise<DispatchResult<T>>;
}
