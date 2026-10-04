import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

import type {
  DomainResult,
} from "../evaluation/DomainResult";

export type ModId =
  DomainId<"mod">;

export function createModId(
  value: string,
): ModId {
  return createDomainId<
    "mod"
  >(value);
}

export type ModOrigin =
  | "bundled"
  | "local"
  | "remote";

export interface ModDescriptor {
  readonly id: ModId;
  readonly name: string;
  readonly version: string;
  readonly enabled: boolean;
  readonly origin: ModOrigin;
}

export type ModdingPortErrorCode =
  | "unavailable"
  | "not-found"
  | "invalid-manifest"
  | "dependency-conflict"
  | "permission-denied"
  | "operation-failed";

export interface ModdingPortError {
  readonly code:
    ModdingPortErrorCode;
  readonly message: string;
  readonly recoverable: boolean;
}

/**
 * Port de aplicação/domínio para gestão abstrata de mods.
 *
 * Não expõe DynamicPluginLoader, ScriptSandbox, Steam Workshop, Tauri ou
 * detalhes de filesystem. A implementação concreta será fornecida pela camada
 * técnica através de APIs/adapters apropriados.
 */
export interface ModdingPort {
  listInstalled(): Promise<
    DomainResult<
      readonly ModDescriptor[],
      ModdingPortError
    >
  >;

  setEnabled(
    modId: ModId,
    enabled: boolean,
  ): Promise<
    DomainResult<
      ModDescriptor,
      ModdingPortError
    >
  >;

  refresh(): Promise<
    DomainResult<
      readonly ModDescriptor[],
      ModdingPortError
    >
  >;
}
