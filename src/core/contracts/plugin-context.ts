// @ai-why:  Contrato público do PluginContext. Contém caps (legado) E services (novo).
// @ai-link: runtime/context.ts
// @ai-keep: os dois coexistem. Não remova caps sem migrar consumidores.

// src/core/contracts/plugin-context.ts
//
// CHANGED: adicionado `ServiceApi` (Service Locator) e o campo
// `services` em `PluginContext`. Coexiste com `caps` — consumidores
// existentes seguem funcionando, novos consumidores usam `services`.

import type { Clock } from "./clock";
import type {
  Envelope,
  EventEnvelope,
  CommandEnvelope,
  QueryEnvelope,
} from "./envelope";
import type {
  AsyncCapabilityToken,
  CapabilityToken,
} from "./capability-token";
import type { Scheduler } from "./scheduler";
import type { SlotView } from "./slot";
import type { TransactionApi } from "./transaction";
import type { EventDefinition } from "./typed-event";
import type { CommandDefinition } from "./commands/registry";
import type { QueryDefinition } from "./queries/registry";
import type { Logger } from "./logger";
import type { PluginStorage } from "./plugin-storage";
import type { EnvelopeApi } from "./dispatch-envelope";
import type { ResourceScope } from "../internal";

export type { Logger, PluginStorage, EnvelopeApi };

// ── Env ─────────────────────────────────────────────────────────────────

export interface EnvApi {
  get(key: string): string | undefined;
  has(key: string): boolean;
  require(key: string): string;
}

// ── Handler context ────────────────────────────────────────────────────

export interface HandlerCtx {
  readonly signal: AbortSignal;
}

// ── Events ──────────────────────────────────────────────────────────────

/**
 * Semântica de entrega (G122):
 *
 * - `emit` é FIRE-AND-FORGET por uma fila FIFO de concorrência limitada
 *   (`KernelOptions.emitConcurrency`). Se há vaga na fila, a entrega começa
 *   DENTRO da chamada (a parte síncrona dos handlers pode já ter rodado
 *   quando `emit` retorna); se a fila está cheia (handlers assíncronos em
 *   voo) ou um middleware faz `await` antes de `next()`, os handlers rodam
 *   DEPOIS. Não dependa de nenhum dos dois: trate `emit` como "algum
 *   momento, na ordem de emissão". Exceções de handler NUNCA voltam ao
 *   chamador; são reportadas via `kernel.handler.error` (G30).
 * - `emitAsync` é a opção IMEDIATA: atravessa o pipeline AGORA, sem fila.
 *   Sem middleware que faça `await` antes de `next()`, a parte síncrona de
 *   cada handler roda DENTRO da chamada (antes de `emitAsync` retornar a
 *   Promise), na ordem de inscrição; a Promise resolve quando todos
 *   (inclusive as partes assíncronas) terminam. Para "efeito do handler
 *   antes da próxima linha" use `await ctx.events.emitAsync(...)`. Em
 *   `strict` rejeita se um handler lançar; fora dele nunca rejeita por erro
 *   de handler (só por validação/permissão).
 * - O payload é entregue POR REFERÊNCIA e NÃO é congelado (só o envelope e
 *   `meta` são). Não reutilize/mute o objeto depois de `emit`: handlers
 *   enfileirados o leem depois. Para emitir um snapshot de um objeto que
 *   você vai mutar, use `{ copy: true }` (`structuredClone`, aloca por
 *   chamada — fora de hot paths; lança `DataCloneError` com funções).
 */
export interface EmitOptions {
  /** Clona o payload (`structuredClone`) antes de enfileirar/entregar. */
  readonly copy?: boolean;
}

export interface EventBusApi {
  emit<T extends string, P>(type: T, payload: P, opts?: EmitOptions): void;
  emitAsync<T extends string, P>(type: T, payload: P, opts?: EmitOptions): Promise<void>;
  on<T extends string, P>(
    type: T,
    handler: (env: EventEnvelope<T, P>) => void | Promise<void>,
  ): () => void;
  onAny(handler: (env: Envelope) => void | Promise<void>): () => void;
  define(def: EventDefinition): void;
}

// ── Commands ────────────────────────────────────────────────────────────

export interface CommandApi {
  /**
   * Envia um command à sua autoridade única (G29).
   *
   * - Resolve com o VALOR RETORNADO pelo handler (aguardado se for Promise).
   *   Sem handler registrado (ou envelope parado por middleware) resolve
   *   `undefined`.
   * - REJEITA quando o handler lança (erro original; `PluginError` com
   *   `cause` em `strict`), além de reportar via `kernel.handler.error`.
   * - `R` é só uma anotação do chamador (não há validação de runtime).
   */
  send<T extends string, P, R = unknown>(type: T, payload: P): Promise<R>;
  /**
   * Request/response explícito: como `send`, mas REJEITA com
   * `KernelError("DISPATCH_NO_HANDLER")` se não houver handler, e o tipo do
   * resultado vem primeiro: `ctx.commands.request<LobbyDetails | null>(...)`.
   */
  request<R = unknown, P = unknown>(type: string, payload: P): Promise<R>;
  handle<T extends string, P>(
    type: T,
    handler: (env: CommandEnvelope<T, P>, ctx: HandlerCtx) => unknown | Promise<unknown>,
  ): () => void;
  define(def: CommandDefinition): void;
}

// ── Queries ─────────────────────────────────────────────────────────────

