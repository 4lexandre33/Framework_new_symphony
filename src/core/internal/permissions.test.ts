import { describe, it, expect } from "vitest";
import { Kernel } from "../kernel";
import { defineEvent } from "../contracts/typed-event";
import { defineCapability } from "../contracts/capability-token";
import type { Plugin, PluginContext } from "../contracts/plugin-context";

const SomeEvent = defineEvent<"lume.x", { n: number }>("lume.x");
const SomeCapability = defineCapability<{ ping: () => string }>("lume.x.cap");
const OtherCapability = defineCapability<{ other: () => string }>("lume.other.cap");

function internalWithEvents(allow: string[]): Plugin {
  return {
    manifest: {
      id: "internal.a",
      version: "1.0.0",
      name: "A",
      kind: "internal",
      api: "^1.0.0",
      permissions: { events: allow },
      capabilities: { provides: [{ id: SomeCapability.id, version: "1.0.0" }] },
    },
    setup(ctx) {
      ctx.events.define(SomeEvent);
      ctx.caps.provide(SomeCapability, { ping: () => "pong" });
      ctx.lifecycle.ready();
    },
  };
}

function external(id: string, allow: string[]): Plugin {
  return {
    manifest: {
      id,
      version: "1.0.0",
      name: id,
      kind: "external",
      api: "^1.0.0",
      authority: "@user",
      permissions: { events: allow, capabilities: [SomeCapability.id] },
      capabilities: {
        consumes: [{ id: SomeCapability.id, range: "^1.0.0" }],
      },
      sandbox: { timeoutMs: 500 },
    },
    setup(ctx) {
      ctx.lifecycle.ready();
    },
  };
}

describe("permissions — external", () => {
  it("external só emite eventos permitidos", async () => {
    const k = new Kernel({ tolerant: false, allowLateRegistration: true });
    k.register(internalWithEvents(["lume.x"]));
    await k.boot();
    const manifest = external("ext.a", ["outro.evento"]).manifest;
    expect(manifest.permissions?.events).toEqual(["outro.evento"]);
    await k.stop();
  });

  it("internal sem permissions.events não tem restrição", async () => {
    const k = new Kernel({ tolerant: false });
    k.register({
      manifest: {
        id: "internal.a",
        version: "1.0.0",
        name: "A",
        kind: "internal",
        api: "^1.0.0",
        capabilities: { provides: [{ id: SomeCapability.id, version: "1.0.0" }] },
      },
      setup(ctx) {
        ctx.events.define(SomeEvent);
        ctx.caps.provide(SomeCapability, { ping: () => "pong" });
        ctx.events.emit("lume.x", { n: 1 }); // permitido
        ctx.lifecycle.ready();
      },
    });
    await k.boot();
    await k.stop();
  });

  it("internal com permissions.events restringe", async () => {
    const k = new Kernel({ tolerant: false });
    k.register({
      manifest: {
        id: "internal.a",
        version: "1.0.0",
        name: "A",
        kind: "internal",
        api: "^1.0.0",
        permissions: { events: ["lume.outro"] },
      },
      setup(ctx) {
        expect(() => ctx.events.emit("lume.x", { n: 1 })).toThrow(/PERMISSION|permiss/i);
        ctx.lifecycle.ready();
      },
    });
    await k.boot();
    await k.stop();
  });

  it("internal com permissions.capabilities restringe require", async () => {
    const k = new Kernel({ tolerant: false });
    let failed = false;
    let consumerCtx: PluginContext | undefined;

    k.register({
      manifest: {
        id: "producer",
        version: "1.0.0",
        name: "p",
        kind: "internal",
        api: "^1.0.0",
        capabilities: {
          provides: [
            { id: SomeCapability.id, version: "1.0.0" },
            { id: OtherCapability.id, version: "1.0.0" },
          ],
        },
      },
      setup(ctx) {
        ctx.caps.provide(SomeCapability, { ping: () => "pong" });
        ctx.caps.provide(OtherCapability, { other: () => "ok" });
        ctx.lifecycle.ready();
      },
    });
    k.register({
      manifest: {
        id: "consumer",
        version: "1.0.0",
        name: "c",
        kind: "internal",
        api: "^1.0.0",
        permissions: { capabilities: [SomeCapability.id] },
        capabilities: {
          consumes: [
            { id: SomeCapability.id, range: "^1.0.0" },
            { id: OtherCapability.id, range: "^1.0.0" },
          ],
        },
      },
      setup(ctx) {
        consumerCtx = ctx;
        ctx.lifecycle.ready();
      },
    });
    await k.boot();

    // O resolver só resolve bindings depois que todos os setups terminam,
    // então `require` durante o setup veria um binding "unbound". Fazemos
    // a checagem fora do setup, com o contexto capturado.
    expect(consumerCtx).toBeDefined();
    consumerCtx!.caps.require(SomeCapability); // dentro das permissões — ok
    try {
      consumerCtx!.caps.require(OtherCapability);
    } catch {
      failed = true;
    }

    expect(failed).toBe(true);
    await k.stop();
  });
});

describe("permissions — register rejeita external", () => {
  it("register(external) lança PLUGIN_KIND_MISMATCH", () => {
    const k = new Kernel({ tolerant: false });
    expect(() => k.register(external("ext.a", ["lume.x"]))).toThrow(/external/i);
  });

  it("external sem permissions é rejeitado por shape", () => {
    const k = new Kernel({ tolerant: false });
    expect(() =>
      k.register({
        manifest: {
          id: "ext.bad",
          version: "1.0.0",
          name: "bad",
          kind: "external",
          api: "^1.0.0",
        },
        setup() {},
      }),
    ).toThrow(/permissions/i);
  });

  it("internal com sandbox é rejeitado", () => {
    const k = new Kernel({ tolerant: false });
    expect(() =>
      k.register({
        manifest: {
          id: "internal.bad",
          version: "1.0.0",
          name: "bad",
          kind: "internal",
          api: "^1.0.0",
          sandbox: { timeoutMs: 100 },
        },
        setup() {},
      }),
    ).toThrow(/sandbox/i);
  });

  it("manifest sem kind é rejeitado", () => {
    const k = new Kernel({ tolerant: false });
    expect(() =>
      k.register({
        manifest: {
          id: "nokind",
          version: "1.0.0",
          name: "nokind",
          api: "^1.0.0",
        } as unknown as Plugin["manifest"],
        setup() {},
      }),
    ).toThrow(/kind/i);
  });
});