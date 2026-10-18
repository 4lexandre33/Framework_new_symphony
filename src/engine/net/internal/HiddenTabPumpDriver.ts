/**
 * G130: bombeia a rede enquanto a aba/janela está OCULTA.
 *
 * Com `document.hidden` o game loop suspende tick e render, e o pump da rede
 * (que vive neles) para: um host oculto deixava os clientes caírem por
 * timeout. Este driver liga um pulso independente do render só enquanto a
 * página está oculta: um Worker dedicado com `setInterval` (navegadores não
 * estrangulam timers de Worker como os da thread principal em abas ocultas)
 * e, se não houver Worker, um `setInterval` comum (estrangulado a ~1 Hz, ainda
 * abaixo do timeout padrão de 5 s).
 *
 * NÃO faz parte de NETWORKING_RUNTIME_FILES (a política NET004 proíbe timers
 * no runtime de rede); é um driver do plugin `game.net`, que só chama
 * `NetworkService.onRenderFrame()` (no-op quando a rede está offline).
 */

export interface HiddenTabPumpOptions {
  /** Liga o pulso em segundo plano. Padrão true. */
  readonly enabled?: boolean;
  /** Intervalo do pulso (ms) com a página oculta. Padrão 200 (10..1000). */
  readonly intervalMs?: number;
  /** Usa um Worker como relógio (não estrangulado). Padrão true. */
  readonly useWorker?: boolean;
}

/** Ambiente injetável (testes). */
export interface HiddenTabPumpEnvironment {
  readonly document?: Pick<Document, "hidden" | "addEventListener" | "removeEventListener"> | null;
  readonly createWorker?: ((source: string) => Worker | null) | null;
  readonly setInterval?: (handler: () => void, ms: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
}

export type HiddenTabPumpSource = "none" | "worker" | "interval";

const WORKER_SOURCE =
  "let h=null;onmessage=function(e){var ms=e.data;if(h!==null){clearInterval(h);h=null;}" +
  "if(typeof ms==='number'&&ms>0){h=setInterval(function(){postMessage(0);},ms);}};";

function clampInterval(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1000, Math.max(10, Math.trunc(value))) : 200;
}

function defaultCreateWorker(source: string): Worker | null {
  if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return null;
  }

  let url: string | null = null;

  try {
    url = URL.createObjectURL(new Blob([source], { type: "application/javascript" }));
    const worker = new Worker(url);
    const blobUrl = url;
    const originalTerminate = worker.terminate.bind(worker);
    // A URL do Blob vive até o terminate (revogar antes pode abortar a carga).
    return Object.assign(worker, {
      terminate: (): void => {
        originalTerminate();
        URL.revokeObjectURL(blobUrl);
      },
    });
  } catch {
    if (url !== null) {
      URL.revokeObjectURL(url);
    }

    return null;
  }
}

export class HiddenTabPumpDriver {
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private readonly useWorker: boolean;
  private readonly doc: HiddenTabPumpEnvironment["document"];
  private readonly createWorker: (source: string) => Worker | null;
  private readonly setIntervalFn: (handler: () => void, ms: number) => unknown;
  private readonly clearIntervalFn: (handle: unknown) => void;

  private worker: Worker | null = null;
  private workerFailed = false;
  private intervalHandle: unknown = null;
  private activeSource: HiddenTabPumpSource = "none";
  private listening = false;
  private disposed = false;
  private pulseCount = 0;

  private readonly onVisibilityChange = (): void => {
    this.sync();
  };

  private readonly pulse = (): void => {
    if (this.disposed) {
      return;
    }

    this.pulseCount += 1;

    try {
      this.pump();
    } catch {
      // O pump nunca derruba o relógio.
    }
  };

  public constructor(
    private readonly pump: () => void,
    options: HiddenTabPumpOptions = {},
    env: HiddenTabPumpEnvironment = {},
  ) {
    this.enabled = options.enabled !== false;
    this.intervalMs = clampInterval(options.intervalMs);
    this.useWorker = options.useWorker !== false;
    this.doc = env.document !== undefined ? env.document : typeof document === "undefined" ? null : document;
    this.createWorker = env.createWorker === null ? (): null => null : env.createWorker ?? defaultCreateWorker;
    this.setIntervalFn = env.setInterval ?? ((handler, ms): unknown => globalThis.setInterval(handler, ms));
    this.clearIntervalFn = env.clearInterval ?? ((handle): void => globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>));
  }

  /** Começa a observar `visibilitychange` (e já pulsa se a página está oculta). */
  public start(): void {
    if (this.disposed || !this.enabled || this.doc === null || this.doc === undefined || this.listening) {
      return;
    }

    this.doc.addEventListener("visibilitychange", this.onVisibilityChange);
    this.listening = true;
    this.sync();
  }

  /** Fonte do pulso atual (`"none"` com a página visível). */
  public get source(): HiddenTabPumpSource {
    return this.activeSource;
  }

  public get pulses(): number {
    return this.pulseCount;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    if (this.listening && this.doc) {
      this.doc.removeEventListener("visibilitychange", this.onVisibilityChange);
    }

    this.listening = false;
    this.stopPulse();

    if (this.worker !== null) {
      this.worker.onmessage = null;
      this.worker.terminate();
      this.worker = null;
    }
  }

  private sync(): void {
    if (this.disposed) {
      return;
    }

    if (this.doc?.hidden === true) {
      this.startPulse();
    } else {
      this.stopPulse();
    }
  }

  private startPulse(): void {
    if (this.activeSource !== "none") {
      return;
    }

    if (this.useWorker && !this.workerFailed) {
      if (this.worker === null) {
        this.worker = this.createWorker(WORKER_SOURCE);

        if (this.worker === null) {
          this.workerFailed = true;
        } else {
          this.worker.onmessage = this.pulse;
          this.worker.onerror = (): void => {
            this.handleWorkerError();
          };
        }
      }

      if (this.worker !== null) {
        this.worker.postMessage(this.intervalMs);
        this.activeSource = "worker";
        return;
      }
    }

    this.intervalHandle = this.setIntervalFn(this.pulse, this.intervalMs);
    this.activeSource = "interval";
  }

  private stopPulse(): void {
    if (this.activeSource === "worker") {
      this.worker?.postMessage(0);
    } else if (this.activeSource === "interval" && this.intervalHandle !== null) {
      this.clearIntervalFn(this.intervalHandle);
      this.intervalHandle = null;
    }

    this.activeSource = "none";
  }

  /** Worker bloqueado (CSP etc.): cai para o intervalo comum. */
  private handleWorkerError(): void {
    const wasActive = this.activeSource === "worker";
    this.workerFailed = true;

    if (this.worker !== null) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
      this.worker = null;
    }

    this.activeSource = "none";

    if (wasActive && !this.disposed) {
      this.startPulse();
    }
  }
}
