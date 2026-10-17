import { describe, expect, it } from "vitest";
import { Kernel } from "../src/core/kernel";
import type { Plugin, PluginContext } from "../src/core/contracts/plugin-context";
import type { HandlerErrorInfo, HandlerErrorEventPayload } from "../src/core/contracts/handler-error";
import type { KernelOptions } from "../src/core/contracts/kernel-options";

const manifest = (id: string, extra: Partial<Plugin["manifest"]> = {}): Plugin["manifest"] => ({
  id, name: id, version: "1.0.0", api: "^1.0.0", kind: "internal", ...extra,
});

async function boot(
  setup: (ctx: PluginContext) => void,
  opts: KernelOptions = {},
  extra: Partial<Plugin["manifest"]> = {},
): Promise<{ k: Kernel; ctx: PluginContext }> {
  let captured: PluginContext | undefined;
  const p: Plugin = {
    manifest: manifest("probe", extra),
    setup(ctx) {
      captured = ctx;
      setup(ctx);
      ctx.lifecycle.ready();
    },
  };
  const k = new Kernel(opts);
  k.register(p);
  await k.boot();
  return { k, ctx: captured! };
}

const flush = async (n = 5): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

describe("G29 commands.send entrega o resultado", () => {
  it("resolve com o retorno (sync e async) e undefined sem handler", async () => {
    const { k, ctx } = await boot((c) => {
      c.commands.handle("t.sync", (env) => (env.payload as { n: number }).n * 2);
      c.commands.handle("t.async", async () => ({ id: "lobby-1" }));
    });
    await expect(ctx.commands.send("t.sync", { n: 21 })).resolves.toBe(42);
    const r = await ctx.commands.send<"t.async", object, { id: string }>("t.async", {});
    expect(r.id).toBe("lobby-1");
    await expect(ctx.commands.send("t.none", {})).resolves.toBeUndefined();
    await k.stop();
  });

  it("rejeita quando o handler lança (não-strict: erro original; strict: PluginError)", async () => {
    const boom = new Error("boom");
    const a = await boot((c) => c.commands.handle("t.fail", () => { throw boom; }));
    await expect(a.ctx.commands.send("t.fail", {})).rejects.toBe(boom);
    await a.k.stop();
    const b = await boot((c) => c.commands.handle("t.fail", async () => { throw boom; }), { strict: true });
    await expect(b.ctx.commands.send("t.fail", {})).rejects.toMatchObject({ cause: boom });
    await b.k.stop();
  });

  it("request exige handler e devolve o resultado tipado", async () => {
    const { k, ctx } = await boot((c) => c.commands.handle("t.req", () => "ok"));
    await expect(ctx.commands.request<string>("t.req", {})).resolves.toBe("ok");
    await expect(ctx.commands.request("t.missing", {})).rejects.toMatchObject({ code: "DISPATCH_NO_HANDLER" });
    await k.stop();
  });

  it("middleware com await next() não engole o erro do handler", async () => {
    const { k, ctx } = await boot((c) => c.commands.handle("t.mw", () => { throw new Error("mw-boom"); }));
    k.__internal().state.middleware.use({
      id: "spy", pluginId: "probe",
      async handle(_env: unknown, next: () => Promise<void>) { await next(); },
    } as never);
    await expect(ctx.commands.send("t.mw", {})).rejects.toThrow("mw-boom");
    await k.stop();
  });
});

describe("G30 erros de handler são observáveis", () => {
  it("hook onHandlerError + evento kernel.handler.error com plugin/tipo; bus segue", async () => {
    const hooked: HandlerErrorInfo[] = [];
    const seen: HandlerErrorEventPayload[] = [];
    let secondRan = 0;
    const { k, ctx } = await boot(
      (c) => {
        c.events.on("t.evt", () => { throw new Error("tick-fail"); });
        c.events.on("t.evt", () => { secondRan++; });
        c.events.on("kernel.handler.error", (env) => { seen.push(env.payload as HandlerErrorEventPayload); });
        c.queries.answer("t.q", () => { throw new Error("q-fail"); });
      },
      { onHandlerError: (i) => hooked.push(i) },
    );
    ctx.events.emit("t.evt", {});
    await flush();
    expect(secondRan).toBe(1);
    expect(hooked).toHaveLength(1);
    expect(hooked[0]).toMatchObject({ pluginId: "probe", kind: "event", type: "t.evt", source: "probe", message: "tick-fail" });
    expect(hooked[0]!.error).toBeInstanceOf(Error);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ pluginId: "probe", kind: "event", type: "t.evt" });
    expect((seen[0] as unknown as { error?: unknown }).error).toBeUndefined();

    await expect(ctx.queries.ask("t.q", {})).rejects.toThrow("q-fail");
    await flush();
    expect(seen.map((s) => s.kind)).toEqual(["event", "query"]);
    await k.stop();
  });

  it("handler de kernel.handler.error que lança não gera recursão", async () => {
    let calls = 0;
    const hooked: HandlerErrorInfo[] = [];
    const { k, ctx } = await boot(
      (c) => {
        c.events.on("t.evt", () => { throw new Error("a"); });
        c.events.on("kernel.handler.error", () => { calls++; throw new Error("b"); });
      },
      { onHandlerError: (i) => hooked.push(i) },
    );
    ctx.events.emit("t.evt", {});
    await flush(10);
    expect(calls).toBe(1);
    expect(hooked.map((h) => h.type)).toEqual(["t.evt", "kernel.handler.error"]);
    await k.stop();
  });

  it("hook hostil não derruba o bus", async () => {
    let ran = 0;
    const { k, ctx } = await boot(
      (c) => {
        c.events.on("t.evt", () => { throw new Error("x"); });
        c.events.on("t.evt", () => { ran++; });
      },
      { onHandlerError: () => { throw new Error("hostile"); } },
    );
    await expect(ctx.events.emitAsync("t.evt", {})).resolves.toBeUndefined();
    expect(ran).toBe(1);
    await k.stop();
  });
});

