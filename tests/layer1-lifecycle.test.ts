// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  Kernel,
  type Plugin,
  type PluginContext,
} from "@core";

function manifest(
  id: string,
  extra:
    Partial<
      Plugin["manifest"]
    > = {},
):
  Plugin["manifest"] {
  return {
    id,
    name:
      id,
    version:
      "1.0.0",
    api:
      "^1.0.0",
    kind:
      "internal",
    ...extra,
  };
}

function resourceCounts(
  kernel: Kernel,
): {
  scopes: number;
  abortControllers: number;
  schedulers: number;
  clocks: number;
  disposers: number;
  pluginStorages: number;
} {
  const state =
    kernel
      .__internal()
      .state;

  return {
    scopes:
      state.scopes.size,
    abortControllers:
      state.abortControllers
        .size,
    schedulers:
      state.schedulers.size,
    clocks:
      state.clocks.size,
    disposers:
      state.disposers.size,
    pluginStorages:
      state.pluginStorages
        .size,
  };
}

describe(
  "Etapa 74 — Lifecycle / Boot / Shutdown",
  () => {
    it(
      "faz rollback automático em setup failure sem deixar recursos vivos",
      async () => {
        const trace:
          string[] =
          [];

        const a:
          Plugin = {
            manifest:
              manifest(
                "test.lifecycle.a",
              ),

            setup(
              ctx:
                PluginContext,
            ): void {
              trace.push(
                "setup:A",
              );

              ctx.lifecycle.onDispose(
                (): void => {
                  trace.push(
                    "dispose:A",
                  );
                },
              );

              ctx.lifecycle.ready();
            },
          };

        const b:
          Plugin = {
            manifest:
              manifest(
                "test.lifecycle.b",
                {
                  dependsOn: [
                    {
                      id:
                        "test.lifecycle.a",
                      range:
                        "^1.0.0",
                    },
                  ],
                },
              ),

            setup(
              ctx:
                PluginContext,
            ): void {
              trace.push(
                "setup:B",
              );

              ctx.lifecycle.onDispose(
                (): void => {
                  trace.push(
                    "dispose:B",
                  );
                },
              );

              throw new Error(
                "setup-b-failed",
              );
            },
          };

        const kernel =
          new Kernel();

        kernel.register(
          b,
        );
        kernel.register(
          a,
        );

        await expect(
          kernel.boot(),
        ).rejects.toThrow(
          "setup-b-failed",
        );

        expect(trace)
          .toEqual([
            "setup:A",
            "setup:B",
            "dispose:B",
            "dispose:A",
          ]);

        expect(
          kernel.status,
        ).toBe(
          "failed",
        );

        expect(
          kernel
            .__internal()
            .state
            .phase,
        ).toBe(
          "stopped",
        );

        expect(
          kernel.snapshot()
            .pendingPlugins,
        ).toEqual([]);

        expect(
          kernel.snapshot()
            .bootOrder,
        ).toEqual([]);

        expect(
          resourceCounts(
            kernel,
          ),
        ).toEqual({
          scopes:
            0,
          abortControllers:
            0,
          schedulers:
            0,
          clocks:
            0,
          disposers:
            0,
          pluginStorages:
            0,
        });

        await kernel.stop();

        expect(
          kernel.status,
        ).toBe(
          "stopped",
        );

        expect(trace)
          .toEqual([
            "setup:A",
            "setup:B",
            "dispose:B",
            "dispose:A",
          ]);
      },
    );

    it(
      "executa onStop dos plugins started antes do dispose quando onBoot falha",
      async () => {
        const trace:
          string[] =
          [];

        function createPlugin(
          id:
            "a" |
            "b",
          dependsOn?: string,
          failOnBoot =
            false,
        ): Plugin {
          const pluginId =
            `test.lifecycle.${id}`;

          return {
            manifest:
              manifest(
                pluginId,
                {
                  ...(dependsOn
                    ? {
                        dependsOn: [
                          {
                            id:
                              dependsOn,
                            range:
                              "^1.0.0",
                          },
                        ],
                      }
                    : {}),
                  lifecycleHooks: {
                    onBoot(): void {
                      trace.push(
                        `boot:${id.toUpperCase()}`,
                      );

                      if (
                        failOnBoot
                      ) {
                        throw new Error(
                          "onboot-b-failed",
                        );
                      }
                    },

                    onStop(): void {
                      trace.push(
                        `stop:${id.toUpperCase()}`,
                      );
                    },
                  },
                },
              ),

            setup(
              ctx:
                PluginContext,
            ): void {
              trace.push(
                `setup:${id.toUpperCase()}`,
              );

              ctx.lifecycle.onDispose(
                (): void => {
                  trace.push(
                    `dispose:${id.toUpperCase()}`,
                  );
                },
              );

              ctx.lifecycle.ready();
            },
          };
        }

        const a =
          createPlugin(
            "a",
          );

        const b =
          createPlugin(
            "b",
            "test.lifecycle.a",
            true,
          );

        const kernel =
          new Kernel();

        kernel.register(
          b,
        );
        kernel.register(
          a,
        );

        await expect(
          kernel.boot(),
        ).rejects.toThrow(
          "onboot-b-failed",
        );

        expect(trace)
          .toEqual([
            "setup:A",
            "setup:B",
            "boot:A",
            "boot:B",
            "stop:B",
            "stop:A",
            "dispose:B",
            "dispose:A",
          ]);

        expect(
          resourceCounts(
            kernel,
          ),
        ).toEqual({
          scopes:
            0,
          abortControllers:
            0,
          schedulers:
            0,
          clocks:
            0,
          disposers:
            0,
          pluginStorages:
            0,
        });
      },
    );

    it(
      "readiness timeout faz rollback e remove pending state",
      async () => {
        let disposed =
          0;

        const plugin:
          Plugin = {
            manifest:
              manifest(
                "test.lifecycle.pending",
              ),

            setup(
              ctx:
                PluginContext,
            ): void {
              ctx.lifecycle.onDispose(
                (): void => {
                  disposed +=
                    1;
                },
              );

              // Intencionalmente não chama ready().
            },
          };

        const kernel =
          new Kernel({
            readyTimeoutMs:
              20,
            bootTimeoutMs:
              500,
          });

        kernel.register(
          plugin,
        );

        await expect(
          kernel.boot(),
        ).rejects.toBeTruthy();

        expect(disposed)
          .toBe(1);

        expect(
          kernel.snapshot()
            .pendingPlugins,
        ).toEqual([]);

        expect(
          kernel
            .__internal()
            .state
            .phase,
        ).toBe(
          "stopped",
        );
      },
    );

    it(
      "tolerant mode quarentena setup failure e mantém plugin saudável running",
      async () => {
        const trace:
          string[] =
          [];

        const bad:
          Plugin = {
            manifest:
              manifest(
                "test.lifecycle.bad",
              ),

            setup(
              ctx:
                PluginContext,
            ): void {
              trace.push(
                "bad:setup",
              );

              ctx.lifecycle.onDispose(
                (): void => {
                  trace.push(
                    "bad:dispose",
                  );
                },
              );

              throw new Error(
                "bad-setup",
              );
            },
          };

        const good:
          Plugin = {
            manifest:
              manifest(
                "test.lifecycle.good",
                {
                  lifecycleHooks: {
                    onStop(): void {
                      trace.push(
                        "good:stop",
                      );
                    },
                  },
                },
              ),

            setup(
              ctx:
                PluginContext,
            ): void {
              trace.push(
                "good:setup",
              );

              ctx.lifecycle.onDispose(
                (): void => {
                  trace.push(
                    "good:dispose",
                  );
                },
              );

              ctx.lifecycle.ready();
            },
          };

        const kernel =
          new Kernel({
            tolerant:
              true,
          });

        kernel.register(
          bad,
        );
        kernel.register(
          good,
        );

        await kernel.boot();

        expect(
          kernel.status,
        ).toBe(
          "running",
        );

        const snapshot =
          kernel.snapshot();

        expect(
          snapshot.plugins.find(
            (entry) =>
              entry.id ===
              "test.lifecycle.bad",
          ),
        ).toMatchObject({
          state:
            "disposed",
        });

        expect(
          snapshot.plugins.find(
            (entry) =>
              entry.id ===
              "test.lifecycle.good",
          ),
        ).toMatchObject({
          state:
            "started",
        });

        expect(trace)
          .toEqual([
            "bad:setup",
            "bad:dispose",
            "good:setup",
          ]);

        await kernel.stop();

        expect(trace)
          .toEqual([
            "bad:setup",
            "bad:dispose",
            "good:setup",
            "good:stop",
            "good:dispose",
          ]);
      },
    );

    it(
      "stop e dispose são idempotentes e shutdown termina em phase stopped",
      async () => {
        let onStop =
          0;
        let onDispose =
          0;

        const plugin:
          Plugin = {
            manifest:
              manifest(
                "test.lifecycle.idempotent",
                {
                  lifecycleHooks: {
                    onStop(): void {
                      onStop +=
                        1;
                    },
                  },
                },
              ),

            setup(
              ctx:
                PluginContext,
            ): void {
              ctx.lifecycle.onDispose(
                (): void => {
                  onDispose +=
                    1;
                },
              );

              ctx.lifecycle.ready();
            },
          };

        const kernel =
          new Kernel();

        kernel.register(
          plugin,
        );

        await kernel.boot();
        await kernel.stop();
        await kernel.stop();

        expect(onStop)
          .toBe(1);

        expect(onDispose)
          .toBe(1);

        expect(
          kernel.status,
        ).toBe(
          "stopped",
        );

        expect(
          kernel
            .__internal()
            .state
            .phase,
        ).toBe(
          "stopped",
        );

        await kernel.disposePlugin(
          "test.lifecycle.idempotent",
        );

        expect(onDispose)
          .toBe(1);
      },
    );

    it(
      "restart controlado usa nova instância de Kernel",
      async () => {
        let boots =
          0;

        function createPlugin():
          Plugin {
          return {
            manifest:
              manifest(
                "test.lifecycle.restart",
              ),

            setup(
              ctx:
                PluginContext,
            ): void {
              boots +=
                1;
              ctx.lifecycle.ready();
            },
          };
        }

        const first =
          new Kernel();

        first.register(
          createPlugin(),
        );

        await first.boot();
        await first.stop();

        await expect(
          first.boot(),
        ).rejects.toBeTruthy();

        const second =
          new Kernel();

        second.register(
          createPlugin(),
        );

        await second.boot();

        expect(
          second.status,
        ).toBe(
          "running",
        );

        expect(boots)
          .toBe(2);

        await second.stop();
      },
    );
  },
);
