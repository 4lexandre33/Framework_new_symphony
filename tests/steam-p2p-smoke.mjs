#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const failures = [];
const successes = [];

function checkFileExists(relPath) {
  const fullPath = path.join(ROOT_DIR, relPath);
  if (!fs.existsSync(fullPath)) {
    failures.push(`Arquivo essencial ausente: ${relPath}`);
    return false;
  }
  successes.push(`Arquivo encontrado: ${relPath}`);
  return true;
}

function checkFileContains(relPath, snippet, label) {
  const fullPath = path.join(ROOT_DIR, relPath);
  if (!fs.existsSync(fullPath)) return;
  const content = fs.readFileSync(fullPath, "utf8");
  if (!content.includes(snippet)) {
    failures.push(`O arquivo ${relPath} nao contem: '${label || snippet}'`);
  } else {
    successes.push(`Validado em ${relPath}: ${label || snippet}`);
  }
}

console.log("============================================================");
console.log("  Auditoria de Sanidade P2P & Lobbies da Steam (Tauri 2)    ");
console.log("============================================================\n");

// 1. Arquivos da camada Steam P2P
checkFileExists("src/contracts/steam/net-types.ts");
checkFileExists("src/tokens/steam-net.ts");
checkFileExists("src-tauri/src/steam.rs");
checkFileExists("src-tauri/src/lib.rs");
checkFileExists("src/plugins/steam/plugin.ts");

// 2. Validação dos Contratos de Rede TypeScript
checkFileContains("src/contracts/steam/net-types.ts", "export type P2PSendType", "Tipo P2PSendType");
checkFileContains("src/contracts/steam/net-types.ts", "CreateLobbyCommand", "Comando CreateLobbyCommand");
checkFileContains("src/contracts/steam/net-types.ts", "SendP2PPacketCommand", "Comando SendP2PPacketCommand");

// 3. Validação das Capabilities
checkFileContains("src/tokens/steam-net.ts", "SteamNetworkToken", "Capability Token SteamNetworkToken");
checkFileContains("src/tokens/steam.ts", "createLobby", "Método createLobby em SteamApi");
checkFileContains("src/tokens/steam.ts", "sendP2PPacket", "Método sendP2PPacket em SteamApi");

// 4. Validação dos Bindings Rust
checkFileContains("src-tauri/src/steam.rs", "pub fn steam_create_lobby", "Comando Rust steam_create_lobby");
checkFileContains("src-tauri/src/steam.rs", "pub fn steam_send_p2p_packet", "Comando Rust steam_send_p2p_packet");
checkFileContains("src-tauri/src/steam.rs", "pub fn steam_read_p2p_packet", "Comando Rust steam_read_p2p_packet");
checkFileContains("src-tauri/src/lib.rs", "steam::steam_create_lobby", "Handler de tauri steam_create_lobby");
checkFileContains("src-tauri/src/lib.rs", "steam::steam_send_p2p_packet", "Handler de tauri steam_send_p2p_packet");

console.log("\n--- Resultados ---");
for (const ok of successes) {
  console.log(`\x1b[32m[OK]\x1b[0m ${ok}`);
}

if (failures.length > 0) {
  console.log("\n--- Erros Encontrados ---");
  for (const err of failures) {
    console.log(`\x1b[31m[ERRO]\x1b[0m ${err}`);
  }
  console.log("\n\x1b[31mA integracao P2P da Steam precisa de ajustes antes do congelamento.\x1b[0m");
  process.exit(1);
} else {
  console.log("\n\x1b[32mTodos os requisitos da API P2P & Lobbies da Steam foram validados com sucesso!\x1b[0m\n");
}