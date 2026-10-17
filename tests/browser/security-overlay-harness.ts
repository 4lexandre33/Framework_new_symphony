// Harness injetado na página (ver security-overlay-gaps.mjs).
import type { PluginContext } from "@core";
import { SecurityService } from "../../src/engine/security/internal/SecurityService";
import { TauriSecurityDriver } from "../../src/engine/security/internal/TauriSecurityDriver";
import { OverlayService } from "../../src/engine/overlay/internal/OverlayService";
import { TauriOverlayDriver } from "../../src/engine/overlay/internal/TauriOverlayDriver";
import type { CrashReportPayload } from "../../src/contracts/security/types";

function fakeCtx(sink: Array<{ type: string; payload: unknown }>): PluginContext {
  return {
    id: "game.security",
    events: { emit: (type: string, payload: unknown) => sink.push({ type, payload }) },
  } as unknown as PluginContext;
}

const browserSecurityDriver = (): TauriSecurityDriver =>
  new TauriSecurityDriver(async () => { throw new Error("no tauri"); }, () => false);

async function securityPhase(): Promise<Record<string, unknown>> {
  const emitted: Array<{ type: string; payload: unknown }> = [];
  const svc = new SecurityService(fakeCtx(emitted), { driver: browserSecurityDriver(), speedhackDetection: true });

  // G16: erros REAIS do navegador (exceção num timer e promise rejeitada).
  setTimeout(() => { throw new Error("real-window-error"); }, 0);
  void Promise.reject(new Error("real-rejection"));
  await new Promise((r) => setTimeout(r, 100));
  const crashes = emitted
    .filter((e) => e.type === "game.security.crash-generated")
    .map((e) => e.payload as CrashReportPayload);

  // G113: frames reais via requestAnimationFrame.
  svc.resetProfiler();
  await new Promise<void>((resolve) => {
    let n = 0;
    const loop = (): void => {
      svc.recordFrame();
      svc.update(1 / 60);
      n += 1;
      if (n < 40) requestAnimationFrame(loop); else resolve();
    };
    requestAnimationFrame(loop);
  });
  const snap = svc.getProfilerSnapshot();

  // G114: validação por chamador com o relógio real do navegador.
  const v = svc.createClockValidator("browser-check");
  await v.validate();
  await new Promise((r) => setTimeout(r, 200));
  const honest = await v.validate();
  const liar = await svc.validateSystemClock(5000, "browser-check");

  const glContextsCreated = (window as unknown as { __glCount: number }).__glCount;
  svc.dispose();
  return {
    crashSources: crashes.map((c) => c.source),
    crashWritten: crashes.map((c) => c.written),
    crashMessages: crashes.map((c) => c.errorMessage),
    fps: snap.fps,
    windowFrames: snap.windowFrames,
    honestValid: honest.valid,
    honestSource: honest.source,
    liar,
    speedhack: svc.getSpeedhackStatus(),
    glContextsCreated,
  };
}

async function overlayPhase(): Promise<Record<string, unknown>> {
  document.body.innerHTML =
    '<div id="ui-root" style="position:fixed;inset:0;pointer-events:none">' +
    '<button id="menu" style="position:absolute;left:10px;top:10px;width:120px;height:40px;pointer-events:auto">Menu</button>' +
    '<div id="deco" data-overlay-passthrough style="position:absolute;left:200px;top:10px;width:100px;height:40px;pointer-events:auto">decor</div>' +
    "</div>";
  const driver = new TauriOverlayDriver(async () => { throw new Error("no tauri"); }, () => false);
  const svc = new OverlayService(fakeCtx([]), { driver, now: () => performance.now() });
  await svc.initialize();
  (window as unknown as { __overlay?: OverlayService }).__overlay = svc;
  const manualBefore = svc.isPassthroughActive;
  svc.setPassthroughPolicy("auto");
  return { manualBefore, policy: svc.passthroughPolicy, hitMenu: svc.performHitTest(50, 25), hitDeco: svc.performHitTest(250, 25), hitBg: svc.performHitTest(600, 400) };
}

function overlayState(): Record<string, unknown> {
  const svc = (window as unknown as { __overlay?: OverlayService }).__overlay;
  return { passthrough: svc?.isPassthroughActive };
}

(window as unknown as Record<string, unknown>).gaps = { securityPhase, overlayPhase, overlayState };
