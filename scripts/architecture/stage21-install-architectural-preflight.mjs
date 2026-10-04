#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const TAG = "stage-21-architectural-preflight";
const ROOT = process.cwd();

const PATHS = Object.freeze({
  packageJson: "package.json",
  boot: "src/core/runtime/boot.ts",
  internalIndex: "src/core/internal/index.ts",
  errors: "src/core/contracts/errors.ts",
  preflight: "src/core/internal/preflight.ts",
});

const PREFLIGHT_SOURCE = `import { KernelError } from "../contracts/errors";
import { KERNEL_API_VERSION } from "../contracts/kernel-version";
import type { PluginKind } from "../contracts/plugin-kind";
import type {
  CapabilityConflict,
  PluginManifest,
} from "../contracts/plugin-manifest";
import type {
  CapabilityProvision,
  CapabilityRequirement,
} from "../contracts/capability-token";
import { computeBootOrder } from "./boot-order";
import { CapabilityRegistry } from "./capability-registry";
import { assertManifestShape } from "./plugin-registry";
import { satisfies } from "./semver";

export interface ArchitecturalPreflightOptions {
  readonly allowInternalConsumeExternal?: boolean;
}

/**
 * Validação arquitetural sem efeitos colaterais executada antes do primeiro
 * setup(). Usa somente manifests e declarações; nenhum contexto de plugin é
 * criado e nenhuma capability recebe valor nesta fase.
 */
export function runArchitecturalPreflight(
  manifests: readonly PluginManifest[],
  options: ArchitecturalPreflightOptions = {},
): PluginManifest[] {
  assertUniquePluginIds(manifests);

  for (const manifest of manifests) {
    validateManifest(manifest);
  }

  // Valida dependsOn, ranges, PluginKind, ciclos e produz a ordem canônica.
  const order = computeBootOrder(manifests);

  const providersByCapability = indexProviders(manifests);
  validateCapabilityRequirements(
    manifests,
    providersByCapability,
    options.allowInternalConsumeExternal ?? false,
  );
  validateCapabilityConflicts(manifests, providersByCapability);

  // Reutiliza a mesma política de provider/priority do Kernel. Como esta
  // registry recebe somente declarações, resolveFor() é totalmente preflight.
  const registry = new CapabilityRegistry({
    allowInternalConsumeExternal:
      options.allowInternalConsumeExternal ?? false,
  });

  for (const manifest of manifests) {
    for (const provision of manifest.capabilities?.provides ?? []) {
      registry.declareProvider(manifest.id, manifest.kind, provision);
    }
    for (const requirement of manifest.capabilities?.consumes ?? []) {
      registry.declareRequirement(manifest.id, manifest.kind, requirement);
    }
  }

  for (const manifest of order) {
    registry.resolveFor(manifest.id);
  }

  return order;
}

function validateManifest(manifest: PluginManifest): void {
  assertManifestShape(manifest);
  assertExactVersion(manifest.id, "manifest.version", manifest.version);

  if (manifest.api !== undefined) {
    assertSupportedRange(manifest.id, "manifest.api", manifest.api);
    if (!satisfies(KERNEL_API_VERSION, manifest.api)) {
      throw new KernelError(
        "PLUGIN_API_MISMATCH",
        \`plugin "\${manifest.id}" requer kernel api "\${manifest.api}", atual \${KERNEL_API_VERSION}\`,
        {
          pluginId: manifest.id,
          required: manifest.api,
          current: KERNEL_API_VERSION,
        },
      );
    }
  }

  assertUniqueEntries(
    manifest.id,
    "dependsOn",
    (manifest.dependsOn ?? []).map((entry) => entry.id),
  );
  assertUniqueEntries(
    manifest.id,
    "capabilities.provides",
    (manifest.capabilities?.provides ?? []).map((entry) => entry.id),
  );
  assertUniqueEntries(
    manifest.id,
    "capabilities.consumes",
    (manifest.capabilities?.consumes ?? []).map((entry) => entry.id),
  );
  assertUniqueEntries(
    manifest.id,
    "capabilities.conflicts",
    (manifest.capabilities?.conflicts ?? []).map(
      (entry) => \`\${entry.id}@\${entry.range}\`,
    ),
  );

  for (const dep of manifest.dependsOn ?? []) {
    assertNonEmptyId(manifest.id, "dependsOn.id", dep.id);
    assertSupportedRange(manifest.id, \`dependsOn[\${dep.id}].range\`, dep.range);
  }

  for (const provision of manifest.capabilities?.provides ?? []) {
    validateProvision(manifest.id, provision);
  }
  for (const requirement of manifest.capabilities?.consumes ?? []) {
    validateRequirement(manifest.id, requirement);
  }
  for (const conflict of manifest.capabilities?.conflicts ?? []) {
    validateConflict(manifest.id, conflict);
  }

  validateCapabilityPermissions(manifest);
}

function validateProvision(
  pluginId: string,
  provision: CapabilityProvision,
): void {
  assertNonEmptyId(pluginId, "capabilities.provides.id", provision.id);
  assertExactVersion(
    pluginId,
    \`capabilities.provides[\${provision.id}].version\`,
    provision.version,
  );
  if (
    provision.priority !== undefined &&
    (!Number.isFinite(provision.priority) ||
      !Number.isInteger(provision.priority))
  ) {
    throw new KernelError(
      "CAPABILITY_VERSION_MISMATCH",
      \`plugin "\${pluginId}" declarou priority inválida para "\${provision.id}"\`,
      { pluginId, capabilityId: provision.id, priority: provision.priority },
    );
  }
}

function validateRequirement(
  pluginId: string,
  requirement: CapabilityRequirement,
): void {
  assertNonEmptyId(pluginId, "capabilities.consumes.id", requirement.id);
  assertSupportedRange(
    pluginId,
    \`capabilities.consumes[\${requirement.id}].range\`,
    requirement.range,
  );
  if (
    requirement.optional !== undefined &&
    typeof requirement.optional !== "boolean"
  ) {
    throw new KernelError(
      "CAPABILITY_VERSION_MISMATCH",
      \`plugin "\${pluginId}" declarou optional inválido para "\${requirement.id}"\`,
      { pluginId, capabilityId: requirement.id },
    );
  }
}

function validateConflict(
  pluginId: string,
  conflict: CapabilityConflict,
): void {
  assertNonEmptyId(pluginId, "capabilities.conflicts.id", conflict.id);
  assertSupportedRange(
    pluginId,
    \`capabilities.conflicts[\${conflict.id}].range\`,
    conflict.range,
  );
}

function validateCapabilityPermissions(manifest: PluginManifest): void {
  const declared = new Set<string>([
    ...(manifest.capabilities?.provides ?? []).map((entry) => entry.id),
    ...(manifest.capabilities?.consumes ?? []).map((entry) => entry.id),
  ]);
  if (declared.size === 0) return;

  const allow = manifest.permissions?.capabilities;
  if (allow === undefined) {
    // internal/preloaded sem lista explícita = sem restrição.
    // external já exige permissions em assertManifestShape; ausência da lista
    // significa deny-all e portanto não pode declarar uso de capabilities.
    if (manifest.kind !== "external") return;
    throw new KernelError(
      "PERMISSION_DENIED",
      \`plugin external "\${manifest.id}" declara capabilities, mas permissions.capabilities está ausente\`,
      { pluginId: manifest.id, capabilities: [...declared] },
    );
  }

  const allowed = new Set(allow);
  for (const capabilityId of declared) {
    if (allowed.has(capabilityId)) continue;
    throw new KernelError(
      "PERMISSION_DENIED",
      \`plugin "\${manifest.id}" declara uso de "\${capabilityId}", mas a capability não está em permissions.capabilities\`,
      { pluginId: manifest.id, capabilityId },
    );
  }
}

function validateCapabilityRequirements(
  manifests: readonly PluginManifest[],
  providersByCapability: ReadonlyMap<
    string,
    readonly ProviderDeclaration[]
  >,
  allowInternalConsumeExternal: boolean,
): void {
  for (const manifest of manifests) {
    for (const requirement of manifest.capabilities?.consumes ?? []) {
      const providers = providersByCapability.get(requirement.id) ?? [];

      if (providers.length === 0) {
        if (requirement.optional === true) continue;
        throw new KernelError(
          "CAPABILITY_MISSING",
          \`plugin "\${manifest.id}" requer capability "\${requirement.id}@\${requirement.range}" e nenhum provider foi declarado\`,
          {
            pluginId: manifest.id,
            capabilityId: requirement.id,
            range: requirement.range,
          },
        );
      }

      const versionCompatible = providers.filter((provider) =>
        satisfies(provider.provision.version, requirement.range),
      );
      if (versionCompatible.length === 0) {
        throw new KernelError(
          "CAPABILITY_VERSION_MISMATCH",
          \`plugin "\${manifest.id}" requer "\${requirement.id}@\${requirement.range}", mas os providers presentes oferecem [\${providers
            .map((provider) => provider.provision.version)
            .join(", ")}]\`,
          {
            pluginId: manifest.id,
            capabilityId: requirement.id,
            range: requirement.range,
            providers: providers.map((provider) => ({
              pluginId: provider.pluginId,
              version: provider.provision.version,
            })),
          },
        );
      }

      const kindCompatible = versionCompatible.filter((provider) =>
        canConsumeKind(
          manifest.kind,
          provider.kind,
          allowInternalConsumeExternal,
        ),
      );
      if (kindCompatible.length === 0) {
        throw new KernelError(
          "PLUGIN_KIND_MISMATCH",
          \`plugin "\${manifest.id}" (\${manifest.kind}) requer "\${requirement.id}" mas os providers compatíveis são de camada proibida\`,
          {
            pluginId: manifest.id,
            consumerKind: manifest.kind,
            capabilityId: requirement.id,
            providers: versionCompatible.map((provider) => ({
              pluginId: provider.pluginId,
              kind: provider.kind,
            })),
          },
        );
      }

      const topPriority = Math.max(
        ...kindCompatible.map((provider) => provider.provision.priority ?? 0),
      );
      const topProviders = kindCompatible.filter(
        (provider) => (provider.provision.priority ?? 0) === topPriority,
      );
      if (topProviders.length > 1) {
        throw new KernelError(
          "CAPABILITY_AMBIGUOUS",
          \`múltiplos providers com mesma prioridade para "\${requirement.id}@\${requirement.range}": \${topProviders
            .map((provider) => provider.pluginId)
            .join(", ")}\`,
          {
            pluginId: manifest.id,
            capabilityId: requirement.id,
            providers: topProviders.map((provider) => provider.pluginId),
            priority: topPriority,
          },
        );
      }
    }
  }
}

function validateCapabilityConflicts(
  manifests: readonly PluginManifest[],
  providersByCapability: ReadonlyMap<
    string,
    readonly ProviderDeclaration[]
  >,
): void {
  for (const manifest of manifests) {
    for (const conflict of manifest.capabilities?.conflicts ?? []) {
      const matches = (providersByCapability.get(conflict.id) ?? []).filter(
        (provider) => satisfies(provider.provision.version, conflict.range),
      );
      if (matches.length === 0) continue;

      throw new KernelError(
        "CAPABILITY_CONFLICT",
        \`plugin "\${manifest.id}" conflita com capability "\${conflict.id}@\${conflict.range}" provida por [\${matches
          .map((provider) => provider.pluginId)
          .join(", ")}]\`,
        {
          pluginId: manifest.id,
          capabilityId: conflict.id,
          range: conflict.range,
          providers: matches.map((provider) => ({
            pluginId: provider.pluginId,
            version: provider.provision.version,
          })),
        },
      );
    }
  }
}

interface ProviderDeclaration {
  readonly pluginId: string;
  readonly kind: PluginKind;
  readonly provision: CapabilityProvision;
}

function indexProviders(
  manifests: readonly PluginManifest[],
): ReadonlyMap<string, readonly ProviderDeclaration[]> {
  const byCapability = new Map<string, ProviderDeclaration[]>();
  for (const manifest of manifests) {
    for (const provision of manifest.capabilities?.provides ?? []) {
      const list = byCapability.get(provision.id) ?? [];
      list.push({
        pluginId: manifest.id,
        kind: manifest.kind,
        provision,
      });
      byCapability.set(provision.id, list);
    }
  }
  return byCapability;
}

function canConsumeKind(
  consumerKind: PluginKind,
  providerKind: PluginKind,
  allowInternalConsumeExternal: boolean,
): boolean {
  if (consumerKind === "external") return true;
  if (allowInternalConsumeExternal) return true;
  return providerKind !== "external";
}

function assertUniquePluginIds(manifests: readonly PluginManifest[]): void {
  const ids = new Set<string>();
  for (const manifest of manifests) {
    if (ids.has(manifest.id)) {
      throw new KernelError(
        "PLUGIN_DUPLICATE",
        \`plugin "\${manifest.id}" aparece mais de uma vez no preflight\`,
        { pluginId: manifest.id },
      );
    }
    ids.add(manifest.id);
  }
}

function assertUniqueEntries(
  pluginId: string,
  field: string,
  values: readonly string[],
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      continue;
    }
    throw new KernelError(
      "PLUGIN_DUPLICATE",
      \`plugin "\${pluginId}" contém entrada duplicada em \${field}: "\${value}"\`,
      { pluginId, field, value },
    );
  }
}

function assertNonEmptyId(
  pluginId: string,
  field: string,
  value: string,
): void {
  if (typeof value === "string" && value.trim().length > 0) return;
  throw new KernelError(
    "PLUGIN_MISSING",
    \`plugin "\${pluginId}" contém \${field} vazio\`,
    { pluginId, field },
  );
}

function assertExactVersion(
  pluginId: string,
  field: string,
  version: string,
): void {
  if (/^\\d+\\.\\d+\\.\\d+$/.test(version)) return;
  throw new KernelError(
    "CAPABILITY_VERSION_MISMATCH",
    \`plugin "\${pluginId}" contém versão não suportada em \${field}: "\${version}"\`,
    { pluginId, field, version },
  );
}

function assertSupportedRange(
  pluginId: string,
  field: string,
  range: string,
): void {
  const trimmed = range.trim();
  if (trimmed === "*") return;
  const parts = trimmed.split(/\\s+/).filter(Boolean);
  if (
    parts.length > 0 &&
    parts.every((part) =>
      /^(?:\\^|~|>=|<=|>|<|=)?\\d+(?:\\.(?:\\d+|\\*|x))?(?:\\.(?:\\d+|\\*|x))?$/.test(
        part,
      ),
    )
  ) {
    return;
  }
  throw new KernelError(
    "CAPABILITY_VERSION_MISMATCH",
    \`plugin "\${pluginId}" contém range semver não suportado em \${field}: "\${range}"\`,
    { pluginId, field, range },
  );
}
`;

