// src/core/kernel.ts
//
// CHANGED: imports consolidados via `./runtime` (barrel) e `./contracts`.
// Zero mudança de comportamento.

import type {
  Plugin,
  Middleware,
  Envelope,
  EventDefinition,
} from "./contracts";
import type {
  KernelOptions,
  KernelStatus,
  KernelState as KernelStatePublic,
} from "./kernel-types";

import { KERNEL_API_VERSION, SYSTEM_EVENTS } from "./contracts";

import {
  createKernelState,
  register as registerRuntime,
  boot as bootRuntime,
  stop as stopRuntime,
  replace as replaceRuntime,
  install as installRuntime,
  uninstall as uninstallRuntime,
  disposePlugin as disposePluginRuntime,
  snapshot as snapshotRuntime,
  createTestHooks,
  type KernelState,
  type TestHooks,
} from "./runtime";

import { inspect as inspectImpl } from "./api/devtools";

export { KERNEL_API_VERSION };
export type {
  KernelOptions,
  KernelState,
  KernelPluginSnapshot,
  KernelStatus,
} from "./kernel-types";

/**
 * Fachada pública do kernel. Toda a lógica vive em `runtime/*`.
 *
 * Este ficheiro só: (a) constrói o estado na primeira chamada, (b) cola
 * o `Kernel` ao `KernelState`, (c) expõe getters. Nenhuma decisão de
 * lifecycle, capability ou contrato acontece aqui — se acontecer, é bug
 * da refatoração.
 */
export class Kernel {
  private readonly s: KernelState;
  private readonly hooks: TestHooks;

  constructor(opts: KernelOptions = {}) {
    this.s = createKernelState(opts);

    for (const def of SYSTEM_EVENTS) {
      try {
        this.s.eventRegistry.define("kernel", def as EventDefinition);
      } catch {
        /* duplicata — o primeiro vence */
      }
    }

    this.hooks = createTestHooks(this.s);
  }

  get status(): KernelStatus {
    return this.s.status;
  }

  get bootOrder(): readonly string[] {
    return this.s.bootOrder;
  }

  use(mw: Middleware): () => void {
    return this.s.middleware.use(mw);
  }

  /**
   * Pré-registra core tokens (@tokens/*) sob owner "kernel".
   * O bootstrap chama isto imediatamente após criar o kernel.
   */
  registerCoreTokens(tokens: readonly unknown[]): void {
    this.s.registerCoreTokens(tokens);
  }

  register(plugin: Plugin): void {
    registerRuntime(this.s, plugin);
  }

  boot(): Promise<void> {
    return bootRuntime(this.s);
  }

  stop(): Promise<void> {
    return stopRuntime(this.s);
  }

  replace(id: string, plugin: Plugin): Promise<void> {
    return replaceRuntime(this.s, id, plugin);
  }

  install(plugin: Plugin): Promise<void> {
    return installRuntime(this.s, plugin);
  }

  uninstall(id: string): Promise<void> {
    return uninstallRuntime(this.s, id);
  }

  disposePlugin(id: string): Promise<void> {
    return disposePluginRuntime(this.s, id);
  }

  snapshot(): KernelStatePublic {
    return snapshotRuntime(this.s);
  }

  /**
   * Introspecção read-only. Preferir sobre `__internal()`.
   */
  inspect(): import("./api/devtools").KernelInspection {
    return inspectImpl(this);
  }

  /**
   * @deprecated Use `inspect()` para leitura ou métodos públicos
   * específicos. Este acesso expõe o KernelState mutável e contorna
   * todos os contratos. Permitido apenas em devtools e testes.
   */
  __internal() {
    return {
      options: this.s.options,
      registry: this.s.registry,
      capabilities: this.s.capabilities,
      slots: this.s.slots,
      serviceTokens: this.s.serviceTokens,
      state: this.s,
    };
  }

  /** @internal */
  __testSubscribe(cb: (env: Envelope) => void): () => void {
    return this.hooks.subscribe(cb);
  }

  /** @internal */
  __testSubscribeEmit(env: Envelope): void {
    this.hooks.push(env);
  }
}