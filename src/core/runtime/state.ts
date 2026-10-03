// @ai-why:  Fonte de verdade do kernel. Core tokens são injetados pelo bootstrap via registerCoreTokens().
// @ai-link: bootstrap/index.ts, internal/service-token-registry.ts
// @ai-keep: src/core nunca importa @tokens; o bootstrap injeta tokens pela fachada pública.

// src/core/runtime/state.ts
//
// CHANGED:
//   1. Adicionado `serviceTokens: ServiceTokenRegistry` — a fonte de
//      verdade dos tokens (IoC).
//   2. Adicionado `capabilityWaiters: CapabilityWaiters` — substitui o
//      polling de 25ms por notificação.
//   3. Core tokens são registrados sob owner `"kernel"` somente quando
//      o bootstrap chama registerCoreTokens().

import type { KernelOptions, UserPluginConfigs } from "../contracts/kernel-options";
import type { KernelStatus } from "../contracts/kernel-state";
import type { Envelope, EventEnvelope } from "../contracts/envelope";
import type { Logger } from "../contracts/logger";
import type { PluginStorage } from "../contracts/plugin-storage";

import {
  PluginRegistry,
  CapabilityRegistry,
  Resolver,
  SlotRegistry,
  MiddlewareChain,
  EventBus,
  Dispatcher,
  EnvelopeDispatcher,
  TransactionManager,
  ReadinessGate,
  CapabilityWatchers,
  CapabilityWaiters,
  ServiceTokenRegistry,
  isCapabilityToken,
  EmitQueue,
  createLogger,
  freezeEnvelope,
} from "../internal";
import type {
  ResourceScope,
  SchedulerImpl,
  SystemClock,
} from "../internal";

import { EventRegistry } from "../contracts/events/registry";
import { CommandRegistry } from "../contracts/commands/registry";
import { QueryRegistry } from "../contracts/queries/registry";

import { emitThroughPipeline, sendThroughPipeline } from "./pipeline";

const DEFAULT_BOOT_TIMEOUT_MS = 30_000;
const DEFAULT_STOP_TIMEOUT_MS = 15_000;
const DEFAULT_READY_TIMEOUT_MS = 10_000;
const DEFAULT_TTL_MS = 30_000;
const DEFAULT_EMIT_CONCURRENCY = 8;

export type KernelPhase =
  | "idle"
  | "registering"
  | "setup"
  | "resolving"
  | "ready"
  | "running"
  | "stopping"
  | "stopped";

export class KernelState {
  status: KernelStatus = "idle";
  phase: KernelPhase = "idle";
  bootOrder: string[] = [];

  readonly options: KernelOptions;
  readonly tolerant: boolean;
  readonly strict: boolean;
  readonly allowLateRegistration: boolean;
  readonly enforceSlotContributions: boolean;
  readonly bootTimeoutMs: number;
  readonly stopTimeoutMs: number;
  readonly readyTimeoutMs: number;
  readonly defaultTtlMs: number;
  readonly emitConcurrency: number;

  readonly envSource: Readonly<Record<string, string | undefined>>;
  readonly userConfigs: UserPluginConfigs | undefined;
  readonly configs = new Map<string, Readonly<Record<string, unknown>>>();

  readonly registry = new PluginRegistry();
  readonly capabilities: CapabilityRegistry;
  readonly resolver: Resolver;
  readonly slots = new SlotRegistry();
  readonly middleware: MiddlewareChain;
  readonly events: EventBus;
  readonly dispatcher: Dispatcher;
  readonly envelopeDispatcher: EnvelopeDispatcher;
  readonly txManager: TransactionManager;
  readonly readiness = new ReadinessGate();
  readonly capabilityWatchers = new CapabilityWatchers();
  /** NEW: waiters de await (substitui polling). */
  readonly capabilityWaiters = new CapabilityWaiters();
  /** NEW: registry de tokens (Service Locator). */
  readonly serviceTokens = new ServiceTokenRegistry();
  readonly emitQueue: EmitQueue;
  readonly eventRegistry = new EventRegistry();
  readonly commandRegistry = new CommandRegistry();
  readonly queryRegistry = new QueryRegistry();

  readonly scopes = new Map<string, ResourceScope>();
  readonly abortControllers = new Map<string, AbortController>();
  readonly schedulers = new Map<string, SchedulerImpl>();
  readonly clocks = new Map<string, SystemClock>();
  readonly disposers = new Map<string, Array<() => void | Promise<void>>>();
  readonly pluginStorages = new Map<string, PluginStorage>();

  readonly rootLog: Logger;
  readonly testSubscribers = new Set<(env: Envelope) => void>();

  private seq = 0;

  constructor(opts: KernelOptions) {
    this.options = opts;
    this.tolerant = opts.tolerant ?? false;
    this.strict = opts.strict ?? false;
    this.allowLateRegistration = opts.allowLateRegistration ?? false;
    this.enforceSlotContributions = opts.enforceSlotContributions ?? false;

    this.bootTimeoutMs = opts.bootTimeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS;
    this.stopTimeoutMs = opts.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
    this.readyTimeoutMs = opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    this.defaultTtlMs = opts.defaultTtlMs ?? DEFAULT_TTL_MS;
    this.emitConcurrency = Math.max(
      1,
      opts.emitConcurrency ?? DEFAULT_EMIT_CONCURRENCY,
    );

    this.envSource = opts.env ?? {};
    this.userConfigs = opts.configs;

    this.rootLog = createLogger("kernel", opts.logger ?? {});

    this.capabilities = new CapabilityRegistry({
      allowInternalConsumeExternal: opts.allowInternalConsumeExternal ?? false,
    });
    this.resolver = new Resolver(this.capabilities);
    this.middleware = new MiddlewareChain(this.rootLog);
    this.events = new EventBus(this.rootLog, { strict: this.strict });
    this.dispatcher = new Dispatcher(this.rootLog, { strict: this.strict });
    this.envelopeDispatcher = new EnvelopeDispatcher();

    const txSignal = new AbortController().signal;
    this.txManager = new TransactionManager({
      signal: txSignal,
      nextSeq: () => this.nextSeq(),
      freeze: freezeEnvelope,
      emit: (env) => emitThroughPipeline(this, env),
      send: (env) => sendThroughPipeline(this, env, txSignal),
    });

    this.emitQueue = new EmitQueue({
      concurrency: this.emitConcurrency,
      handler: async (env: EventEnvelope) => {
        await emitThroughPipeline(this, env);
      },
      onError: (err, env) => {
        this.rootLog.warn("emit queue handler falhou", {
          err: String(err),
          type: env.type,
        });
      },
    });

  }

  /**
   * Registra core tokens sob owner "kernel". Chamado pelo bootstrap
   * após criar o kernel. O filtro rejeita exports que não são tokens
   * (interfaces, hooks, constantes).
   */
  registerCoreTokens(tokens: readonly unknown[]): void {
    for (const value of tokens) {
      if (isCapabilityToken(value)) {
        try {
          this.serviceTokens.declare("kernel", value);
        } catch {
          // duplicata — o primeiro vence
        }
      }
    }
  }

  nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }
}

export function createKernelState(opts: KernelOptions = {}): KernelState {
  return new KernelState(opts);
}