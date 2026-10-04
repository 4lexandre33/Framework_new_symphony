import type {
  ScriptSandboxConfig,
} from "../../../contracts/modding/types";

export interface SandboxMessageEnvelope {
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly capabilityId?: string;
}

export class ScriptSandbox {
  private worker: Worker | null = null;
  private workerUrl: string | null = null;
  private executionTimer: ReturnType<typeof setTimeout> | null = null;
  private isRunning = false;
  private readonly allowedCapabilities: ReadonlySet<string>;

  public constructor(
    private readonly config: ScriptSandboxConfig,
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
  }

  public executeScript(
    scriptCode: string,
    onMessageCallback: (env: SandboxMessageEnvelope) => void,
  ): boolean {
    this.terminate();

    if (scriptCode.trim().length === 0) return false;
    if (typeof Worker === "undefined") return false;
    if (typeof Blob === "undefined") return false;
    if (typeof URL.createObjectURL !== "function") return false;

    try {
      const blob = new Blob(
        [scriptCode],
        { type: "application/javascript" },
      );

      this.workerUrl = URL.createObjectURL(blob);
      this.worker = new Worker(this.workerUrl);

      this.worker.onmessage = (event: MessageEvent<unknown>): void => {
        const envelope = this.parseEnvelope(event.data);
        if (!envelope) return;

        if (
          envelope.capabilityId !== undefined &&
          !this.allowedCapabilities.has(envelope.capabilityId)
        ) {
          console.warn(
            `[ScriptSandbox] Capability negada ao mod: ${envelope.capabilityId}`,
          );
          return;
        }

        onMessageCallback(envelope);
      };

      this.worker.onerror = (error: ErrorEvent): void => {
        console.error(
          "[ScriptSandbox] Erro de execução em script de mod:",
          error.message,
        );
        this.terminate();
      };

      this.executionTimer = setTimeout(
        (): void => {
          if (!this.isRunning) return;
          console.warn(
            `[ScriptSandbox] Script encerrado após exceder ${this.config.maxExecutionTimeMs}ms.`,
          );
          this.terminate();
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

  public postMessage(
    type: string,
    payload: Record<string, unknown>,
    capabilityId?: string,
  ): boolean {
    if (!this.worker || !this.isRunning) return false;
    if (type.trim().length === 0) return false;

    if (
      capabilityId !== undefined &&
      !this.allowedCapabilities.has(capabilityId)
    ) {
      return false;
    }

    this.worker.postMessage({
      type,
      payload,
      ...(capabilityId ? { capabilityId } : {}),
    });

    return true;
  }

  public isCapabilityAllowed(
    capabilityId: string,
  ): boolean {
    return this.allowedCapabilities.has(capabilityId);
  }

  public terminate(): void {
    if (this.executionTimer !== null) {
      clearTimeout(this.executionTimer);
      this.executionTimer = null;
    }

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    if (this.workerUrl !== null) {
      if (typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(this.workerUrl);
      }
      this.workerUrl = null;
    }

    this.isRunning = false;
  }

  public get active(): boolean {
    return this.isRunning;
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

    const capabilityId = record.capabilityId;
    if (capabilityId !== undefined && typeof capabilityId !== "string") {
      return null;
    }

    return {
      type: record.type,
      payload: payload as Record<string, unknown>,
      ...(capabilityId ? { capabilityId } : {}),
    };
  }
}
