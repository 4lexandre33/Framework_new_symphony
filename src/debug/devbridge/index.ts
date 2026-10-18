/**
 * Entrada do DevBridge (só DEV). O bootstrap faz
 * `if (import.meta.env.DEV) { await import("../debug/devbridge") }`, então
 * nada daqui entra no bundle de produção.
 *
 * Liga somente com URL + token explícitos:
 *   ?devbridge=ws://127.0.0.1:47100&devtoken=<token>
 * ou VITE_DEVBRIDGE_URL / VITE_DEVBRIDGE_TOKEN. URL fora de loopback/ws: é
 * recusada com console.warn.
 */
import { KERNEL_API_VERSION, type Plugin } from "@core";
import type { EngineServices } from "../../app/EngineServices";
import { EventCapture, LogCapture } from "./capture";
import { DevBridge, type DevBridgeSocketFactory, type DevBridgeState } from "./DevBridge";
import { createDevBridgeMethods, type DevBridgeKernelLike } from "./methods";
import { createDevBridgePlugin } from "./plugin";
import { isLoopbackDevBridgeUrl, isValidDevBridgeToken } from "./protocol";

export { DevBridge } from "./DevBridge";
export type { DevBridgeSocket, DevBridgeSocketFactory, DevBridgeState, DevBridgeOptions } from "./DevBridge";
export { createDevBridgeMethods, DevBridgeMethodError } from "./methods";
export type { DevBridgeRuntime, DevBridgeMethodTable } from "./methods";
export { EventCapture, LogCapture, RingBuffer, toJsonSafe } from "./capture";
export { createDevBridgePlugin, DEVBRIDGE_PLUGIN_ID } from "./plugin";
export * from "./protocol";

export interface DevBridgeConfig {
  readonly url: string;
  readonly token: string;
  readonly project: string | null;
}

export interface DevBridgeConfigSources {
  /** `location.search` (ex.: "?devbridge=…&devtoken=…"). */
  readonly search?: string;
  /** `import.meta.env` (VITE_DEVBRIDGE_URL / VITE_DEVBRIDGE_TOKEN / VITE_PROJECT). */
  readonly env?: Readonly<Record<string, unknown>>;
  readonly warn?: (message: string) => void;
}

/**
 * Lê a configuração. null = desligado (nenhuma URL) ou recusado (URL fora de
 * loopback, token ausente/inválido — esses casos geram aviso).
 */
export function resolveDevBridgeConfig(sources: DevBridgeConfigSources): DevBridgeConfig | null {
  const warn = sources.warn ?? ((message: string) => console.warn(`[DevBridge] ${message}`));
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(sources.search ?? "");
  } catch {
    params = new URLSearchParams();
  }
  const env = sources.env ?? {};
  const envString = (key: string): string | null => {
    const v = env[key];
    return typeof v === "string" && v.length > 0 ? v : null;
  };

  const url = params.get("devbridge") ?? envString("VITE_DEVBRIDGE_URL");
  if (url === null || url.length === 0) return null;
  const token = params.get("devtoken") ?? envString("VITE_DEVBRIDGE_TOKEN");

  if (!isLoopbackDevBridgeUrl(url)) {
    warn(`URL recusada: "${url}". Só ws:// em 127.0.0.1, localhost ou [::1].`);
    return null;
  }
  if (!isValidDevBridgeToken(token)) {
    warn("token ausente ou inválido (devtoken / VITE_DEVBRIDGE_TOKEN: 16 a 256 caracteres [A-Za-z0-9_-.~]).");
    return null;
  }
  const project = params.get("project") ?? envString("VITE_PROJECT");
  return { url, token, project };
}