function fail(message) {
  console.error(`[${TAG}] ERRO: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function normalizeNewlines(text) {
  return text.replace(/\r\n/g, "\n");
}

function read(relativePath) {
  return normalizeNewlines(
    fs.readFileSync(path.join(ROOT, relativePath), "utf8"),
  );
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function assertRoot() {
  for (const relativePath of [
    PATHS.packageJson,
    PATHS.boot,
    PATHS.internalIndex,
    PATHS.errors,
  ]) {
    if (!exists(relativePath)) {
      fail(`execute na raiz do Projeto1; arquivo ausente: ${relativePath}`);
    }
  }
}

function parseArgs(argv) {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === "--check")) {
    return "check";
  }
  if (argv.length === 1 && argv[0] === "--apply") return "apply";
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    return "help";
  }
  fail("uso: node scripts/architecture/stage21-install-architectural-preflight.mjs [--check|--apply|--help]");
}

function printHelp() {
  console.log(`\nProjeto1 — Etapa 21: preflight arquitetural antes do primeiro setup()\n\nUso:\n  node scripts/architecture/stage21-install-architectural-preflight.mjs --check\n  node scripts/architecture/stage21-install-architectural-preflight.mjs --apply\n\nEscopo exato:\n  - cria src/core/internal/preflight.ts;\n  - exporta runArchitecturalPreflight pelo barrel interno;\n  - chama o preflight no runtime/boot.ts antes de state.phase = \"setup\";\n  - adiciona CAPABILITY_CONFLICT ao KernelErrorCode.\n\nO preflight valida manifests, dependsOn obrigatório/opcional presente,\ncapabilities obrigatórias/opcionais presentes, conflicts, semver, providers,\npermissões, ciclos, provider ambiguity, PluginKind e boot order.\n`);
}

function replaceExactly(source, needle, replacement, file) {
  const count = source.split(needle).length - 1;
  if (count !== 1) {
    fail(`${file}: esperado exatamente 1 marcador para patch; encontrado ${count}`);
  }
  return source.replace(needle, replacement);
}

function desiredFiles() {
  const out = new Map();

  out.set(PATHS.preflight, PREFLIGHT_SOURCE);

  let errors = read(PATHS.errors);
  if (!errors.includes('| "CAPABILITY_CONFLICT"')) {
    errors = replaceExactly(
      errors,
      '  | "CAPABILITY_VERSION_MISMATCH"\n',
      '  | "CAPABILITY_VERSION_MISMATCH"\n  | "CAPABILITY_CONFLICT"\n',
      PATHS.errors,
    );
  }
  out.set(PATHS.errors, errors);

  let internalIndex = read(PATHS.internalIndex);
  if (!internalIndex.includes('export { runArchitecturalPreflight } from "./preflight";')) {
    internalIndex = replaceExactly(
      internalIndex,
      'export { computeBootOrder } from "./boot-order";\n',
      'export { computeBootOrder } from "./boot-order";\n\nexport { runArchitecturalPreflight } from "./preflight";\nexport type { ArchitecturalPreflightOptions } from "./preflight";\n',
      PATHS.internalIndex,
    );
  }
  out.set(PATHS.internalIndex, internalIndex);

  let boot = read(PATHS.boot);
  if (!boot.includes("runArchitecturalPreflight,")) {
    boot = replaceExactly(
      boot,
      "  computeBootOrder,\n",
      "  runArchitecturalPreflight,\n",
      PATHS.boot,
    );
  }
  if (!boot.includes("runArchitecturalPreflight(manifests")) {
    boot = replaceExactly(
      boot,
      "  const order = computeBootOrder(manifests);\n",
      `  const order = runArchitecturalPreflight(manifests, {\n    allowInternalConsumeExternal:\n      state.options.allowInternalConsumeExternal ?? false,\n  });\n`,
      PATHS.boot,
    );
  }
  out.set(PATHS.boot, boot);

  return out;
}

function inspect(files) {
  const pending = [];
  for (const [relativePath, desired] of files) {
    if (!exists(relativePath)) {
      pending.push(relativePath);
      continue;
    }
    if (read(relativePath) !== normalizeNewlines(desired)) {
      pending.push(relativePath);
    }
  }
  return pending;
}

function assertDesiredState(files) {
  const preflight = normalizeNewlines(files.get(PATHS.preflight));
  const boot = normalizeNewlines(files.get(PATHS.boot));
  const index = normalizeNewlines(files.get(PATHS.internalIndex));
  const errors = normalizeNewlines(files.get(PATHS.errors));

  const requiredPreflightSignals = [
    "assertManifestShape(manifest)",
    "computeBootOrder(manifests)",
    "validateCapabilityRequirements(",
    "validateCapabilityConflicts(",
    "validateCapabilityPermissions(manifest)",
    "registry.resolveFor(manifest.id)",
    "CAPABILITY_VERSION_MISMATCH",
    "CAPABILITY_AMBIGUOUS",
    "PLUGIN_KIND_MISMATCH",
    "PERMISSION_DENIED",
    "CAPABILITY_CONFLICT",
  ];
  for (const signal of requiredPreflightSignals) {
    if (!preflight.includes(signal)) fail(`preflight incompleto: marcador ausente: ${signal}`);
  }

  if (!errors.includes('| "CAPABILITY_CONFLICT"')) {
    fail("KernelErrorCode não contém CAPABILITY_CONFLICT");
  }
  if (!index.includes('runArchitecturalPreflight } from "./preflight"')) {
    fail("barrel interno não exporta runArchitecturalPreflight");
  }

  const callAt = boot.indexOf("runArchitecturalPreflight(manifests");
  const setupAt = boot.indexOf('state.phase = "setup"');
  const setupCallAt = boot.indexOf("setupOne(state, manifest)");
  if (callAt < 0 || setupAt < 0 || setupCallAt < 0 || callAt > setupAt || callAt > setupCallAt) {
    fail("preflight não está posicionado antes do primeiro setup()");
  }
  if (boot.includes("const order = computeBootOrder(manifests);")) {
    fail("boot ainda calcula order diretamente em vez de usar o preflight");
  }
}

function apply(files) {
  const before = new Map();
  const written = [];
  try {
    for (const [relativePath, desiredRaw] of files) {
      const absolutePath = path.join(ROOT, relativePath);
      const desired = normalizeNewlines(desiredRaw);
      const current = exists(relativePath) ? read(relativePath) : null;
      if (current === desired) continue;
      before.set(relativePath, current);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, desired, "utf8");
      written.push(relativePath);
    }
  } catch (error) {
    for (const relativePath of written.reverse()) {
      const absolutePath = path.join(ROOT, relativePath);
      const previous = before.get(relativePath);
      if (previous === null) fs.rmSync(absolutePath, { force: true });
      else fs.writeFileSync(absolutePath, previous, "utf8");
    }
    throw error;
  }
  return written;
}

