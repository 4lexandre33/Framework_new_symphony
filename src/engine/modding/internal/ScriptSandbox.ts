import type {
  ScriptSandboxConfig,
} from "../../../contracts/modding/types";

export interface SandboxMessageEnvelope {
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly capabilityId?: string;
}

/** Superfície mínima de Worker (injetável em testes). */
export interface SandboxWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
}

export type SandboxWorkerFactory = (source: string) => SandboxWorkerLike | null;

/**
 * Tipo de mensagem do script → capacidade exigida. O host decide pela
 * TABELA (o `capabilityId` enviado pelo script é ignorado: não é confiável).
 */
const REQUIRED_CAPABILITY: Readonly<Record<string, string>> = {
  log: "log",
  message: "messages",
  "asset-override": "assets",
  error: "log",
};

export const MAX_SANDBOX_MESSAGE_BYTES = 64 * 1024;
export const MAX_SANDBOX_MESSAGES_PER_SECOND = 200;

/** Globais de rede/armazenamento/código removidos do escopo do Worker. */
export const SANDBOX_BLOCKED_GLOBALS = Object.freeze([
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "WebTransport",
  "EventSource",
  "importScripts",
  "indexedDB",
  "caches",
  "BroadcastChannel",
  "Worker",
  "SharedWorker",
  "RTCPeerConnection",
  "navigator",
  "location",
]);

/**
 * Prelúdio executado ANTES do código do mod: remove globais perigosos da
 * cadeia de protótipos, expõe só a API `mod` e sinaliza `__ready` depois
 * que o código avaliou (watchdog de laço infinito na avaliação).
 */
export function buildSandboxSource(modId: string, scriptCode: string): string {
  return `"use strict";
(() => {
  const post = self.postMessage.bind(self);
  const blocked = ${JSON.stringify(SANDBOX_BLOCKED_GLOBALS)};
  let target = self;
  while (target) {
    for (const key of blocked) {
      try { Object.defineProperty(target, key, { value: undefined, writable: false, configurable: false }); } catch (_) {}
    }
    target = Object.getPrototypeOf(target);
  }
  const handlers = new Map();
  const toText = (value) => { try { return typeof value === "string" ? value : JSON.stringify(value); } catch (_) { return String(value); } };
  const api = Object.freeze({
    modId: ${JSON.stringify(modId)},
    log: (...args) => post({ type: "log", payload: { message: args.map(toText).join(" ").slice(0, 2000) } }),
    send: (type, data) => post({ type: "message", payload: { type: String(type), data: data === undefined ? null : data } }),
    registerAssetOverride: (virtualPath, realPath, priority) => post({ type: "asset-override", payload: { virtualPath: String(virtualPath), realPath: String(realPath), priority: Number(priority || 0) } }),
    on: (type, handler) => { if (typeof handler === "function") handlers.set(String(type), handler); },
  });
  Object.defineProperty(self, "mod", { value: api, writable: false, configurable: false });
  self.onmessage = (event) => {
    const data = event && event.data;
    if (!data || typeof data.type !== "string") return;
    const handler = handlers.get(data.type);
    if (!handler) return;
    try { handler(data.payload); } catch (error) { post({ type: "error", payload: { message: String(error) } }); }
  };
})();
try {
${scriptCode}
} catch (error) {
  self.postMessage({ type: "error", payload: { message: String(error && error.message || error) } });
}
self.postMessage({ type: "__ready", payload: {} });
`;
}

function defaultWorkerFactory(): SandboxWorkerFactory | null {
  if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL.createObjectURL !== "function") {
    return null;
  }

  return (source: string): SandboxWorkerLike | null => {
    const url = URL.createObjectURL(new Blob([source], { type: "application/javascript" }));
    try {
      const worker = new Worker(url);
      const originalTerminate = worker.terminate.bind(worker);
      return Object.assign(worker, {
        terminate: (): void => {
          originalTerminate();
          URL.revokeObjectURL(url);
        },
      }) as unknown as SandboxWorkerLike;
    } catch {
      URL.revokeObjectURL(url);
      return null;
    }
  };
}

export interface ScriptSandboxOptions {
  readonly workerFactory?: SandboxWorkerFactory | null;
  readonly modId?: string;
  readonly now?: () => number;
}

/**
 * Sandbox de script de mod em Web Worker (G116): prelúdio que remove rede,
 * armazenamento e carregamento de código; allow-list de capacidades
 * aplicada no host; limites de tamanho/taxa de mensagem; watchdog da
 * avaliação inicial (`maxExecutionTimeMs`). Depois de pronto, o script
 * permanece vivo (handlers `mod.on`) até `terminate()`.
 */
export class ScriptSandbox {
  private worker: SandboxWorkerLike | null = null;
  private executionTimer: ReturnType<typeof setTimeout> | null = null;
  private isRunning = false;
  private ready = false;
  private readonly allowedCapabilities: ReadonlySet<string>;
  private readonly workerFactory: SandboxWorkerFactory | null;
  private readonly now: () => number;
  private windowStart = 0;
  private windowCount = 0;
  /** Último motivo de encerramento forçado (diagnóstico). */
  public lastTerminationReason: string | null = null;

