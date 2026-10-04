#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const TAG = "stage-30-install-architecture-smoke";
const ROOT = process.cwd();
const TARGET = "tests/architecture-smoke-test.mjs";
const ARCHITECTURE_SMOKE = "#!/usr/bin/env node\nimport fs from \"node:fs\";\nimport path from \"node:path\";\n\nimport {\n  CANONICAL_MODULES,\n} from \"../scripts/architecture/module-map.mjs\";\n\nconst ROOT = process.cwd();\n\nfunction fail(message) {\n  console.error(`[architecture-smoke] ERRO: ${message}`);\n  process.exit(1);\n}\n\nfunction existsFile(relativePath) {\n  const absolutePath = path.join(ROOT, ...relativePath.split(\"/\"));\n  return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile();\n}\n\nfunction existsDir(relativePath) {\n  const absolutePath = path.join(ROOT, ...relativePath.split(\"/\"));\n  return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory();\n}\n\nfunction read(relativePath) {\n  return fs.readFileSync(\n    path.join(ROOT, ...relativePath.split(\"/\")),\n    \"utf8\",\n  );\n}\n\nfunction assertProjectRoot() {\n  for (const relativePath of [\n    \"package.json\",\n    \"vite.config.ts\",\n    \"src/core/index.ts\",\n    \"scripts/architecture/module-map.mjs\",\n    \"scripts/architecture/check-boundaries.mjs\",\n    \"scripts/architecture/check-dependencies.mjs\",\n  ]) {\n    if (!existsFile(relativePath)) {\n      fail(`arquivo obrigatório ausente: ${relativePath}`);\n    }\n  }\n}\n\nfunction assertCanonicalModuleLayout() {\n  const failures = [];\n\n  for (const moduleRecord of CANONICAL_MODULES) {\n    const publicRoot = moduleRecord.engine.publicRoot;\n    const internalRoot = moduleRecord.engine.internalRoot;\n    const facade = `${publicRoot}/index.ts`;\n\n    if (!existsDir(publicRoot)) {\n      failures.push(`${moduleRecord.key}: publicRoot ausente (${publicRoot})`);\n    }\n\n    if (!existsDir(internalRoot)) {\n      failures.push(`${moduleRecord.key}: internalRoot ausente (${internalRoot})`);\n    }\n\n    if (!existsFile(facade)) {\n      failures.push(`${moduleRecord.key}: fachada pública ausente (${facade})`);\n    }\n  }\n\n  if (failures.length > 0) {\n    fail(\n      `layout canônico inválido:\\n${failures\n        .map((item) => `  - ${item}`)\n        .join(\"\\n\")}`,\n    );\n  }\n}\n\nfunction assertPublicFacadesDoNotLeakInternal() {\n  const violations = [];\n\n  for (const moduleRecord of CANONICAL_MODULES) {\n    const facade = `${moduleRecord.engine.publicRoot}/index.ts`;\n    const source = read(facade);\n\n    if (/[\"'][^\"']*\\/internal(?:\\/|[\"'])/u.test(source)) {\n      violations.push(facade);\n    }\n  }\n\n  if (violations.length > 0) {\n    fail(\n      `fachadas públicas referenciam /internal:\\n${violations\n        .map((item) => `  - ${item}`)\n        .join(\"\\n\")}`,\n    );\n  }\n}\n\nfunction assertCoreFacadeBoundary() {\n  const coreFacade = read(\"src/core/index.ts\");\n\n  if (\n    /[\"'][^\"']*(?:\\/internal\\/|\\/runtime\\/)[^\"']*[\"']/u.test(\n      coreFacade,\n    )\n  ) {\n    fail(\"src/core/index.ts referencia diretamente paths de internal/runtime.\");\n  }\n}\n\nfunction assertViteExcludesMigrationHistory() {\n  const viteConfig = read(\"vite.config.ts\");\n  if (!viteConfig.includes(\"**/.migration/**\")) {\n    fail(\"vite.config.ts não exclui .migration/** da coleta do Vitest.\");\n  }\n}\n\nfunction main() {\n  assertProjectRoot();\n  assertCanonicalModuleLayout();\n  assertPublicFacadesDoNotLeakInternal();\n  assertCoreFacadeBoundary();\n  assertViteExcludesMigrationHistory();\n\n  console.log(\"============================================================\");\n  console.log(\"  PROJETO1 — ETAPA 30: ARCHITECTURE SMOKE\");\n  console.log(\"============================================================\");\n  console.log(`[OK] Módulos canônicos: ${CANONICAL_MODULES.length}`);\n  console.log(\"[OK] Todos possuem /public, /internal e public/index.ts.\");\n  console.log(\"[OK] Fachadas públicas não referenciam /internal.\");\n  console.log(\"[OK] Fachada @core não aponta diretamente para internal/runtime.\");\n  console.log(\"[OK] Vitest ignora histórico em .migration/**.\");\n  console.log(\"[OK] Guardrails de boundary/dependency existem.\");\n  console.log(\"============================================================\");\n  console.log(\"  ARCHITECTURE SMOKE: PASS\");\n  console.log(\"============================================================\");\n}\n\nmain();\n";