function main() {
  const mode = parseArgs(process.argv.slice(2));
  if (mode === "help") {
    printHelp();
    return;
  }

  assertRoot();
  const files = desiredFiles();
  assertDesiredState(files);
  const pending = inspect(files);

  console.log(`[${TAG}] modo ${mode}${mode === "check" ? " (read-only)" : ""}`);
  console.log(`Arquivos no escopo: ${files.size}`);
  console.log(`Arquivos pendentes: ${pending.length}`);
  for (const file of pending) console.log(`  PENDENTE ${file}`);

  if (mode === "check") {
    if (pending.length === 0) {
      console.log("Etapa 21 já está instalada e idempotente.");
      return;
    }
    process.exitCode = 2;
    return;
  }

  const written = apply(files);
  const remaining = inspect(files);
  if (remaining.length !== 0) {
    fail(`apply incompleto; ainda pendentes: ${remaining.join(", ")}`);
  }

  console.log(`[${TAG}] aplicado com sucesso.`);
  console.log(`Arquivos alterados/criados: ${written.length}`);
  for (const file of written) console.log(`  OK ${file}`);
  console.log("Preflight instalado antes do primeiro setup().");
  console.log("Fluxo existente setup -> resolving -> ready -> running preservado.");
}

try {
  main();
} catch (error) {
  if (process.exitCode === undefined || process.exitCode === 0) {
    process.exitCode = 1;
  }
  if (!(error instanceof Error) || !error.message.startsWith("uso:")) {
    if (error instanceof Error && !error.message.includes("execute na raiz")) {
      console.error(`[${TAG}] ${error.stack ?? error.message}`);
    }
  }
}
