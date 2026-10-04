import {
  domainErr,
  domainOk,
} from "../../domain/evaluation/DomainResult";

import type {
  DomainResult,
} from "../../domain/evaluation/DomainResult";

import type {
  ModDescriptor,
  ModdingPort,
  ModdingPortError,
  ModId,
} from "../../domain/ports/ModdingPort";

export type ModdingAppOperation =
  | "list"
  | "refresh"
  | "set-enabled";

export interface ModdingAppPortFailure {
  readonly code: "port-error";
  readonly operation:
    ModdingAppOperation;
  readonly cause:
    ModdingPortError;
}

export interface ModdingAppDuplicateMod {
  readonly code:
    "duplicate-mod";
  readonly operation:
    "list" | "refresh";
  readonly modId:
    ModId;
}

export interface ModdingAppInvalidIdentityResponse {
  readonly code:
    "invalid-port-response";
  readonly reason:
    "mod-id-mismatch";
  readonly expectedModId:
    ModId;
  readonly actualModId:
    ModId;
}

export interface ModdingAppInvalidEnabledResponse {
  readonly code:
    "invalid-port-response";
  readonly reason:
    "enabled-state-mismatch";
  readonly modId:
    ModId;
  readonly expectedEnabled:
    boolean;
  readonly actualEnabled:
    boolean;
}

export type ModdingAppServiceError =
  | ModdingAppPortFailure
  | ModdingAppDuplicateMod
  | ModdingAppInvalidIdentityResponse
  | ModdingAppInvalidEnabledResponse;

export interface ModdingAppServiceDependencies {
  readonly moddingPort:
    ModdingPort;
}

function portFailure(
  operation:
    ModdingAppOperation,
  cause:
    ModdingPortError,
): ModdingAppPortFailure {
  return {
    code: "port-error",
    operation,
    cause,
  };
}

function validateUniqueMods(
  operation:
    "list" | "refresh",
  mods:
    readonly ModDescriptor[],
): DomainResult<
  readonly ModDescriptor[],
  ModdingAppDuplicateMod
> {
  const seen =
    new Set<ModId>();

  for (const mod of mods) {
    if (seen.has(mod.id)) {
      return domainErr({
        code: "duplicate-mod",
        operation,
        modId: mod.id,
      });
    }

    seen.add(mod.id);
  }

  return domainOk(mods);
}

/**
 * Serviço de aplicação para gestão abstrata de mods.
 *
 * Responsabilidades:
 * - listar mods instalados;
 * - pedir refresh da origem abstrata;
 * - habilitar/desabilitar mods;
 * - traduzir erros do ModdingPort para erros da camada de aplicação;
 * - rejeitar respostas inconsistentes do adapter.
 *
 * Não conhece DynamicPluginLoader, ScriptSandbox, filesystem, Steam Workshop,
 * Tauri, plugins concretos, engine internals ou qualquer representação 2D/3D.
 */
export class ModdingAppService {
  private readonly moddingPort:
    ModdingPort;

  public constructor(
    dependencies:
      ModdingAppServiceDependencies,
  ) {
    this.moddingPort =
      dependencies.moddingPort;
  }

  public async listInstalled():
    Promise<
      DomainResult<
        readonly ModDescriptor[],
        ModdingAppServiceError
      >
    > {
    const result =
      await this.moddingPort
        .listInstalled();

    if (!result.ok) {
      return domainErr(
        portFailure(
          "list",
          result.error,
        ),
      );
    }

    return validateUniqueMods(
      "list",
      result.value,
    );
  }

  public async refresh():
    Promise<
      DomainResult<
        readonly ModDescriptor[],
        ModdingAppServiceError
      >
    > {
    const result =
      await this.moddingPort
        .refresh();

    if (!result.ok) {
      return domainErr(
        portFailure(
          "refresh",
          result.error,
        ),
      );
    }

    return validateUniqueMods(
      "refresh",
      result.value,
    );
  }

  public async enable(
    modId: ModId,
  ): Promise<
    DomainResult<
      ModDescriptor,
      ModdingAppServiceError
    >
  > {
    return this.setEnabled(
      modId,
      true,
    );
  }

  public async disable(
    modId: ModId,
  ): Promise<
    DomainResult<
      ModDescriptor,
      ModdingAppServiceError
    >
  > {
    return this.setEnabled(
      modId,
      false,
    );
  }

  public async setEnabled(
    modId: ModId,
    enabled: boolean,
  ): Promise<
    DomainResult<
      ModDescriptor,
      ModdingAppServiceError
    >
  > {
    const result =
      await this.moddingPort
        .setEnabled(
          modId,
          enabled,
        );

    if (!result.ok) {
      return domainErr(
        portFailure(
          "set-enabled",
          result.error,
        ),
      );
    }

    const descriptor =
      result.value;

    if (descriptor.id !== modId) {
      return domainErr({
        code:
          "invalid-port-response",
        reason:
          "mod-id-mismatch",
        expectedModId:
          modId,
        actualModId:
          descriptor.id,
      });
    }

    if (
      descriptor.enabled !==
      enabled
    ) {
      return domainErr({
        code:
          "invalid-port-response",
        reason:
          "enabled-state-mismatch",
        modId,
        expectedEnabled:
          enabled,
        actualEnabled:
          descriptor.enabled,
      });
    }

    return domainOk(
      descriptor,
    );
  }
}
