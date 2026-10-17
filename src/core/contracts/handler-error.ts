/**
 * G30: falhas de handlers são OBSERVÁVEIS.
 *
 * Toda exceção lançada por um handler de evento (`ctx.events.on/onAny`),
 * de command (`ctx.commands.handle`) ou de query (`ctx.queries.answer`)
 * é reportada como um `HandlerErrorInfo`:
 *
 * - pelo hook `KernelOptions.onHandlerError` (síncrono, chamado primeiro);
 * - pelo evento de sistema `kernel.handler.error` (assíncrono).
 *
 * O barramento nunca cai por causa disso: os demais handlers do mesmo
 * evento continuam rodando. Uma falha num handler de `kernel.handler.error`
 * NÃO gera outro `kernel.handler.error` (sem recursão), só log + hook.
 */
export type HandlerErrorKind = "event" | "command" | "query";

export interface HandlerErrorInfo {
  /** Plugin dono do handler que lançou. */
  readonly pluginId: string;
  readonly kind: HandlerErrorKind;
  /** Tipo do evento/command/query que estava sendo tratado. */
  readonly type: string;
  /** Plugin que emitiu/enviou o envelope. */
  readonly source: string;
  /** `seq` do envelope (correlação com logs/devtools). */
  readonly seq: number;
  /** Mensagem do erro (`String(err)` para não-Error). */
  readonly message: string;
  /** Erro original (só no hook; o evento carrega apenas a mensagem/stack). */
  readonly error: unknown;
  readonly stack?: string;
}

/** Payload serializável de `kernel.handler.error` (sem o erro original). */
export interface HandlerErrorEventPayload {
  readonly pluginId: string;
  readonly kind: HandlerErrorKind;
  readonly type: string;
  readonly source: string;
  readonly seq: number;
  readonly message: string;
  readonly stack?: string;
}

export type HandlerErrorHook = (info: HandlerErrorInfo) => void;
