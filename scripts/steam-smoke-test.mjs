#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const failures = [];
const successes = [];

function checkFileExists(relPath) {
  const fullPath = path.join(ROOT_DIR, relPath);
  if (!fs.existsSync(fullPath)) {
    failures.push(`Arquivo ausente: ${relPath}`);
    return false;
  }
  successes.push(`Arquivo encontrado: ${relPath}`);
  return true;
}

function checkFileContains(relPath, snippet) {
  const fullPath = path.join(ROOT_DIR, relPath);
  if (!fs.existsSync(fullPath)) return;
  const content = fs.readFileSync(fullPath, "utf8");
  if (!content.includes(snippet)) {
    failures.push(`O arquivo ${relPath} nao contem o trecho esperado: "${snippet}"`);
  } else {
    successes.push(`Validado em ${relPath}: contem "${snippet}"`);
  }
}

console.log("============================================================");
console.log("  Auditoria de Sanidade da Integracao Steamworks (Tauri 2)  ");
console.log("============================================================\n");

checkFileExists("steam_appid.txt");
checkFileContains("steam_appid.txt", "480");

checkFileExists("src-tauri/Cargo.toml");
checkFileContains("src-tauri/Cargo.toml", "steamworks");

checkFileExists("src-tauri/src/steam.rs");
checkFileContains("src-tauri/src/steam.rs", "pub fn steam_is_initialized");
checkFileContains("src-tauri/src/steam.rs", "pub fn steam_get_user");
checkFileContains("src-tauri/src/steam.rs", "pub fn steam_unlock_achievement");

checkFileExists("src-tauri/src/lib.rs");
checkFileContains("src-tauri/src/lib.rs", "steamworks::Client::init()");

checkFileExists("src/tokens/steam.ts");
checkFileExists("src/plugins/steam/plugin.ts");

console.log("\n--- Resultados ---");
for (const ok of successes) {
  console.log(`\x1b[32m[OK]\x1b[0m ${ok}`);
}

if (failures.length > 0) {
  console.log("\n--- Erros Encontrados ---");
  for (const err of failures) {
    console.log(`\x1b[31m[ERRO]\x1b[0m ${err}`);
  }
  console.log("\n\x1b[31mA integracao com a Steam precisa de ajustes antes de compilar.\x1b[0m");
  process.exit(1);
} else {
  console.log("\n\x1b[32mTodos os requisitos da Steamworks API estao prontos para teste!\x1b[0m\n");
}