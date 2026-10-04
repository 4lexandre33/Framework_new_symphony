#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const TAG = "stage-29-fix-module-tests-v3";
const ROOT = process.cwd();

const FILES = [
  "vite.config.ts",
  "tests/steam-integration.test.ts",
  "tests/storage-cloud-db.test.ts",
  "tests/storage-persistence.test.ts",
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
Projeto1 — Etapa 29: correção dos testes módulo a módulo (v3)

Uso:
  node scripts/architecture/stage29-fix-module-tests-v3.mjs --check
  node scripts/architecture/stage29-fix-module-tests-v3.mjs --apply

Escopo:
  - vite.config.ts
  - tests/steam-integration.test.ts
  - tests/storage-cloud-db.test.ts
  - tests/storage-persistence.test.ts

A v3:
  - não depende de formatação exata dos imports;
  - preserva conteúdo desconhecido do vite.config.ts;
  - move apenas SteamBridgeService/StorageService para imports white-box de /internal;
  - mantém createSteamPlugin no plugin;
  - exclui .migration/** da coleta do Vitest;
  - não altera asserts.
`);
    process.exit(0);
  }
  fail("argumentos inválidos.");
}

function read(rel) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    fail(`arquivo obrigatório ausente: ${rel}`);
  }
  return fs.readFileSync(full, "utf8");
}

function writeAtomic(rel, content) {
  const full = path.join(ROOT, rel);
  const tmp = `${full}.stage29v3.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, full);
}

function patchVite(source) {
  if (source.includes("**/.migration/**")) {
    return { content: source, changed: false, description: "vite.config.ts já exclui .migration/**" };
  }

  const marker = "export default defineConfig(() => ({";
  const i = source.indexOf(marker);
  if (i < 0) {
    fail("vite.config.ts não contém defineConfig(() => ({.");
  }

  const insertAt = i + marker.length;
  const block = `

  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/.migration/**",
      "**/{karma,rollup,webpack,vite,jest,ava,babel,nyc,cypress,playwright}.config.*",
    ],
  },`;

  return {
    content: source.slice(0, insertAt) + block + source.slice(insertAt),
    changed: true,
    description: "vite.config.ts: adicionar exclude de .migration/**",
  };
}

function parseNamedImports(source) {
  const imports = [];
  const re = /import\s+(type\s+)?\{([\s\S]*?)\}\s+from\s+(["'])([^"']+)\3\s*;/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    imports.push({
      start: match.index,
      end: re.lastIndex,
      typeOnly: Boolean(match[1]),
      body: match[2],
      quote: match[3],
      specifier: match[4],
      full: match[0],
    });
  }
  return imports;
}

function splitSpecifiers(body) {
  return body
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function rebuildNamedImport(names, specifier, quote = '"', typeOnly = false) {
  if (names.length === 1) {
    return `import ${typeOnly ? "type " : ""}{ ${names[0]} } from ${quote}${specifier}${quote};`;
  }
  return `import ${typeOnly ? "type " : ""}{\n  ${names.join(",\n  ")},\n} from ${quote}${specifier}${quote};`;
}

function patchSteam(source) {
  const internalSpecifier = "../src/engine/steam/internal/SteamBridgeService";
  const pluginSpecifier = "../src/plugins/steam/plugin";

  const imports = parseNamedImports(source);
  const alreadyInternal = imports.some(
    (imp) => imp.specifier === internalSpecifier &&
      splitSpecifiers(imp.body).some((n) => /^SteamBridgeService(?:\s+as\s+\w+)?$/.test(n)),
  );

  if (alreadyInternal) {
    return { content: source, changed: false, description: "SteamBridgeService já está em /internal" };
  }

  const pluginImport = imports.find(
    (imp) => imp.specifier === pluginSpecifier &&
      splitSpecifiers(imp.body).some((n) => /^SteamBridgeService(?:\s+as\s+\w+)?$/.test(n)),
  );

  if (!pluginImport) {
    fail("tests/steam-integration.test.ts: não encontrei SteamBridgeService importado do plugin nem de /internal.");
  }

  const names = splitSpecifiers(pluginImport.body);
  const kept = names.filter((n) => !/^SteamBridgeService(?:\s+as\s+\w+)?$/.test(n));

  const replacementParts = [
    rebuildNamedImport(["SteamBridgeService"], internalSpecifier, pluginImport.quote, false),
  ];

  if (kept.length > 0) {
    replacementParts.push(
      rebuildNamedImport(kept, pluginSpecifier, pluginImport.quote, pluginImport.typeOnly),
    );
  }

  const replacement = replacementParts.join("\n\n");
  const content = source.slice(0, pluginImport.start) + replacement + source.slice(pluginImport.end);

  return {
    content,
    changed: true,
    description: "steam-integration.test.ts: SteamBridgeService -> /internal",
  };
}

function patchStorage(source, rel) {
  const internalSpecifier = "../src/engine/storage/internal/StorageService";
  const pluginSpecifier = "../src/plugins/storage/plugin";

  const imports = parseNamedImports(source);

  const alreadyInternal = imports.some(
    (imp) => imp.specifier === internalSpecifier &&
      splitSpecifiers(imp.body).some((n) => /^StorageService(?:\s+as\s+\w+)?$/.test(n)),
  );

  if (alreadyInternal) {
    return { content: source, changed: false, description: `${rel}: StorageService já está em /internal` };
  }

  const pluginImport = imports.find(
    (imp) => imp.specifier === pluginSpecifier &&
      splitSpecifiers(imp.body).some((n) => /^StorageService(?:\s+as\s+\w+)?$/.test(n)),
  );

  if (!pluginImport) {
    fail(`${rel}: não encontrei StorageService importado do plugin nem de /internal.`);
  }

  const names = splitSpecifiers(pluginImport.body);
  const kept = names.filter((n) => !/^StorageService(?:\s+as\s+\w+)?$/.test(n));

  const replacementParts = [
    rebuildNamedImport(["StorageService"], internalSpecifier, pluginImport.quote, false),
  ];

  if (kept.length > 0) {
    replacementParts.push(
      rebuildNamedImport(kept, pluginSpecifier, pluginImport.quote, pluginImport.typeOnly),
    );
  }

  const replacement = replacementParts.join("\n\n");
  const content = source.slice(0, pluginImport.start) + replacement + source.slice(pluginImport.end);

  return {
    content,
    changed: true,
    description: `${rel}: StorageService -> /internal`,
  };
}

function buildPlan() {
  return new Map([
    ["vite.config.ts", patchVite(read("vite.config.ts"))],
    ["tests/steam-integration.test.ts", patchSteam(read("tests/steam-integration.test.ts"))],
    ["tests/storage-cloud-db.test.ts", patchStorage(read("tests/storage-cloud-db.test.ts"), "tests/storage-cloud-db.test.ts")],
    ["tests/storage-persistence.test.ts", patchStorage(read("tests/storage-persistence.test.ts"), "tests/storage-persistence.test.ts")],
  ]);
}

function validatePostState() {
  const vite = read("vite.config.ts");
  const steam = read("tests/steam-integration.test.ts");
  const cloud = read("tests/storage-cloud-db.test.ts");
  const persistence = read("tests/storage-persistence.test.ts");

  if (!vite.includes("**/.migration/**")) fail("vite.config.ts ainda não exclui .migration/**.");
  if (!steam.includes("../src/engine/steam/internal/SteamBridgeService")) {
    fail("SteamBridgeService ainda não aponta para /internal.");
  }
  if (!cloud.includes("../src/engine/storage/internal/StorageService")) {
    fail("storage-cloud-db.test.ts ainda não aponta StorageService para /internal.");
  }
  if (!persistence.includes("../src/engine/storage/internal/StorageService")) {
    fail("storage-persistence.test.ts ainda não aponta StorageService para /internal.");
  }
}

const mode = parseMode(process.argv.slice(2));
const plan = buildPlan();
const pending = [...plan.entries()].filter(([, result]) => result.changed);

console.log(`[${TAG}] modo ${mode}${mode === "check" ? " (read-only)" : ""}`);
console.log(`Arquivos no escopo: ${FILES.length}`);
console.log(`Arquivos pendentes: ${pending.length}`);
for (const [rel, result] of pending) {
  console.log(`  PENDENTE ${rel} — ${result.description}`);
}

if (mode === "check") {
  if (pending.length === 0) {
    validatePostState();
    console.log("Correção da Etapa 29 já instalada e idempotente.");
  } else {
    console.log("Correção da Etapa 29 ainda precisa ser aplicada.");
  }
  process.exit(0);
}

const backups = new Map();
const written = [];

try {
  for (const [rel, result] of pending) {
    backups.set(rel, read(rel));
    writeAtomic(rel, result.content);
    written.push(rel);
  }
} catch (error) {
  for (const rel of written.reverse()) {
    try {
      writeAtomic(rel, backups.get(rel));
    } catch {}
  }
  fail(error instanceof Error ? error.stack ?? error.message : String(error));
}

validatePostState();

const remaining = [...buildPlan().entries()].filter(([, result]) => result.changed);
if (remaining.length > 0) {
  fail(`aplicação não convergiu: ${remaining.map(([rel]) => rel).join(", ")}`);
}

console.log(`[${TAG}] aplicado com sucesso.`);
for (const rel of FILES) console.log(`  OK ${rel}`);
console.log("Nenhum assert foi removido ou afrouxado.");