export interface SetupDevBridgeOptions {
  readonly kernel: DevBridgeKernelLike & { register(plugin: Plugin): void };
  readonly services: EngineServices;
  /** Padrão: `location.search`. */
  readonly search?: string;
  /** Padrão: `import.meta.env`. */
  readonly env?: Readonly<Record<string, unknown>>;
  readonly WebSocketImpl?: DevBridgeSocketFactory;
  /** Padrão: canvas do `game.render` ou o primeiro <canvas> do documento. */
  readonly getCanvas?: () => HTMLCanvasElement | null;
  readonly inputWindow?: EventTarget | null;
  /** Padrão true: envolve console.* e window error/unhandledrejection. */
  readonly captureConsole?: boolean;
  readonly reconnectMinMs?: number;
  readonly reconnectMaxMs?: number;
  readonly heartbeatMs?: number;
  readonly heartbeatTimeoutMs?: number;
  readonly onStateChange?: (state: DevBridgeState) => void;
}

export interface DevBridgeHandle {
  readonly config: DevBridgeConfig;
  readonly logs: LogCapture;
  readonly events: EventCapture;
  /** Conecta (chame depois de `kernel.boot()`). Nunca lança. */
  start(): void;
  /** Desconecta e restaura console/listeners. */
  stop(): void;
  readonly bridge: DevBridge | null;
}

/**
 * Prepara o DevBridge ANTES do `kernel.boot()`: instala a captura de
 * console e registra o plugin de ferramenta. Retorna null se desligado.
 */
export function setupDevBridge(options: SetupDevBridgeOptions): DevBridgeHandle | null {
  try {
    const config = resolveDevBridgeConfig({
      search: options.search ?? (typeof location !== "undefined" ? location.search : ""),
      env: options.env ?? ((import.meta as unknown as { env?: Record<string, unknown> }).env ?? {}),
    });
    if (config === null) return null;

    const logs = new LogCapture();
    const events = new EventCapture();
    if (options.captureConsole !== false) logs.install();

    const pluginHandle = createDevBridgePlugin({
      events,
      getWorld: () => options.services.world,
      getCamera: () => options.services.camera,
    });
    options.kernel.register(pluginHandle.plugin);

    const getCanvas = options.getCanvas ?? ((): HTMLCanvasElement | null => {
      try {
        const canvas = pluginHandle.getRender()?.getCanvas() ?? null;
        if (canvas !== null) return canvas;
      } catch {
        // render sem canvas
      }
      return typeof document !== "undefined" ? document.querySelector("canvas") : null;
    });

    const methods = createDevBridgeMethods({
      kernel: options.kernel,
      services: options.services,
      getLoop: () => pluginHandle.getLoop(),
      getRender: () => pluginHandle.getRender(),
      request: (type, payload) => pluginHandle.request(type, payload),
      getCanvas,
      getFollowTargetId: () => pluginHandle.getFollowTargetId(),
      setFollowTargetId: (id) => pluginHandle.setFollowTargetId(id),
      getLastSceneError: () => pluginHandle.getLastSceneError(),
      logs,
      events,
      inputWindow: options.inputWindow !== undefined ? options.inputWindow : typeof window !== "undefined" ? window : null,
    });

    let bridge: DevBridge | null = null;
    const handle: DevBridgeHandle = {
      config,
      logs,
      events,
      get bridge() {
        return bridge;
      },
      start(): void {
        try {
          if (bridge !== null) return;
          bridge = new DevBridge({
            url: config.url,
            token: config.token,
            project: config.project,
            kernelApiVersion: KERNEL_API_VERSION,
            methods,
            WebSocketImpl: options.WebSocketImpl,
            reconnectMinMs: options.reconnectMinMs,
            reconnectMaxMs: options.reconnectMaxMs,
            heartbeatMs: options.heartbeatMs,
            heartbeatTimeoutMs: options.heartbeatTimeoutMs,
            onStateChange: options.onStateChange,
          });
          bridge.start();
        } catch (error) {
          console.warn("[DevBridge] falha ao iniciar:", error);
        }
      },
      stop(): void {
        try {
          bridge?.stop();
        } finally {
          logs.uninstall();
        }
      },
    };
    pluginHandle.onDispose(() => handle.stop());
    return handle;
  } catch (error) {
    console.warn("[DevBridge] desligado por erro na preparação:", error);
    return null;
  }
}
