#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const TAG = "stage-30-fix-architecture-smoke";
const ROOT = process.cwd();
const TARGET = "tests/architecture-smoke-test.mjs";
const EXPECTED = "#!/usr/bin/env node\nimport fs from \"node:fs\";\nimport path from \"node:path\";\nimport { spawnSync } from \"node:child_process\";\n\nimport {\n  CANONICAL_MODULES,\n} from \"../scripts/architecture/module-map.mjs\";\n\nconst ROOT = process.cwd();\n\nfunction fail(message) {\n  console.error(`[architecture-smoke] ERRO: ${message}`);\n  process.exit(1);\n}\n\nfunction existsFile(relativePath) {\n  const absolutePath = path.join(ROOT, ...relativePath.split(\"/\"));\n  return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile();\n}\n\nfunction existsDir(relativePath) {\n  const absolutePath = path.join(ROOT, ...relativePath.split(\"/\"));\n  return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory();\n}\n\nfunction read(relativePath) {\n  return fs.readFileSync(\n    path.join(ROOT, ...relativePath.split(\"/\")),\n    \"utf8\",\n  );\n}\n\nfunction assertProjectRoot() {\n  for (const relativePath of [\n    \"package.json\",\n    \"vite.config.ts\",\n    \"src/core/index.ts\",\n    \"scripts/architecture/module-map.mjs\",\n    \"scripts/architecture/check-boundaries.mjs\",\n    \"scripts/architecture/check-dependencies.mjs\",\n  ]) {\n    if (!existsFile(relativePath)) {\n      fail(`arquivo obrigatório ausente: ${relativePath}`);\n    }\n  }\n}\n\nfunction assertCanonicalModuleLayout() {\n  const failures = [];\n\n  for (const moduleRecord of CANONICAL_MODULES) {\n    const publicRoot = moduleRecord.engine.publicRoot;\n    const internalRoot = moduleRecord.engine.internalRoot;\n    const facade = `${publicRoot}/index.ts`;\n\n    if (!existsDir(publicRoot)) {\n      failures.push(`${moduleRecord.key}: publicRoot ausente (${publicRoot})`);\n    }\n\n    if (!existsDir(internalRoot)) {\n      failures.push(`${moduleRecord.key}: internalRoot ausente (${internalRoot})`);\n    }\n\n    if (!existsFile(facade)) {\n      failures.push(`${moduleRecord.key}: fachada pública ausente (${facade})`);\n    }\n  }\n\n  if (failures.length > 0) {\n    fail(\n      `layout canônico inválido:\\n${failures\n        .map((item) => `  - ${item}`)\n        .join(\"\\n\")}`,\n    );\n  }\n}\n\nfunction assertPublicFacadesDoNotLeakInternal() {\n  const violations = [];\n\n  for (const moduleRecord of CANONICAL_MODULES) {\n    const facade = `${moduleRecord.engine.publicRoot}/index.ts`;\n    const source = read(facade);\n\n    if (/[\"'][^\"']*\\/internal(?:\\/|[\"'])/u.test(source)) {\n      violations.push(facade);\n    }\n  }\n\n  if (violations.length > 0) {\n    fail(\n      `fachadas públicas de módulos referenciam /internal:\\n${violations\n        .map((item) => `  - ${item}`)\n        .join(\"\\n\")}`,\n    );\n  }\n}\n\nfunction assertCoreFacadePolicy() {\n  const coreFacade = read(\"src/core/index.ts\");\n\n  if (!coreFacade.includes('export { satisfies } from \"./internal/semver\";')) {\n    fail(\n      \"src/core/index.ts não contém a promoção pública explícita esperada de satisfies.\",\n    );\n  }\n\n  if (\n    coreFacade.includes('\"./runtime/') ||\n    coreFacade.includes(\"'./runtime/\")\n  ) {\n    fail(\n      \"src/core/index.ts começou a expor runtime/* diretamente; revisar a API pública.\",\n    );\n  }\n}\n\nfunction assertViteExcludesMigrationHistory() {\n  const viteConfig = read(\"vite.config.ts\");\n  if (!viteConfig.includes(\"**/.migration/**\")) {\n    fail(\"vite.config.ts não exclui .migration/** da coleta do Vitest.\");\n  }\n}\n\nfunction runGuardrail(relativePath, label) {\n  const result = spawnSync(\n    process.execPath,\n    [relativePath],\n    {\n      cwd: ROOT,\n      encoding: \"utf8\",\n      stdio: \"pipe\",\n    },\n  );\n\n  if (result.status !== 0) {\n    const stdout = result.stdout?.trim() ?? \"\";\n    const stderr = result.stderr?.trim() ?? \"\";\n    fail(\n      `${label} reprovou.\\n${stdout}${stdout && stderr ? \"\\n\" : \"\"}${stderr}`,\n    );\n  }\n}\n\nfunction main() {\n  assertProjectRoot();\n  assertCanonicalModuleLayout();\n  assertPublicFacadesDoNotLeakInternal();\n  assertCoreFacadePolicy();\n  assertViteExcludesMigrationHistory();\n\n  runGuardrail(\n    \"scripts/architecture/check-boundaries.mjs\",\n    \"check-boundaries\",\n  );\n\n  runGuardrail(\n    \"scripts/architecture/check-dependencies.mjs\",\n    \"check-dependencies\",\n  );\n\n  console.log(\"============================================================\");\n  console.log(\"  PROJETO1 — ETAPA 30: ARCHITECTURE SMOKE\");\n  console.log(\"============================================================\");\n  console.log(`[OK] Módulos canônicos: ${CANONICAL_MODULES.length}`);\n  console.log(\"[OK] Todos possuem /public, /internal e public/index.ts.\");\n  console.log(\"[OK] Fachadas públicas dos módulos não referenciam /internal.\");\n  console.log(\"[OK] @core preserva promoção pública explícita de satisfies.\");\n  console.log(\"[OK] @core não expõe runtime/*.\");\n  console.log(\"[OK] Vitest ignora histórico em .migration/**.\");\n  console.log(\"[OK] check-boundaries passou.\");\n  console.log(\"[OK] check-dependencies passou.\");\n  console.log(\"============================================================\");\n  console.log(\"  ARCHITECTURE SMOKE: PASS\");\n  console.log(\"============================================================\");\n}\n\nmain();\n";