export interface QueryApi {
  ask<T extends string, P, R>(
    type: T,
    payload: P,
    opts?: { fallback?: R },
  ): Promise<R>;
  answer<T extends string, P, R>(
    type: T,
    handler: (env: QueryEnvelope<T, P>, ctx: HandlerCtx) => R | Promise<R>,
  ): () => void;
  define(def: QueryDefinition): void;
}

// ── Capabilities (API legada, mantida) ─────────────────────────────────

export interface CapabilityAwaitOptions {
  readonly timeoutMs?: number;
}

export interface CapabilityDescriptor {
  readonly id: string;
  readonly version: string;
  readonly providers: readonly {
    readonly pluginId: string;
    readonly version: string;
    readonly priority: number;
    readonly description?: string;
  }[];
}

export interface CapabilityApi {
  require<T>(token: CapabilityToken<T>): T;
  await<T>(
    token: CapabilityToken<T> | AsyncCapabilityToken<T>,
    opts?: CapabilityAwaitOptions,
  ): Promise<T>;
  get<T>(token: CapabilityToken<T> | AsyncCapabilityToken<T>): T | undefined;
  provide<T>(
    token: CapabilityToken<T> | AsyncCapabilityToken<T>,
    value: T,
  ): void;
  watch<T>(
    token: CapabilityToken<T> | AsyncCapabilityToken<T>,
    cb: (value: T | undefined) => void,
  ): () => void;
  list(): readonly CapabilityDescriptor[];
  has(id: string): boolean;
  requireById(id: string): unknown;
  getById(id: string): unknown | undefined;
}

// ── Service Locator (novo) ─────────────────────────────────────────────

/**
 * Service Locator do kernel.
 *
 * Contraste com `CapabilityApi`:
 *   - `CapabilityApi` foi pensado para o dono do contrato (com token).
 *   - `ServiceApi` adiciona resolução **por ID** sem importar o token,
 *     o que é o que torna plugins substituíveis sem recompilar.
 *
 * Ambos coexistem. Prefira `ServiceApi` em código novo.
 */
export interface ServiceApi {
  /**
   * Registra um token sob este plugin. O dono do contrato chama isto
   * em `setup()` para que o token fique resolvível por ID.
   *
   * Core tokens (`@tokens/*`) já vêm registrados sob o owner `"kernel"`.
   */
  declare<T>(
    token: CapabilityToken<T> | AsyncCapabilityToken<T>,
  ): () => void;

  /** Resolve por token tipado. Lança CAPABILITY_MISSING se ausente. */
  require<T>(token: CapabilityToken<T>): T;

  /** Resolve por ID string. Sem type-safety, sem import de token. */
  requireById<T = unknown>(id: string): T;

  /** Aguarda token tipado. Usa waiters — não faz polling. */
  await<T>(
    token: CapabilityToken<T> | AsyncCapabilityToken<T>,
  ): Promise<T>;

  /**
   * Aguarda por ID. `timeoutMs` default = `KernelOptions.readyTimeoutMs`.
   */
  awaitById<T = unknown>(id: string, timeoutMs?: number): Promise<T>;

  /**
   * Proxy estável para serviços-objeto. Cada acesso/método resolve o
   * binding atual, portanto continua válido após kernel.replace().
   */
  proxy<T extends object>(
    tokenOrId: CapabilityToken<T> | AsyncCapabilityToken<T> | string,
  ): T;

  /** Snapshot dos tokens registrados. */
  list(): readonly { id: string; version: string; owner: string }[];

  /**
   * Assina mudanças de valor por ID. Devolve cancelador.
   * O callback é chamado imediatamente com o valor atual (ou `undefined`).
   */
  watch<T = unknown>(
    id: string,
    cb: (value: T | undefined) => void,
  ): () => void;
}

// ── Slots ───────────────────────────────────────────────────────────────

export interface SlotApi {
  contribute<T>(slotId: string, value: T, order?: number): () => void;
  read<T = unknown>(slotId: string): SlotView<T>;
  watch<T = unknown>(
    slotId: string,
    cb: (view: SlotView<T>) => void,
  ): () => void;
}

// ── Lifecycle ───────────────────────────────────────────────────────────

export interface LifecycleWhenReadyOptions {
  readonly timeoutMs?: number;
  readonly onTimeout?: (pending: readonly string[]) => void;
}

export interface LifecycleApi {
  onDispose(fn: () => void | Promise<void>): void;
  ready(): void;
  whenReady(opts?: LifecycleWhenReadyOptions): Promise<void>;
  readonly scope: ResourceScope;
  fork(): ResourceScope;
}

// ── Plugin context ──────────────────────────────────────────────────────

export interface PluginContext {
  readonly id: string;
  readonly log: Logger;
  readonly clock: Clock;
  readonly config: Readonly<Record<string, unknown>>;
  readonly env: EnvApi;
  readonly events: EventBusApi;
  readonly commands: CommandApi;
  readonly queries: QueryApi;
  readonly caps: CapabilityApi;
  /** Service Locator. Ver `ServiceApi`. */
  readonly services: ServiceApi;
  readonly slots: SlotApi;
  readonly scheduler: Scheduler;
  readonly tx: TransactionApi;
  readonly lifecycle: LifecycleApi;
  readonly storage: PluginStorage;
  readonly envelope: EnvelopeApi;
}

// ── Plugin ──────────────────────────────────────────────────────────────

export interface Plugin {
  readonly manifest: import("./plugin-manifest").PluginManifest;
  setup(ctx: PluginContext): void | Promise<void>;
}