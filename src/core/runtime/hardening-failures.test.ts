import { describe, expect, it } from "vitest";
import { Kernel } from "../kernel";
import { defineCapability } from "../contracts/capability-token";
import type { Plugin } from "../contracts/plugin-context";

const Cap = defineCapability<{ value(): string }>("test.cap", "1.0.0");
const manifest = (id: string, extra: Partial<Plugin["manifest"]> = {}): Plugin["manifest"] => ({
  id, name: id, version: "1.0.0", api: "^1.0.0", kind: "internal", ...extra,
});

function provider(id: string, value: string): Plugin {
  return { manifest: manifest(id,{ capabilities:{ provides:[{id:Cap.id,version:"1.0.0"}]}}), setup(ctx){ ctx.caps.provide(Cap,{value:()=>value}); ctx.lifecycle.ready(); } };
}

describe("kernel hardening failures", () => {
  it("dispose recusa plugin com dependsOn obrigatório", async () => {
    const a: Plugin={manifest:manifest("a"),setup(ctx){ctx.lifecycle.ready();}};
    const b: Plugin={manifest:manifest("b",{dependsOn:[{id:"a",range:"^1.0.0"}]}),setup(ctx){ctx.lifecycle.ready();}};
    const k=new Kernel(); k.register(a); k.register(b); await k.boot();
    await expect(k.disposePlugin("a")).rejects.toMatchObject({code:"PLUGIN_HAS_DEPENDENTS"});
    await k.stop();
  });

  it("replace com readiness quebrada faz rollback mesmo tolerant", async () => {
    const k=new Kernel({tolerant:true,readyTimeoutMs:20}); const old=provider("p","old"); k.register(old); await k.boot();
    const bad: Plugin={manifest:old.manifest,setup(ctx){ctx.caps.provide(Cap,{value:()=>"new"}); /* não ready */}};
    await expect(k.replace("p",bad)).rejects.toBeTruthy();
    expect(k.snapshot().plugins.find((p)=>p.id==="p")?.state).not.toBe("failed");
    await k.stop();
  });

  it("replace com onBoot quebrado faz rollback", async () => {
    const k=new Kernel({readyTimeoutMs:100}); const old=provider("p","old"); k.register(old); await k.boot();
    const bad: Plugin={manifest:{...old.manifest,lifecycleHooks:{onBoot(){throw new Error("boom");}}},setup(ctx){ctx.caps.provide(Cap,{value:()=>"new"});ctx.lifecycle.ready();}};
    await expect(k.replace("p",bad)).rejects.toThrow("boom");
    await k.stop();
  });

  it("command possui autoridade única", async () => {
    const k=new Kernel();
    const a: Plugin={manifest:manifest("a"),setup(ctx){ctx.commands.handle("x",()=>{});ctx.lifecycle.ready();}};
    const b: Plugin={manifest:manifest("b"),setup(ctx){expect(()=>ctx.commands.handle("x",()=>{})).toThrow();ctx.lifecycle.ready();}};
    k.register(a);k.register(b);await k.boot();await k.stop();
  });

  it("capability pode fornecer undefined sem ficar pending", async () => {
    const U=defineCapability<undefined>("test.undefined","1.0.0");
    const got: unknown="unset";
    const p: Plugin={manifest:manifest("p",{capabilities:{provides:[{id:U.id,version:"1.0.0"}]}}),setup(ctx){ctx.caps.provide(U,undefined);ctx.lifecycle.ready();}};
    const c: Plugin={manifest:manifest("c",{capabilities:{consumes:[{id:U.id,range:"^1.0.0"}]}}),setup(ctx){ctx.lifecycle.ready();},};
    const k=new Kernel();k.register(p);k.register(c);await k.boot();
    const internal=k.__internal(); expect(internal.state.resolver.getBindingState("c",U.id).status).toBe("resolved");
    await k.stop(); void got;
  });
});
