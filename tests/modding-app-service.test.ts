// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  domainErr,
  domainOk,
} from "../src/domain/evaluation";

import {
  createModId,
} from "../src/domain/ports";

import type {
  ModDescriptor,
  ModdingPort,
  ModdingPortError,
  ModId,
} from "../src/domain/ports";

import {
  ModdingAppService,
} from "../src/services/usecases";

function descriptor(
  id: ModId,
  enabled: boolean,
): ModDescriptor {
  return {
    id,
    name: `Mod ${id}`,
    version: "1.0.0",
    enabled,
    origin: "local",
  };
}

class MemoryModdingPort
  implements ModdingPort {
  private readonly mods =
    new Map<
      ModId,
      ModDescriptor
    >();

  public failure:
    ModdingPortError | null =
      null;

  public listOverride:
    readonly ModDescriptor[] |
    null = null;

  public refreshOverride:
    readonly ModDescriptor[] |
    null = null;

  public responseIdOverride:
    ModId | null = null;

  public enabledOverride:
    boolean | null = null;

  public async listInstalled() {
    if (
      this.failure !== null
    ) {
      return domainErr(
        this.failure,
      );
    }

    if (
      this.listOverride !==
      null
    ) {
      return domainOk(
        this.listOverride,
      );
    }

    return domainOk(
      this.snapshot(),
    );
  }

  public async setEnabled(
    modId: ModId,
    enabled: boolean,
  ) {
    if (
      this.failure !== null
    ) {
      return domainErr(
        this.failure,
      );
    }

    const existing =
      this.mods.get(modId);

    if (existing === undefined) {
      return domainErr({
        code: "not-found",
        message:
          `Mod not found: ${modId}`,
        recoverable: true,
      } satisfies ModdingPortError);
    }

    const responseId =
      this.responseIdOverride ??
      modId;

    const responseEnabled =
      this.enabledOverride ??
      enabled;

    const updated:
      ModDescriptor = {
        ...existing,
        id: responseId,
        enabled:
          responseEnabled,
      };

    if (
      responseId === modId &&
      responseEnabled ===
        enabled
    ) {
      this.mods.set(
        modId,
        updated,
      );
    }

    return domainOk(updated);
  }

  public async refresh() {
    if (
      this.failure !== null
    ) {
      return domainErr(
        this.failure,
      );
    }

    if (
      this.refreshOverride !==
      null
    ) {
      return domainOk(
        this.refreshOverride,
      );
    }

    return domainOk(
      this.snapshot(),
    );
  }

  public seed(
    mod:
      ModDescriptor,
  ): void {
    this.mods.set(
      mod.id,
      mod,
    );
  }

  private snapshot():
    readonly ModDescriptor[] {
    const values = [
      ...this.mods.values(),
    ];

    values.sort(
      (left, right) =>
        left.id < right.id
          ? -1
          : left.id > right.id
            ? 1
            : 0,
    );

    return values;
  }
}

