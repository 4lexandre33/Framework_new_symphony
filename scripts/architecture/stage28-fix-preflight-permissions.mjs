#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const TAG = "stage-28-fix-preflight-permissions";
const ROOT = process.cwd();
const TARGET = "src/core/internal/preflight.ts";

const OLD_FUNCTION = `function validateCapabilityPermissions(manifest: PluginManifest): void {
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
}`;

const NEW_FUNCTION = `function validateCapabilityPermissions(manifest: PluginManifest): void {
  const declared = new Set<string>([
    ...(manifest.capabilities?.provides ?? []).map((entry) => entry.id),
    ...(manifest.capabilities?.consumes ?? []).map((entry) => entry.id),
  ]);
  if (declared.size === 0) return;

  const allow = manifest.permissions?.capabilities;

  // Preserva a semântica histórica do Kernel:
  //
  // - internal/preloaded sem allowlist: uso irrestrito;
  // - internal/preloaded com allowlist: a restrição é aplicada no uso efetivo
  //   por assertCanUseCapability() em require/get/await/watch/provide;
  // - declarar consumes/provides fora da allowlist não torna o manifesto
  //   estruturalmente inválido para plugins trusted.
  //
  // Isso é importante porque um plugin pode declarar uma capability para
  // resolução/binding e, deliberadamente, não ter permissão para acessá-la em
  // runtime. O teste de permissions cobre exatamente esse contrato.
  if (manifest.kind !== "external") return;

  // Para plugins externos, a política permanece fail-fast: ausência da lista
  // significa deny-all, e declarações precisam estar explicitamente permitidas.
  if (allow === undefined) {
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
      \`plugin external "\${manifest.id}" declara uso de "\${capabilityId}", mas a capability não está em permissions.capabilities\`,
      { pluginId: manifest.id, capabilityId },
    );
  }
}`;

function fail(message) {
  console.error(`[${TAG}] ERRO: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === "--check")) {
    return "check";
  }
  if (argv.length === 1 && argv[0] === "--apply") {
    return "apply";
  }
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    console.log(`
Projeto1 — correção encontrada na Etapa 28

Uso:
  node scripts/architecture/stage28-fix-preflight-permissions.mjs --check
  node scripts/architecture/stage28-fix-preflight-permissions.mjs --apply

Escopo:
  - altera somente src/core/internal/preflight.ts;
  - NÃO altera permissions.test.ts;
  - NÃO altera runtime/permissions.ts;
  - preserva fail-fast de permissions para plugin external;
  - restaura a semântica runtime para internal/preloaded.
`);
    process.exit(0);
  }
  fail("argumentos inválidos; use --check, --apply ou --help.");
}

function normalize(value) {
  return value.replace(/\r\n/g, "\n");
}

const mode = parseArgs(process.argv.slice(2));
const full = path.join(ROOT, TARGET);

if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
  fail(`arquivo obrigatório ausente: ${TARGET}`);
}

const current = normalize(fs.readFileSync(full, "utf8"));

const hasOld = current.includes(OLD_FUNCTION);
const hasNew = current.includes(NEW_FUNCTION);

if (hasOld && hasNew) {
  fail("preflight.ts contém simultaneamente as versões antiga e nova da função.");
}

console.log(`[${TAG}] modo ${mode}${mode === "check" ? " (read-only)" : ""}`);
console.log(`Arquivo no escopo: ${TARGET}`);

if (hasNew) {
  console.log("Pendências: 0");
  console.log("Correção já instalada e idempotente.");
  process.exit(0);
}

if (!hasOld) {
  fail(
    "estado inesperado em validateCapabilityPermissions(); " +
    "não vou aplicar patch sobre uma versão desconhecida.",
  );
}

console.log("Pendências: 1");
console.log(`  PENDENTE ${TARGET}`);

if (mode === "check") {
  console.log("Correção ainda precisa ser aplicada.");
  process.exit(0);
}

const next = current.replace(OLD_FUNCTION, NEW_FUNCTION);
if (next === current) {
  fail("substituição não alterou o arquivo.");
}

const temp = `${full}.stage28.tmp`;
fs.writeFileSync(temp, next, "utf8");
fs.renameSync(temp, full);

const verify = normalize(fs.readFileSync(full, "utf8"));
if (!verify.includes(NEW_FUNCTION) || verify.includes(OLD_FUNCTION)) {
  fail("validação pós-write falhou.");
}

console.log(`[${TAG}] aplicado com sucesso.`);
console.log(`  OK ${TARGET}`);
console.log("Teste de permissions preservado; semântica de runtime restaurada.");
