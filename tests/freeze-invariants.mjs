#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const violations = [];

function checkSnippet(relPath, snippet, description) {
  const fullPath = path.join(ROOT_DIR, relPath);
  if (!fs.existsSync(fullPath)) {
    violations.push(`Arquivo essencial ausente: ${relPath}`);
    return;
  }
  const content = fs.readFileSync(fullPath, "utf8");
  if (!content.includes(snippet)) {
    violations.push(`Invariante violada em ${relPath}: ausência de '${description}'`);
  }
}

console.log("============================================================");
console.log("  Auditoria de Invariantes Arquiteturais do Projeto          ");
console.log("============================================================\n");

// 1. Invariantes da API da Steam
checkSnippet("src-tauri/src/steam.rs", "serde(rename_all = \"camelCase\")", "Serialização camelCase nos DTOs");
checkSnippet("src-tauri/src/steam.rs", "client.user_stats()", "Uso do método oficial user_stats() do Rust");
checkSnippet("src-tauri/src/lib.rs", "steamworks::Client::init_app", "Inicialização via init_app(480)");
checkSnippet("src-tauri/src/lib.rs", "thread::spawn", "Thread dedicada de callbacks da Steam");

// 2. Invariantes de Comunicação no Frontend
checkSnippet("src/plugins/steam/plugin.ts", "SteamToken", "Registro do Token de Capability da Steam");
checkSnippet("src/plugins/steam/plugin.ts", "BossDefeatedEvent", "Definição do evento de chefe no Kernel");

if (violations.length > 0) {
  console.log("\x1b[31m[FALHA NAS INVARIANTE]\x1b[0m Foram encontradas quebras de contrato no código:");
  for (const v of violations) {
    console.log(`  - \x1b[31m${v}\x1b[0m`);
  }
  console.log();
  process.exit(1);
} else {
  console.log("\x1b[32m[SUCESSO] Todas as invariantes arquiteturais do projeto foram respeitadas!\x1b[0m\n");
}