describe(
  "Etapa 44.6 — ModdingAppService",
  () => {
    it(
      "lista mods instalados via ModdingPort",
      async () => {
        const port =
          new MemoryModdingPort();

        const alphaId =
          createModId(
            "mod.alpha",
          );

        const betaId =
          createModId(
            "mod.beta",
          );

        port.seed(
          descriptor(
            betaId,
            false,
          ),
        );

        port.seed(
          descriptor(
            alphaId,
            true,
          ),
        );

        const service =
          new ModdingAppService({
            moddingPort: port,
          });

        const result =
          await service
            .listInstalled();

        expect(result.ok).toBe(
          true,
        );

        if (result.ok) {
          expect(
            result.value.map(
              (mod) => mod.id,
            ),
          ).toEqual([
            "mod.alpha",
            "mod.beta",
          ]);
        }
      },
    );

    it(
      "habilita e desabilita mods",
      async () => {
        const port =
          new MemoryModdingPort();

        const modId =
          createModId(
            "mod.toggle",
          );

        port.seed(
          descriptor(
            modId,
            false,
          ),
        );

        const service =
          new ModdingAppService({
            moddingPort: port,
          });

        const enabled =
          await service.enable(
            modId,
          );

        expect(enabled).toEqual({
          ok: true,
          value:
            descriptor(
              modId,
              true,
            ),
        });

        const disabled =
          await service.disable(
            modId,
          );

        expect(disabled).toEqual({
          ok: true,
          value:
            descriptor(
              modId,
              false,
            ),
        });
      },
    );

    it(
      "propaga falha de port com operação tipada",
      async () => {
        const port =
          new MemoryModdingPort();

        port.failure = {
          code: "unavailable",
          message:
            "provider offline",
          recoverable: true,
        };

        const service =
          new ModdingAppService({
            moddingPort: port,
          });

        const result =
          await service.refresh();

        expect(result).toEqual({
          ok: false,
          error: {
            code: "port-error",
            operation:
              "refresh",
            cause:
              port.failure,
          },
        });
      },
    );

    it(
      "rejeita ModId duplicado em list",
      async () => {
        const port =
          new MemoryModdingPort();

        const modId =
          createModId(
            "mod.duplicate",
          );

        port.listOverride = [
          descriptor(
            modId,
            true,
          ),
          descriptor(
            modId,
            false,
          ),
        ];

        const service =
          new ModdingAppService({
            moddingPort: port,
          });

        const result =
          await service
            .listInstalled();

        expect(result).toEqual({
          ok: false,
          error: {
            code:
              "duplicate-mod",
            operation: "list",
            modId,
          },
        });
      },
    );

    it(
      "rejeita ModId duplicado em refresh",
      async () => {
        const port =
          new MemoryModdingPort();

        const modId =
          createModId(
            "mod.refresh-duplicate",
          );

        port.refreshOverride = [
          descriptor(
            modId,
            true,
          ),
          descriptor(
            modId,
            true,
          ),
        ];

        const service =
          new ModdingAppService({
            moddingPort: port,
          });

        const result =
          await service.refresh();

        expect(result).toEqual({
          ok: false,
          error: {
            code:
              "duplicate-mod",
            operation:
              "refresh",
            modId,
          },
        });
      },
    );

    it(
      "rejeita resposta com outro ModId",
      async () => {
        const port =
          new MemoryModdingPort();

        const requested =
          createModId(
            "mod.requested",
          );

        port.seed(
          descriptor(
            requested,
            false,
          ),
        );

        port.responseIdOverride =
          createModId(
            "mod.wrong",
          );

        const service =
          new ModdingAppService({
            moddingPort: port,
          });

        const result =
          await service.enable(
            requested,
          );

        expect(result).toEqual({
          ok: false,
          error: {
            code:
              "invalid-port-response",
            reason:
              "mod-id-mismatch",
            expectedModId:
              "mod.requested",
            actualModId:
              "mod.wrong",
          },
        });
      },
    );

    it(
      "rejeita resposta com enabled diferente do solicitado",
      async () => {
        const port =
          new MemoryModdingPort();

        const modId =
          createModId(
            "mod.state",
          );

        port.seed(
          descriptor(
            modId,
            false,
          ),
        );

        port.enabledOverride =
          false;

        const service =
          new ModdingAppService({
            moddingPort: port,
          });

        const result =
          await service.enable(
            modId,
          );

        expect(result).toEqual({
          ok: false,
          error: {
            code:
              "invalid-port-response",
            reason:
              "enabled-state-mismatch",
            modId,
            expectedEnabled:
              true,
            actualEnabled:
              false,
          },
        });
      },
    );

    it(
      "não acessa plugins concretos para mod inexistente",
      async () => {
        const port =
          new MemoryModdingPort();

        const service =
          new ModdingAppService({
            moddingPort: port,
          });

        const result =
          await service.enable(
            createModId(
              "mod.missing",
            ),
          );

        expect(result.ok).toBe(
          false,
        );

        if (!result.ok) {
          expect(
            result.error.code,
          ).toBe("port-error");

          if (
            result.error.code ===
            "port-error"
          ) {
            expect(
              result.error
                .operation,
            ).toBe(
              "set-enabled",
            );

            expect(
              result.error
                .cause.code,
            ).toBe("not-found");
          }
        }
      },
    );
  },
);