function fail(message) {
  console.error(`[${TAG}] ERRO: ${message}`);
  process.exit(1);
}

function mode(argv) {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === "--check")) return "check";
  if (argv.length === 1 && argv[0] === "--apply") return "apply";
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    console.log(`
Projeto1 — Etapa 30: correção do architecture smoke

Uso:
  node scripts/architecture/stage30-fix-architecture-smoke.mjs --check
  node scripts/architecture/stage30-fix-architecture-smoke.mjs --apply

Escopo:
  - altera somente tests/architecture-smoke-test.mjs;
  - reconhece a promoção pública deliberada de satisfies via @core;
  - continua proibindo runtime/* na fachada;
  - delega fiscalização de consumidores externos aos guardrails oficiais:
    check-boundaries.mjs e check-dependencies.mjs.
`);
    process.exit(0);
  }
  fail("argumentos inválidos.");
}

function normalize(value) {
  return value.replace(/\r\n/g, "\n");
}

const selected = mode(process.argv.slice(2));
const full = path.join(ROOT, ...TARGET.split("/"));

if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
  fail(`${TARGET} ausente; instale primeiro a Etapa 30.`);
}

const current = normalize(fs.readFileSync(full, "utf8"));
const expected = normalize(EXPECTED);

const alreadyFixed = current === expected;
const hasOldBadAssertion =
  current.includes("function assertCoreFacadeBoundary()") &&
  current.includes("src/core/index.ts referencia diretamente paths de internal/runtime.");

console.log(`[${TAG}] modo ${selected}${selected === "check" ? " (read-only)" : ""}`);
console.log(`Arquivo no escopo: ${TARGET}`);

if (alreadyFixed) {
  console.log("Pendências: 0");
  console.log("Correção do architecture smoke já instalada e idempotente.");
  process.exit(0);
}

if (!hasOldBadAssertion) {
  fail(
    "architecture-smoke-test.mjs está em estado desconhecido; não vou sobrescrever.",
  );
}

console.log("Pendências: 1");
console.log(`  PENDENTE ${TARGET}`);

if (selected === "check") {
  console.log("Correção ainda precisa ser aplicada.");
  process.exit(0);
}

const tmp = `${full}.stage30fix.tmp`;
fs.writeFileSync(tmp, EXPECTED, "utf8");
fs.renameSync(tmp, full);

if (normalize(fs.readFileSync(full, "utf8")) !== expected) {
  fail("validação pós-write falhou.");
}

console.log(`[${TAG}] aplicado com sucesso.`);
console.log(`  OK ${TARGET}`);
console.log("Nenhum arquivo do Core foi alterado.");
