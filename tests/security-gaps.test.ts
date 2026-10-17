// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { PluginContext, Plugin } from "@core";
import { Kernel } from "../src/core/kernel";
import { FrameProfiler } from "../src/engine/security/internal/FrameProfiler";
import { MemoryIntegrityGuard } from "../src/engine/security/internal/MemoryIntegrityGuard";
import { SpeedhackMonitor } from "../src/engine/security/internal/SpeedhackMonitor";
import { SecurityService } from "../src/engine/security/internal/SecurityService";
import { TauriSecurityDriver } from "../src/engine/security/internal/TauriSecurityDriver";
import { createSecurityPlugin } from "../src/plugins/security/plugin";
import { SecurityToken, type SecurityApi } from "../src/tokens/security";
import type { CrashReportPayload } from "../src/contracts/security/types";

function fakeCtx(): { ctx: PluginContext; emitted: Array<{ type: string; payload: unknown }> } {
  const emitted: Array<{ type: string; payload: unknown }> = [];
  const ctx = {
    id: "game.security",
    events: { emit: (type: string, payload: unknown) => emitted.push({ type, payload }) },
  } as unknown as PluginContext;
  return { ctx, emitted };
}

function browserDriver(now: () => number = Date.now): TauriSecurityDriver {
  return new TauriSecurityDriver(async () => { throw new Error("no tauri"); }, () => false, now);
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

describe("G113 profiler com tempo real, janela móvel e reset", () => {
  it("fps vem do tempo real entre frames (não do delta do tick)", () => {
    let now = 0;
    const p = new FrameProfiler(() => now, 4);
    for (let i = 0; i < 4; i++) { now += 33.333; p.updateFrame(); }
    expect(p.getProfilerSnapshot().fps).toBe(30);
    const { ctx } = fakeCtx();
    const svc = new SecurityService(ctx, { profiler: p, errorTarget: null, speedhackDetection: false, driver: browserDriver() });
    for (let i = 0; i < 100; i++) svc.update(1 / 60); // ticks NÃO mexem no fps
    expect(svc.getProfilerSnapshot().fps).toBe(30);
  });

  it("estatísticas em janela móvel (frames e subsistemas) e resetProfiler", () => {
    let now = 0;
    const p = new FrameProfiler(() => now, 3);
    const measure = (ms: number): void => { p.beginSubsystem("ai"); now += ms; p.endSubsystem("ai"); };
    measure(100); measure(1); measure(1); measure(1);
    const s = p.getProfilerSnapshot().subsystems[0]!;
    expect(s.maxDurationMs).toBe(1); // o pico de 100 saiu da janela
    expect(s.avgDurationMs).toBe(1);
    expect(s.lifetimeMaxDurationMs).toBe(100);
    expect(s.sampleCount).toBe(4);
    now += 10; p.updateFrame(); now += 30; p.updateFrame();
    const snap = p.getProfilerSnapshot();
    // 1º frame mede desde a criação (t=0 → t=113); o 2º, 30ms.
    expect(snap.minFrameTimeMs).toBe(30);
    expect(snap.maxFrameTimeMs).toBe(113);
    expect(snap.windowFrames).toBe(2);
  });

  it("resetProfiler zera tudo", () => {
    let now = 0;
    const p = new FrameProfiler(() => now);
    const { ctx } = fakeCtx();
    const svc = new SecurityService(ctx, { profiler: p, errorTarget: null, speedhackDetection: false, driver: browserDriver() });
    now += 16; svc.recordFrame();
    svc.beginSubsystemMetric("x"); now += 1; svc.endSubsystemMetric("x");
    svc.resetProfiler();
    const snap = svc.getProfilerSnapshot();
    expect(snap.frameIndex).toBe(0);
    expect(snap.subsystems).toHaveLength(0);
  });
});

describe("G114 speedhack: heurísticas, validação por chamador, valores opacos", () => {
  it("tempo simulado à frente do monotônico dispara tick_ahead_of_monotonic", () => {
    let mono = 0;
    const wall = 1_000_000;
    const hits: string[] = [];
    const m = new SpeedhackMonitor({ monotonicNow: () => mono, wallNow: () => wall + mono, cooldownMs: 0, onDetect: (h) => hits.push(h) });
    m.onTick(0);
    for (let i = 0; i < 300; i++) { mono += 1000 / 60 / 2; m.onTick(1 / 60); } // 2x mais rápido
    expect(hits).toContain("tick_ahead_of_monotonic");
    expect(m.getStatus().lastTickRatio).toBeGreaterThan(1.5);
  });

  it("loop normal (ou perdendo tempo) não acusa", () => {
    let mono = 0;
    const hits: string[] = [];
    const m = new SpeedhackMonitor({ monotonicNow: () => mono, wallNow: () => 5000 + mono, onDetect: (h) => hits.push(h) });
    m.onTick(0);
    for (let i = 0; i < 600; i++) { mono += 1000 / 60 + (i % 7 === 0 ? 30 : 0); m.onTick(1 / 60); }
    expect(hits).toEqual([]);
    expect(m.getStatus().windowsEvaluated).toBeGreaterThan(3);
  });

  it("salto isolado do relógio de parede é ajuste; desvio sustentado é speedhack", () => {
    let mono = 0;
    let wall = 0;
    const hits: string[] = [];
    const m = new SpeedhackMonitor({ monotonicNow: () => mono, wallNow: () => wall, cooldownMs: 0, onDetect: (h) => hits.push(h) });
    const step = (wallRate: number, jump = 0): void => { mono += 1000 / 60; wall += (1000 / 60) * wallRate + jump; m.onTick(1 / 60); };
    m.onTick(0);
    for (let i = 0; i < 260; i++) step(1, i === 60 ? 3_600_000 : 0); // ajuste de hora
    expect(hits).toEqual([]);
    expect(m.getStatus().wallClockAdjustments).toBe(1);
    for (let i = 0; i < 400; i++) step(0.5); // performance.now 2x mais rápido que Date.now
    expect(hits).toContain("monotonic_vs_wall_drift");
  });

  it("desvio JS vs Instant nativo dispara js_vs_native_drift", async () => {
    let mono = 0;
    const hits: string[] = [];
    const m = new SpeedhackMonitor({
      monotonicNow: () => mono, wallNow: () => mono, cooldownMs: 0, windowMs: 1000,
      nativeDelta: async () => 500, // nativo só viu 500ms por janela
      onDetect: (h) => hits.push(h),
    });
    m.onTick(0); await flush();
    for (let w = 0; w < 3; w++) {
      for (let i = 0; i < 61; i++) { mono += 1000 / 60; m.onTick(1 / 60); }
      await flush();
    }
    expect(hits).toContain("js_vs_native_drift");
    expect(m.getStatus().nativeAvailable).toBe(true);
  });

  it("validateSystemClock é por chamador e no navegador compara com Date.now (não passa sempre)", async () => {
    let wall = 1000;
    const { ctx, emitted } = fakeCtx();
    const svc = new SecurityService(ctx, { errorTarget: null, speedhackDetection: false, driver: browserDriver(() => wall) });
    expect(await svc.validateSystemClock(0, "a")).toBe(true); // baseline de "a"
    wall += 500;
    expect(await svc.validateSystemClock(0, "b")).toBe(true); // baseline de "b", não afeta "a"
    wall += 500;
    expect(await svc.validateSystemClock(1000, "a")).toBe(true);
    wall += 1000;
    expect(await svc.validateSystemClock(3000, "a")).toBe(false); // diz 3s, passou 1s
    expect(emitted.some((e) => e.type === "game.security.alert")).toBe(true);
    expect(await svc.validateSystemClock(1500, "b")).toBe(true); // "b" tem baseline próprio: passou 1500ms
  });

  it("createClockValidator mede o próprio delta", async () => {
    const { ctx } = fakeCtx();
    const svc = new SecurityService(ctx, { errorTarget: null, speedhackDetection: false, driver: browserDriver() });
    const v = svc.createClockValidator("hud");
    expect((await v.validate()).source).toBe("baseline");
    await new Promise((r) => setTimeout(r, 60));
    const r = await v.validate();
    expect(r.source).toBe("wall-clock");
    expect(r.valid).toBe(true);
  });

  it("descritores são opacos: cópia idêntica/forjada é rejeitada; original é congelado", () => {
    const guard = new MemoryIntegrityGuard();
    const d = guard.protectNumber("gold", 10);
    expect(Object.isFrozen(d)).toBe(true);
    expect(guard.readProtectedNumber(d)).toBe(10);
    expect(guard.verifyIntegrity({ ...d })).toBe(false);
    expect(guard.verifyIntegrity(JSON.parse(JSON.stringify(d)))).toBe(false);
    const other = new MemoryIntegrityGuard();
    expect(other.verifyIntegrity(d)).toBe(false);
  });
});

describe("G16/G115 crash capture e dump", () => {
  it("window error / unhandledrejection geram dump automático; opt-out remove", async () => {
    const target = new EventTarget();
    const writes: CrashReportPayload[] = [];
    const driver = browserDriver();
    vi.spyOn(driver, "writeCrashDump").mockImplementation(async (r) => { writes.push(r); return { written: true, path: "/x/" + r.crashId }; });
    const { ctx, emitted } = fakeCtx();
    const svc = new SecurityService(ctx, { errorTarget: target, speedhackDetection: false, driver });
    const ev = new Event("error") as Event & { error?: unknown };
    ev.error = new Error("boom-window");
    target.dispatchEvent(ev);
    const rej = new Event("unhandledrejection") as Event & { reason?: unknown };
    rej.reason = "rejeitada";
    target.dispatchEvent(rej);
    await flush();
    expect(writes.map((w) => w.source)).toEqual(["window.error", "unhandledrejection"]);
    const gen = emitted.filter((e) => e.type === "game.security.crash-generated").map((e) => e.payload as CrashReportPayload);
    expect(gen[0]).toMatchObject({ written: true, errorMessage: "boom-window" });

    svc.setCrashCaptureEnabled(false);
    target.dispatchEvent(ev);
    await flush();
    expect(writes).toHaveLength(2);
    svc.dispose();
  });

  it("sem Tauri: resolve com written=false e writeError; limite por sessão", async () => {
    const { ctx } = fakeCtx();
    const svc = new SecurityService(ctx, { errorTarget: null, speedhackDetection: false, driver: browserDriver(), maxCrashDumpsPerSession: 1 });
    const a = await svc.dumpCrashReport("x");
    expect(a.written).toBe(false);
    expect(a.writeError).toMatch(/Tauri/);
    const b = await svc.dumpCrashReport("y");
    expect(b.writeError).toMatch(/limite/);
  });

  it("resultado real da escrita nativa (path) e cena do world; sem criar contexto WebGL", async () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    const calls: Array<{ cmd: string; args: Record<string, unknown> | undefined }> = [];
    const driver = new TauriSecurityDriver(async <T,>(cmd: string, args?: Record<string, unknown>) => {
      calls.push({ cmd, args });
      return { written: true, path: "/logs/crash-dumps/jogo/a.dmp.json", removed: 0 } as T;
    }, () => true);
    const { ctx } = fakeCtx();
    const svc = new SecurityService(ctx, {
      errorTarget: null, speedhackDetection: false, driver, crashNamespace: "jogo", maxCrashDumpFiles: 5,
      sceneIdProvider: () => "fase_2",
    });
    const r = await svc.dumpCrashReport(new Error("e"));
    expect(r).toMatchObject({ written: true, path: "/logs/crash-dumps/jogo/a.dmp.json", activeSceneId: "fase_2" });
    expect(calls[0]!.args).toMatchObject({ namespace: "jogo", maxFiles: 5 });
    expect(getContext).not.toHaveBeenCalled();
    getContext.mockRestore();
  });

  it("integração: erro em handler de outro plugin vira crash report via kernel.handler.error", async () => {
    let security: SecurityApi | undefined;
    let probe: PluginContext | undefined;
    const loop: Plugin = { manifest: { id: "game.loop", name: "loop", version: "1.0.0", api: "^1.0.0", kind: "internal" }, setup(c) { c.lifecycle.ready(); } };
    const other: Plugin = {
      manifest: { id: "probe", name: "probe", version: "1.0.0", api: "^1.0.0", kind: "internal", capabilities: { consumes: [{ id: SecurityToken.id, range: "^1.0.0" }] } },
      setup(c) { probe = c; c.events.on("probe.evt", () => { throw new Error("handler-boom"); }); c.lifecycle.ready(); },
    };
    const k = new Kernel({ configs: { "game.security": { speedhackDetection: false } } });
    k.register(loop); k.register(createSecurityPlugin()); k.register(other);
    await k.boot();
    security = probe!.caps.get(SecurityToken);
    const reports: CrashReportPayload[] = [];
    probe!.events.on("game.security.crash-generated", (e) => { reports.push(e.payload as CrashReportPayload); });
    probe!.events.emit("probe.evt", {});
    await flush(); await flush();
    expect(security?.isCrashCaptureEnabled()).toBe(true);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ source: "kernel.handler" });
    expect(reports[0]!.errorMessage).toMatch(/probe.*handler-boom/);
    await k.stop();
  });
});
