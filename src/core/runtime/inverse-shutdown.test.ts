import { describe, expect, it } from "vitest";
import { Kernel } from "../kernel";
import { defineCapability } from "../contracts/capability-token";
import type { Plugin, PluginContext } from "../contracts/plugin-context";

interface LivenessApi {
  isAlive(): boolean;
}

interface DependencyObservation {
  readonly consumerId: string;
  readonly dependencyId: string;
  readonly phase: "onStop" | "dispose";
  readonly alive: boolean;
}

const ACapability = defineCapability<LivenessApi>(
  "test.inverse-shutdown.a",
  "1.0.0",
);

const BCapability = defineCapability<LivenessApi>(
  "test.inverse-shutdown.b",
  "1.0.0",
);

function recordDependencyLiveness(
  observations: DependencyObservation[],
  consumerId: string,
  dependencyId: string,
  phase: DependencyObservation["phase"],
  resolve: () => LivenessApi,
): void {
  let alive = false;

  try {
    alive = resolve().isAlive();
  } catch {
    alive = false;
  }

  observations.push({
    consumerId,
    dependencyId,
    phase,
    alive,
  });
}

function createPluginA(
  trace: string[],
): Plugin {
  let alive = true;

  return {
    manifest: {
      id: "test.inverse-shutdown.a",
      name: "Inverse Shutdown A",
      version: "1.0.0",
      api: "^1.0.0",
      kind: "internal",
      permissions: {
        capabilities: [ACapability.id],
      },
      capabilities: {
        provides: [
          {
            id: ACapability.id,
            version: "1.0.0",
          },
        ],
      },
      lifecycleHooks: {
        onStop(): void {
          trace.push("stop:A");
        },
      },
    },

    setup(ctx: PluginContext): void {
      trace.push("boot:A");

      ctx.caps.provide(ACapability, {
        isAlive(): boolean {
          return alive;
        },
      });

      ctx.lifecycle.onDispose((): void => {
        trace.push("dispose:A");
        alive = false;
      });

      ctx.lifecycle.ready();
    },
  };
}

function createPluginB(
  trace: string[],
  observations: DependencyObservation[],
): Plugin {
  let alive = true;

  return {
    manifest: {
      id: "test.inverse-shutdown.b",
      name: "Inverse Shutdown B",
      version: "1.0.0",
      api: "^1.0.0",
      kind: "internal",
      dependsOn: [
        {
          id: "test.inverse-shutdown.a",
          range: "^1.0.0",
        },
      ],
      permissions: {
        capabilities: [
          ACapability.id,
          BCapability.id,
        ],
      },
      capabilities: {
        provides: [
          {
            id: BCapability.id,
            version: "1.0.0",
          },
        ],
        consumes: [
          {
            id: ACapability.id,
            range: "^1.0.0",
            optional: false,
          },
        ],
      },
      lifecycleHooks: {
        onStop(ctx: PluginContext): void {
          trace.push("stop:B");
          recordDependencyLiveness(
            observations,
            "B",
            "A",
            "onStop",
            () => ctx.caps.require(ACapability),
          );
        },
      },
    },

    setup(ctx: PluginContext): void {
      trace.push("boot:B");

      ctx.caps.provide(BCapability, {
        isAlive(): boolean {
          return alive;
        },
      });

      ctx.lifecycle.onDispose((): void => {
        trace.push("dispose:B");
        recordDependencyLiveness(
          observations,
          "B",
          "A",
          "dispose",
          () => ctx.caps.require(ACapability),
        );
        alive = false;
      });

      ctx.lifecycle.ready();
    },
  };
}

function createPluginC(
  trace: string[],
  observations: DependencyObservation[],
): Plugin {
  return {
    manifest: {
      id: "test.inverse-shutdown.c",
      name: "Inverse Shutdown C",
      version: "1.0.0",
      api: "^1.0.0",
      kind: "internal",
      dependsOn: [
        {
          id: "test.inverse-shutdown.b",
          range: "^1.0.0",
        },
      ],
      permissions: {
        capabilities: [BCapability.id],
      },
      capabilities: {
        consumes: [
          {
            id: BCapability.id,
            range: "^1.0.0",
            optional: false,
          },
        ],
      },
      lifecycleHooks: {
        onStop(ctx: PluginContext): void {
          trace.push("stop:C");
          recordDependencyLiveness(
            observations,
            "C",
            "B",
            "onStop",
            () => ctx.caps.require(BCapability),
          );
        },
      },
    },

    setup(ctx: PluginContext): void {
      trace.push("boot:C");

      ctx.lifecycle.onDispose((): void => {
        trace.push("dispose:C");
        recordDependencyLiveness(
          observations,
          "C",
          "B",
          "dispose",
          () => ctx.caps.require(BCapability),
        );
      });

      ctx.lifecycle.ready();
    },
  };
}

describe("inverse shutdown", () => {
  it("preserva BOOT A -> B -> C e STOP C -> B -> A", async () => {
    const trace: string[] = [];
    const observations: DependencyObservation[] = [];
    const kernel = new Kernel();

    kernel.register(createPluginC(trace, observations));
    kernel.register(createPluginB(trace, observations));
    kernel.register(createPluginA(trace));

    await kernel.boot();

    expect(kernel.bootOrder).toEqual([
      "test.inverse-shutdown.a",
      "test.inverse-shutdown.b",
      "test.inverse-shutdown.c",
    ]);

    expect(trace).toEqual([
      "boot:A",
      "boot:B",
      "boot:C",
    ]);

    await kernel.stop();

    expect(trace).toEqual([
      "boot:A",
      "boot:B",
      "boot:C",
      "stop:C",
      "stop:B",
      "stop:A",
      "dispose:C",
      "dispose:B",
      "dispose:A",
    ]);

    expect(kernel.status).toBe("stopped");
  });

  it("mantém dependências vivas durante onStop e dispose dos consumidores", async () => {
    const trace: string[] = [];
    const observations: DependencyObservation[] = [];
    const kernel = new Kernel();

    kernel.register(createPluginA(trace));
    kernel.register(createPluginB(trace, observations));
    kernel.register(createPluginC(trace, observations));

    await kernel.boot();
    await kernel.stop();

    expect(observations).toEqual([
      {
        consumerId: "C",
        dependencyId: "B",
        phase: "onStop",
        alive: true,
      },
      {
        consumerId: "B",
        dependencyId: "A",
        phase: "onStop",
        alive: true,
      },
      {
        consumerId: "C",
        dependencyId: "B",
        phase: "dispose",
        alive: true,
      },
      {
        consumerId: "B",
        dependencyId: "A",
        phase: "dispose",
        alive: true,
      },
    ]);
  });
});