  public constructor(
    private readonly config: ScriptSandboxConfig,
    private readonly options: ScriptSandboxOptions = {},
  ) {
    if (
      !Number.isFinite(config.maxExecutionTimeMs) ||
      config.maxExecutionTimeMs <= 0
    ) {
      throw new Error(
        "ScriptSandboxConfig inválido: maxExecutionTimeMs deve ser maior que zero.",
      );
    }

    this.allowedCapabilities = new Set(
      config.allowedCapabilities
        .map((capability): string => capability.trim())
        .filter((capability): boolean => capability.length > 0),
    );

    this.workerFactory =
      options.workerFactory === undefined ? defaultWorkerFactory() : options.workerFactory;
    this.now = options.now ?? (() => Date.now());
  }

  public get supported(): boolean {
    return this.workerFactory !== null;
  }

  public executeScript(
    scriptCode: string,
    onMessageCallback: (env: SandboxMessageEnvelope) => void,
  ): boolean {
    this.terminate();
    this.lastTerminationReason = null;

    if (typeof scriptCode !== "string" || scriptCode.trim().length === 0) return false;
    if (this.workerFactory === null) return false;

    try {
      const source = buildSandboxSource(this.options.modId ?? "mod", scriptCode);
      const worker = this.workerFactory(source);
      if (!worker) return false;
      this.worker = worker;

      worker.onmessage = (event: MessageEvent<unknown>): void => {
        if (this.worker !== worker) return;

        if (!this.withinRateLimit()) {
          this.forceTerminate("rate_limit");
          return;
        }

        const envelope = this.parseEnvelope(event.data);
        if (!envelope) return;

        if (envelope.type === "__ready") {
          this.ready = true;
          this.clearWatchdog();
          return;
        }

        const required = REQUIRED_CAPABILITY[envelope.type];
        if (required === undefined || !this.allowedCapabilities.has(required)) {
          return;
        }

        onMessageCallback({ type: envelope.type, payload: envelope.payload, capabilityId: required });
      };

      worker.onerror = (error: ErrorEvent): void => {
        if (this.worker !== worker) return;
        this.forceTerminate(`error: ${error?.message ?? "desconhecido"}`);
      };

      this.executionTimer = setTimeout(
        (): void => {
          if (!this.isRunning || this.ready) return;
          this.forceTerminate("timeout");
        },
        this.config.maxExecutionTimeMs,
      );

      this.isRunning = true;
      return true;
    } catch (error: unknown) {
      console.error(
        "[ScriptSandbox] Falha ao criar Web Worker sandbox:",
        error,
      );
      this.terminate();
      return false;
    }
  }

  private withinRateLimit(): boolean {
    const now = this.now();
    if (now - this.windowStart >= 1000) {
      this.windowStart = now;
      this.windowCount = 0;
    }
    this.windowCount += 1;
    return this.windowCount <= MAX_SANDBOX_MESSAGES_PER_SECOND;
  }

  private forceTerminate(reason: string): void {
    this.lastTerminationReason = reason;
    console.warn(`[ScriptSandbox] Script de mod encerrado (${reason}).`);
    this.terminate();
  }

  public postMessage(
    type: string,
    payload: unknown,
  ): boolean {
    if (!this.worker || !this.isRunning || !this.ready) return false;
    if (typeof type !== "string" || type.trim().length === 0) return false;

    try {
      if (JSON.stringify(payload ?? null).length > MAX_SANDBOX_MESSAGE_BYTES) return false;
    } catch {
      return false;
    }

    this.worker.postMessage({ type, payload: payload ?? null });
    return true;
  }

  public isCapabilityAllowed(
    capabilityId: string,
  ): boolean {
    return this.allowedCapabilities.has(capabilityId);
  }

  private clearWatchdog(): void {
    if (this.executionTimer !== null) {
      clearTimeout(this.executionTimer);
      this.executionTimer = null;
    }
  }

  public terminate(): void {
    this.clearWatchdog();

    if (this.worker) {
      const worker = this.worker;
      this.worker = null;
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    }

    this.isRunning = false;
    this.ready = false;
  }

  public get active(): boolean {
    return this.isRunning;
  }

  public get isReady(): boolean {
    return this.ready;
  }

  private parseEnvelope(
    value: unknown,
  ): SandboxMessageEnvelope | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }

    const record = value as Record<string, unknown>;
    if (typeof record.type !== "string" || record.type.trim().length === 0) {
      return null;
    }

    const payload = record.payload;
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return null;
    }

    try {
      if (JSON.stringify(payload).length > MAX_SANDBOX_MESSAGE_BYTES) return null;
    } catch {
      return null;
    }

    return {
      type: record.type,
      payload: payload as Record<string, unknown>,
    };
  }
}
