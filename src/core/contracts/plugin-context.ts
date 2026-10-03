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

export interface EventBusApi {
  emit<T extends string, P>(type: T, payload: P): void;
  emitAsync<T extends string, P>(type: T, payload: P): Promise<void>;
  on<T extends string, P>(
    type: T,
    handler: (env: EventEnvelope<T, P>) => void | Promise<void>,
  ): () => void;
  onAny(handler: (env: Envelope) => void | Promise<void>): () => void;
  define(def: EventDefinition): void;
}

// ── Commands ────────────────────────────────────────────────────────────

export interface CommandApi {
  send<T extends string, P>(type: T, payload: P): Promise<void>;
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