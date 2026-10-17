import type { CrashReportPayload } from "../../../contracts/security/types";

/**
 * Monta o relatório de crash. G115: NÃO cria contexto WebGL (antes cada dump
 * abria um, podendo derrubar o do jogo): o nome da GPU vem de quem chama
 * (contexto já existente do render) ou fica "não coletado".
 */
export class CrashReportDumper {
  private crashSequence = 0;

  public generateReport(
    error: unknown,
    activeSceneId?: string,
    webglRenderer?: string,
  ): CrashReportPayload {
    const timestamp = Date.now();
    const { errorMessage, stackTrace } = describeError(error);

    return {
      crashId: this.createCrashId(timestamp),
      errorMessage,
      stackTrace,
      activeSceneId:
        activeSceneId && activeSceneId.length > 0
          ? activeSceneId
          : "desconhecida",
      webglRenderer:
        webglRenderer && webglRenderer.length > 0
          ? webglRenderer
          : typeof document === "undefined"
            ? "Headless / Node Environment"
            : "não coletado",
      timestamp,
      environment: this.collectEnvironment(),
    };
  }

  private createCrashId(timestamp: number): string {
    this.crashSequence += 1;

    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return `crash_${timestamp}_${crypto.randomUUID()}`;
    }

    return `crash_${timestamp}_${this.crashSequence}`;
  }

  private collectEnvironment(): Record<string, string | number> {
    const environment: Record<string, string | number> = {
      platform:
        typeof navigator !== "undefined" && navigator.platform
          ? navigator.platform
          : "node",
      userAgent:
        typeof navigator !== "undefined" && navigator.userAgent
          ? navigator.userAgent
          : "unknown",
      devicePixelRatio:
        typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio)
          ? window.devicePixelRatio
          : 1,
    };

    if (
      typeof navigator !== "undefined" &&
      Number.isFinite(navigator.hardwareConcurrency)
    ) {
      environment.hardwareConcurrency = navigator.hardwareConcurrency;
    }

    return environment;
  }
}

const NO_STACK = "Stack trace não disponível";
const MAX_MESSAGE = 4096;

function describeError(error: unknown): { errorMessage: string; stackTrace: string } {
  if (typeof error === "string") {
    return { errorMessage: error.slice(0, MAX_MESSAGE), stackTrace: NO_STACK };
  }
  if (error instanceof Error) {
    return {
      errorMessage: (error.message || error.name || String(error)).slice(0, MAX_MESSAGE),
      stackTrace: error.stack ?? NO_STACK,
    };
  }
  let text: string;
  try {
    text = typeof error === "object" && error !== null ? JSON.stringify(error) : String(error);
  } catch {
    text = String(error);
  }
  return { errorMessage: (text ?? "erro desconhecido").slice(0, MAX_MESSAGE), stackTrace: NO_STACK };
}

/**
 * Lê o nome da GPU de um contexto WebGL JÁ EXISTENTE (nunca cria um).
 */
export function readRendererName(gl: WebGLRenderingContext | WebGL2RenderingContext | null | undefined): string | undefined {
  if (!gl) return undefined;
  try {
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const detected = debugInfo
      ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    return typeof detected === "string" && detected.length > 0 ? detected : undefined;
  } catch {
    return undefined;
  }
}
