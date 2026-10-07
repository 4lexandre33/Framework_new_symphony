#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function source(relativePath) {
  const target = path.join(root, ...relativePath.split("/"));
  if (!fs.existsSync(target)) {
    failures.push(`Arquivo ausente: ${relativePath}`);
    return "";
  }
  return fs.readFileSync(target, "utf8");
}

function contains(relativePath, snippets) {
  const text = source(relativePath);
  for (const snippet of snippets) {
    if (!text.includes(snippet)) failures.push(`${relativePath}: trecho ausente: ${snippet}`);
  }
}

contains("src-tauri/Cargo.toml", ["steamworks", "raw-bindings"]);
contains("src-tauri/src/steam.rs", [
  "pub fn steam_runtime_status",
  "steamworks::Client::init()",
  "AtomicBool",
  "JoinHandle",
  "impl Drop for SteamState",
  "pub fn steam_get_user",
  "pub fn steam_unlock_achievement",
  "pub fn steam_set_stat",
  "pub fn steam_store_stats",
  "pub fn steam_cloud_write_file",
  "pub fn steam_activate_overlay",
  "pub fn steam_workshop_download_item",
]);
contains("src-tauri/src/lib.rs", ["SteamState::initialize()", "state::<SteamState>().shutdown()"]);
contains("src/plugins/steam/plugin.ts", ["ctx.caps.provide(SteamToken, steamService)"]);
contains("src/plugins/net/plugin.ts", ["await steamApi", ".checkAvailability();", "bindSteamCapability"]);
contains("src/engine/steam/internal/SteamBridgeService.ts", ["implements SteamApi, SteamNetworkApi"]);

const native = source("src-tauri/src/steam.rs");
if (native.includes("mock_lobby") || native.includes("SystemTime::now()")) {
  failures.push("Lobby sintético ainda encontrado no backend Steam.");
}

const host = source("src-tauri/src/lib.rs");
if (host.includes('std::env::set_var("SteamAppId"') || host.includes('std::env::set_var("SteamGameId"')) {
  failures.push("SteamAppId/SteamGameId hardcoded ainda encontrado no bootstrap.");
}

const steamPlugin = source("src/plugins/steam/plugin.ts");
if (steamPlugin.includes("SteamNetworkToken")) {
  failures.push("Manifest Steam da Stage73 foi alterado para ativar game.steam.net.");
}

if (failures.length > 0) {
  failures.forEach((failure) => console.error(`[FAIL] ${failure}`));
  process.exit(1);
}

console.log("[OK] Steamworks init/offline/shutdown + canonical graph preservation smoke PASS.");
