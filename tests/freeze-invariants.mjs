#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  CANONICAL_MODULES,
  FUNCTIONAL_MODULES,
  RUNTIME_MODULES,
  getCanonicalModule,
} from "../scripts/architecture/module-map.mjs";

const ROOT_DIR = process.cwd();
const violations = [];

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT_DIR, relativePath));
}

function checkFile(relativePath, description) {
  if (!exists(relativePath)) {
    violations.push(`Arquivo essencial ausente (${description}): ${relativePath}`);
  }
}

function checkDirectory(relativePath, description) {
  const fullPath = path.join(ROOT_DIR, relativePath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
    violations.push(`Diretório essencial ausente (${description}): ${relativePath}`);
  }
}

function checkSnippet(relativePath, snippet, description) {
  const fullPath = path.join(ROOT_DIR, relativePath);
  if (!fs.existsSync(fullPath)) {
    violations.push(`Arquivo essencial ausente: ${relativePath}`);
    return;
  }

  const content = fs.readFileSync(fullPath, "utf8");
  if (!content.includes(snippet)) {
    violations.push(`Invariante violada em ${relativePath}: ausência de '${description}'`);
  }
}

console.log("============================================================");
console.log("  Auditoria de Invariantes Arquiteturais do Projeto          ");
console.log("============================================================");
console.log("Fonte: scripts/architecture/module-map.mjs\n");

if (FUNCTIONAL_MODULES.length !== 20) {
  violations.push(`module-map deve declarar 20 módulos funcionais; encontrou ${FUNCTIONAL_MODULES.length}`);
}

if (RUNTIME_MODULES.length !== 3) {
  violations.push(`module-map deve declarar 3 runtimes fundamentais; encontrou ${RUNTIME_MODULES.length}`);
}

if (CANONICAL_MODULES.length !== 23) {
  violations.push(`module-map deve declarar 23 módulos canônicos; encontrou ${CANONICAL_MODULES.length}`);
}

const keys = new Set();
const capabilities = new Set();

for (const moduleRecord of CANONICAL_MODULES) {
  if (keys.has(moduleRecord.key)) {
    violations.push(`Chave de módulo duplicada no module-map: ${moduleRecord.key}`);
  }
  keys.add(moduleRecord.key);

  if (capabilities.has(moduleRecord.capabilityId)) {
    violations.push(`Capability primária duplicada no module-map: ${moduleRecord.capabilityId}`);
  }
  capabilities.add(moduleRecord.capabilityId);

  checkDirectory(moduleRecord.engine.root, `engine.root de ${moduleRecord.key}`);
  checkDirectory(moduleRecord.engine.publicRoot, `publicRoot de ${moduleRecord.key}`);
  checkDirectory(moduleRecord.engine.internalRoot, `internalRoot de ${moduleRecord.key}`);

  for (const contractPath of moduleRecord.contracts) {
    checkFile(contractPath, `contract de ${moduleRecord.key}`);
  }

  for (const tokenRecord of moduleRecord.tokens) {
    checkFile(tokenRecord.path, `token de ${moduleRecord.key}`);
  }

  checkFile(moduleRecord.plugin, `plugin de ${moduleRecord.key}`);

  for (const nativePath of moduleRecord.nativeFiles) {
    checkFile(nativePath, `native file de ${moduleRecord.key}`);
  }

  for (const testPath of moduleRecord.tests) {
    checkFile(testPath, `teste de ${moduleRecord.key}`);
  }

  for (const extraPath of moduleRecord.extraFiles) {
    checkFile(extraPath, `extra file de ${moduleRecord.key}`);
  }
}

// Invariantes semânticas históricas da Steam são preservadas,
// mas os paths pertencentes ao módulo vêm do catálogo canônico.
const steam = getCanonicalModule("steam");
if (!steam) {
  violations.push("Módulo canônico 'steam' ausente do module-map.");
} else {
  const steamNative = steam.nativeFiles.find((filePath) => filePath.endsWith("/steam.rs"));
  if (!steamNative) {
    violations.push("module-map do Steam não declara src-tauri/src/steam.rs.");
  } else {
    checkSnippet(steamNative, 'serde(rename_all = "camelCase")', "Serialização camelCase nos DTOs");
    checkSnippet(steamNative, "client.user_stats()", "Uso do método oficial user_stats() do Rust");
  }

  checkSnippet(steam.plugin, "SteamToken", "Registro do Token de Capability da Steam");
}

checkSnippet("src-tauri/src/steam.rs", "steamworks::Client::init()", "Inicialização via Client::init() (AppID 480 em src-tauri/steam_appid.txt)");
checkFile("src-tauri/steam_appid.txt", "AppID de desenvolvimento");
checkSnippet("src-tauri/src/steam.rs", ".spawn(move ||", "Thread dedicada de callbacks da Steam");

if (violations.length > 0) {
  console.log("\x1b[31m[FALHA NAS INVARIANTES]\x1b[0m Foram encontradas quebras de contrato no código:");
  for (const violation of violations) {
    console.log(`  - \x1b[31m${violation}\x1b[0m`);
  }
  console.log();
  process.exit(1);
}

console.log(
  `\x1b[32m[SUCESSO]\x1b[0m ${CANONICAL_MODULES.length} módulos validados a partir do module-map; ` +
  "invariantes arquiteturais respeitadas.\n",
);