describe("G122 semântica de emit", () => {
  it("emitAsync invoca a parte síncrona dos handlers dentro da chamada; emit enfileira quando a fila está cheia", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { k, ctx } = await boot(
      (c) => {
        c.events.on("t.e", (env) => { order.push((env.payload as { tag: string }).tag); });
        c.events.on("t.slow", async () => { await gate; });
      },
      { emitConcurrency: 1 },
    );
    const p = ctx.events.emitAsync("t.e", { tag: "immediate" });
    order.push("after-emitAsync");
    await p;
    expect(order).toEqual(["immediate", "after-emitAsync"]);
    ctx.events.emit("t.slow", {}); // ocupa a única vaga
    ctx.events.emit("t.e", { tag: "queued" });
    order.push("after-emit");
    release();
    await flush();
    expect(order).toEqual(["immediate", "after-emitAsync", "after-emit", "queued"]);
    await k.stop();
  });

  it("copy:true entrega um snapshot (mutação posterior não vaza)", async () => {
    const got: number[] = [];
    const { k, ctx } = await boot((c) => c.events.on("t.v", (env) => { got.push((env.payload as { x: number }).x); }), { emitConcurrency: 1 });
    // Fila cheia: as entregas acontecem DEPOIS da mutação do chamador.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    k.__internal().state.events.on("probe", "t.slow", async () => { await gate; });
    const vec = { x: 1 };
    ctx.events.emit("t.slow", {});
    ctx.events.emit("t.v", vec, { copy: true });
    ctx.events.emit("t.v", vec);
    vec.x = 99;
    release();
    await flush();
    expect(got).toEqual([1, 99]);
    await k.stop();
  });
});

describe("G21 permissions.events: [] é deny-all explícito com erro acionável", () => {
  it("preloaded com [] não emite e a mensagem diz como corrigir", async () => {
    let err: unknown;
    const { k } = await boot(
      (c) => { try { c.events.emit("t.x", {}); } catch (e) { err = e; } },
      {},
      { kind: "preloaded", permissions: { events: [] } },
    );
    expect(err).toMatchObject({ code: "PERMISSION_DENIED" });
    expect(String((err as Error).message)).toMatch(/NÃO equivale a omitir/);
    expect(String((err as Error).message)).toMatch(/"t\.x"/);
    await k.stop();
  });

  it("preloaded sem o campo emite sem restrição", async () => {
    let err: unknown;
    const { k } = await boot(
      (c) => { try { c.events.emit("t.x", {}); } catch (e) { err = e; } },
      {},
      { kind: "preloaded" },
    );
    expect(err).toBeUndefined();
    await k.stop();
  });
});

describe("G31 payload reutilizado: helpers de cópia + detecção de mutação em DEV", () => {
  it("copyTickPayload/copyRenderPayload/copyViewportDimensions copiam sem alocar com out", async () => {
    const { copyTickPayload, copyRenderPayload } = await import("../src/contracts/game-loop/types");
    const { copyViewportDimensions } = await import("../src/contracts/render/types");
    const out = { deltaSeconds: 0, totalTimeSeconds: 0, tickCount: 0 };
    expect(copyTickPayload({ deltaSeconds: 1 / 60, totalTimeSeconds: 2, tickCount: 3 }, out)).toBe(out);
    expect(out.tickCount).toBe(3);
    expect(copyRenderPayload({ alphaInterpolation: 0.5, deltaSeconds: 0.01, realDeltaSeconds: 0.01, isPaused: false }).alphaInterpolation).toBe(0.5);
    expect(copyViewportDimensions({ width: 10, height: 5, aspectRatio: 2, pixelRatio: 1 }).width).toBe(10);
  });

  it("um handler que muta o payload do tick é detectado (log único) e revertido", async () => {
    const { DeterministicGameLoop } = await import("../src/engine/game-loop/internal/DeterministicGameLoop");
    const errors: string[] = [];
    const seen: number[] = [];
    let cb: ((t: number) => Promise<void>) | null = null;
    let now = 0;
    const timing = {
      now: () => now,
      requestFrame: (c: (t: number) => Promise<void>) => { cb = c; return 1; },
      cancelFrame: () => { cb = null; },
    };
    const ctx = {
      log: { error: (m: string) => errors.push(m) },
      events: {
        async emitAsync(type: string, payload: { tickCount?: number }) {
          if (type === "game.loop.tick") {
            seen.push(payload.tickCount!);
            (payload as { tickCount: number }).tickCount = 999; // abuso
          }
        },
      },
    } as unknown as PluginContext;
    const loop = new DeterministicGameLoop(ctx, timing, true);
    loop.start();
    for (let i = 0; i < 4; i++) {
      const c = cb as ((t: number) => Promise<void>) | null;
      if (!c) break;
      cb = null;
      now += 1000 / 60 + 0.1;
      await c(now);
    }
    loop.stop();
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.every((n, i) => i === 0 || n === seen[i - 1]! + 1)).toBe(true);
    expect(errors.filter((e) => e.includes("MUTOU"))).toHaveLength(1);
  });
});
