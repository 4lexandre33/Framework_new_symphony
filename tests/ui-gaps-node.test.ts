// @vitest-environment node

import { describe, expect, it } from "vitest";

import { Kernel, type Plugin } from "@core";

import { createUIPlugin } from "../src/plugins/ui/plugin";
import { UIToken, type UIApi } from "../src/tokens/ui";

describe("G99 — plugin de UI sem DOM (node)", () => {
  it("sobe no Kernel sem document e mantém estado", async () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe("undefined");
    let ui: UIApi | undefined;
    const probe: Plugin = {
      manifest: {
        id: "test.ui-node-probe",
        name: "probe",
        version: "1.0.0",
        kind: "preloaded",
        permissions: { capabilities: [UIToken.id] },
        capabilities: {
          provides: [],
          consumes: [{ id: UIToken.id, range: "^1.0.0", optional: false }],
          conflicts: [],
        },
        lifecycleHooks: {
          onBoot(ctx): void {
            ui = ctx.caps.require(UIToken);
          },
        },
      },
      setup(ctx): void {
        ctx.lifecycle.ready();
      },
    };
    const kernel = new Kernel();
    kernel.register(createUIPlugin());
    kernel.register(probe);
    await kernel.boot();
    expect(ui!.hasDOM).toBe(false);
    ui!.pushModal({ id: "a", title: "A" });
    expect(ui!.activeModalCount).toBe(1);
    ui!.registerDictionary("pt-BR", { k: "v" });
    expect(ui!.translate("k")).toBe("v");
    await kernel.stop();
  });

});
