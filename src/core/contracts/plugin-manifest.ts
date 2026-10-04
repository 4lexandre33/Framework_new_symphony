import type { CapabilityProvision, CapabilityRequirement } from "./capability-token";
import type { ConfigSchema } from "./plugin-config";
import type { PluginKind } from "./plugin-kind";

export interface PluginDependency {
  readonly id: string;
  readonly range: string;
  readonly optional?: boolean;
}

export interface SlotDeclaration {
  readonly id: string;
  readonly title?: string;
  readonly description?: string;
}

export interface SlotContribution {
  readonly slot: string;
  readonly order?: number;
}

/**
 * Permissões declaradas no manifest.
 *
 * Semântica:
 * - `internal` / `preloaded`: ausência de campo = sem restrição.
 * - `external`: ausência de campo = sem permissão (deny-all).
 *
 * `storage` e `network` são informativos (audit); `events` e
 * `capabilities` são enforçados em runtime pelo kernel.
 */
export interface PluginPermissions {
  readonly storage?: "read" | "write" | "none";
  readonly network?: "read" | "write" | "none";
  /** Tipos de evento que o plugin pode EMITIR. */
  readonly events?: readonly string[];
  /** Ids de capability que o plugin pode consumir/fornecer. */
  readonly capabilities?: readonly string[];
}

/** Só faz sentido para `kind: "external"`. */
export interface PluginSandbox {
  readonly memoryMb?: number;
  readonly timeoutMs?: number;
}

export interface PluginLifecycleHooks {
  onBoot?(ctx: import("./plugin-context").PluginContext): void | Promise<void>;
  onStop?(ctx: import("./plugin-context").PluginContext): void | Promise<void>;
}/** Declara incompatibilidade com uma capability em determinada faixa semver. */
export interface CapabilityConflict {
  readonly id: string;
  readonly range: string;
}



export interface PluginManifest {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly description?: string;
  /** faixa da API do kernel (semver). */
  readonly api?: string;

  /** Camada do plugin. Obrigatório. */
  readonly kind: PluginKind;

  /**
   * Publisher. "lume" para internal/preloaded; identificador do autor
   * ("@user", URL, etc.) para external. Informativo nesta fase.
   */
  readonly authority?: string;

  /** Permissões declaradas. Enforçadas pelo kernel. */
  readonly permissions?: PluginPermissions;

  /** Recursos do sandbox. Válido apenas para external. */
  readonly sandbox?: PluginSandbox;

  readonly dependsOn?: readonly PluginDependency[];

  readonly capabilities?: {
    readonly provides?: readonly CapabilityProvision[];
    readonly consumes?: readonly CapabilityRequirement[];
    readonly conflicts?: readonly CapabilityConflict[];
  };

  readonly configSchema?: ConfigSchema<Record<string, unknown>>;

  readonly definesSlots?: readonly SlotDeclaration[];
  readonly contributesTo?: readonly SlotContribution[];
  readonly tags?: readonly string[];

  readonly lifecycleHooks?: PluginLifecycleHooks;
}