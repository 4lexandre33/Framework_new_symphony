import type { CrashReportPayload } from "../../contracts/security/types";

export class CrashReportDumper {
  private crashSequence = 0;

  public generateReport(
    error: Error | string,
    activeSceneId?: string,
  ): CrashReportPayload {
    const timestamp = Date.now();
    const errorMessage = typeof error === "string" ? error : error.message;
    const stackTrace =
      typeof error === "string"
        ? "Stack trace não disponível"
        : error.stack ?? "Stack trace não disponível";

    return {
      crashId: this.createCrashId(timestamp),
      errorMessage,
      stackTrace,
      activeSceneId:
        activeSceneId && activeSceneId.length > 0
          ? activeSceneId
          : "desconhecida",
      webglRenderer: this.detectWebGLRenderer(),
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

  private detectWebGLRenderer(): string {
    if (typeof document === "undefined") {
      return "Headless / Node Environment";
    }

    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");

      if (!gl) {
        return "WebGL Indisponível";
      }

      let renderer = "WebGL Suportado";
      const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");

      if (debugInfo) {
        const detected = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        if (typeof detected === "string" && detected.length > 0) {
          renderer = detected;
        }
      } else {
        const detected = gl.getParameter(gl.RENDERER);
        if (typeof detected === "string" && detected.length > 0) {
          renderer = detected;
        }
      }

      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return renderer;
    } catch {
      return "Erro ao identificar WebGL";
    }
  }
}
