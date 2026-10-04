#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const TAG = "stage-29-fix-module-tests-v2";
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
Projeto1 — Etapa 29: correção dos testes módulo a módulo (v2)

Uso:
  node scripts/architecture/stage29-fix-module-tests-v2.mjs --check
  node scripts/architecture/stage29-fix-module-tests-v2.mjs --apply

Escopo:
  - vite.config.ts
  - tests/steam-integration.test.ts
  - tests/storage-cloud-db.test.ts
  - tests/storage-persistence.test.ts

Esta versão é cirúrgica:
  - preserva conteúdo desconhecido do vite.config.ts;
  - adiciona somente a exclusão de **/.migration/** ao Vitest;
  - corrige somente imports white-box conhecidos;
  - não remove asserts nem reexporta implementações internas.
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
  const tmp = `${full}.stage29v2.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, full);
}

function patchVite(source) {
  if (source.includes('"**/.migration/**"') || source.includes("'**/.migration/**'")) {
    return { content: source, changed: false, description: "vite.config.ts já exclui .migration/**" };
  }

  const defineConfigMarker = "export default defineConfig(() => ({";
  const markerIndex = source.indexOf(defineConfigMarker);
  if (markerIndex < 0) {
    fail("vite.config.ts não contém o padrão esperado defineConfig(() => ({.");
  }

  const insertAt = markerIndex + defineConfigMarker.length;
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

function patchExactImport(source, oldText, newText, rel, label) {
  if (source.includes(newText)) {
    return { content: source, changed: false, description: `${rel}: ${label} já corrigido` };
  }
  if (!source.includes(oldText)) {
    fail(`${rel}: import esperado de ${label} não encontrado e versão corrigida também não está presente.`);
  }
  return {
    content: source.replace(oldText, newText),
    changed: true,
    description: `${rel}: corrigir ${label}`,
  };
}

function patchSteam(source) {
  const oldText = `import {
  SteamBridgeService,
  createSteamPlugin,
} from "../src/plugins/steam/plugin";`;

  const newText = `import {
  SteamBridgeService,
} from "../src/engine/steam/internal/SteamBridgeService";

import {
  createSteamPlugin,
} from "../src/plugins/steam/plugin";`;

  return patchExactImport(
    source,
    oldText,
    newText,
    "tests/steam-integration.test.ts",
    "SteamBridgeService white-box",
  );
}

function patchStorage(source, rel) {
  return patchExactImport(
    source,
    'import { StorageService } from "../src/plugins/storage/plugin";',
    'import { StorageService } from "../src/engine/storage/internal/StorageService";',
    rel,
    "StorageService white-box",
  );
}

function buildPlan() {
  const viteBefore = read("vite.config.ts");
  const steamBefore = read("tests/steam-integration.test.ts");
  const storageCloudBefore = read("tests/storage-cloud-db.test.ts");
  const storagePersistenceBefore = read("tests/storage-persistence.test.ts");

  const results = new Map([
    ["vite.config.ts", patchVite(viteBefore)],
    ["tests/steam-integration.test.ts", patchSteam(steamBefore)],
    ["tests/storage-cloud-db.test.ts", patchStorage(storageCloudBefore, "tests/storage-cloud-db.test.ts")],
    ["tests/storage-persistence.test.ts", patchStorage(storagePersistenceBefore, "tests/storage-persistence.test.ts")],
  ]);

  return results;
}

function validatePostState() {
  const vite = read("vite.config.ts");
  const steam = read("tests/steam-integration.test.ts");
  const cloud = read("tests/storage-cloud-db.test.ts");
  const persistence = read("tests/storage-persistence.test.ts");

  if (!vite.includes("**/.migration/**")) {
    fail("vite.config.ts ainda não exclui .migration/**.");
  }

  if (!steam.includes("../src/engine/steam/internal/SteamBridgeService")) {
    fail("steam-integration.test.ts ainda não aponta SteamBridgeService para /internal.");
  }

  for (const [rel, source] of [
    ["tests/storage-cloud-db.test.ts", cloud],
    ["tests/storage-persistence.test.ts", persistence],
  ]) {
    if (!source.includes("../src/engine/storage/internal/StorageService")) {
      fail(`${rel} ainda não aponta StorageService para /internal.`);
    }
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
    } catch {
      // Não mascara a falha original.
    }
  }
  fail(error instanceof Error ? error.stack ?? error.message : String(error));
}

validatePostState();

const post = buildPlan();
const remaining = [...post.entries()].filter(([, result]) => result.changed);
if (remaining.length > 0) {
  fail(`aplicação não convergiu: ${remaining.map(([rel]) => rel).join(", ")}`);
}

console.log(`[${TAG}] aplicado com sucesso.`);
for (const rel of FILES) {
  console.log(`  OK ${rel}`);
}
console.log("Nenhum assert foi removido ou afrouxado.");