const MODULE_KEYS = [
  "steam",
  "input",
  "assets",
  "physics",
  "storage",
  "world",
  "ui",
  "anim",
  "sprites",
  "audio",
  "camera",
  "ai",
  "vfx",
  "terrain",
  "scripting",
  "streaming",
  "overlay",
  "security",
  "modding",
  "monetization",
  "game-loop",
  "render",
  "net",
];

function fail(message) {
  console.error(`[${TAG}] ERRO: ${message}`);
  process.exit(1);
}

function parseMode(argv) {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === "--check")) return "check";
  if (argv.length === 1 && argv[0] === "--apply") return "apply";
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    console.log(`
Projeto1 — Etapa 30: instalação do smoke arquitetural

Uso:
  node scripts/architecture/stage30-install-architecture-smoke.mjs --check
  node scripts/architecture/stage30-install-architecture-smoke.mjs --apply

Escopo:
  - verifica smoke tests operacionais existentes em tests/*.mjs;
  - rejeita referências antigas src/engine/<modulo>/<arquivo>;
  - cria somente tests/architecture-smoke-test.mjs;
  - não altera asserts de smoke tests existentes.
`);
    process.exit(0);
  }
  fail("argumentos inválidos.");
}

function scanSmokePaths() {
  const testsDir = path.join(ROOT, "tests");
  if (!fs.existsSync(testsDir)) fail("diretório tests/ ausente.");

  const smokeFiles = fs
    .readdirSync(testsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
    .map((entry) => `tests/${entry.name}`)
    .filter((rel) => rel.includes("smoke") && rel !== TARGET)
    .sort((a, b) => a.localeCompare(b, "en"));

  const violations = [];

  for (const rel of smokeFiles) {
    const text = fs.readFileSync(path.join(ROOT, ...rel.split("/")), "utf8");

    for (const key of MODULE_KEYS) {
      const oldPrefix = `src/engine/${key}/`;
      let index = text.indexOf(oldPrefix);

      while (index >= 0) {
        const tail = text.slice(index + oldPrefix.length);
        if (!tail.startsWith("internal/") && !tail.startsWith("public/")) {
          const line = text.slice(0, index).split(/\r?\n/u).length;
          violations.push(`${rel}:${line} -> ${oldPrefix}`);
        }
        index = text.indexOf(oldPrefix, index + oldPrefix.length);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      `smoke tests ainda contêm paths antigos:\n${violations
        .map((item) => `  - ${item}`)
        .join("\n")}`,
    );
  }

  return smokeFiles;
}

function currentTargetState() {
  const full = path.join(ROOT, ...TARGET.split("/"));
  if (!fs.existsSync(full)) return "missing";
  if (!fs.statSync(full).isFile()) fail(`${TARGET} existe mas não é arquivo.`);
  const current = fs.readFileSync(full, "utf8").replace(/\r\n/g, "\n");
  const expected = ARCHITECTURE_SMOKE.replace(/\r\n/g, "\n");
  return current === expected ? "installed" : "unexpected";
}

function writeAtomic(content) {
  const full = path.join(ROOT, ...TARGET.split("/"));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const temp = `${full}.stage30.tmp`;
  fs.writeFileSync(temp, content, "utf8");
  fs.renameSync(temp, full);
}

const mode = parseMode(process.argv.slice(2));
const smokeFiles = scanSmokePaths();
const state = currentTargetState();

console.log(`[${TAG}] modo ${mode}${mode === "check" ? " (read-only)" : ""}`);
console.log(`Smoke tests operacionais auditados: ${smokeFiles.length}`);
console.log("Paths antigos em smoke tests: 0");
console.log(`architecture-smoke-test.mjs: ${state}`);

if (state === "unexpected") {
  fail(`${TARGET} já existe com conteúdo desconhecido; não vou sobrescrever.`);
}

if (mode === "check") {
  console.log(
    state === "installed"
      ? "Etapa 30 já instalada e idempotente."
      : "Smoke arquitetural ainda precisa ser instalado.",
  );
  process.exit(0);
}

if (state === "missing") {
  writeAtomic(ARCHITECTURE_SMOKE);
}

if (currentTargetState() !== "installed") {
  fail("validação pós-write falhou.");
}

console.log(`[${TAG}] aplicado com sucesso.`);
console.log(`  OK ${TARGET}`);
console.log("Nenhum smoke existente foi afrouxado ou reescrito.");
