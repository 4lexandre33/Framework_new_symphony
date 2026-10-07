#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(relativePath) {
  const target = path.join(root, ...relativePath.split("/"));
  if (!fs.existsSync(target)) {
    failures.push(`Arquivo ausente: ${relativePath}`);
    return "";
  }
  return fs.readFileSync(target, "utf8");
}

const native = read("src-tauri/src/steam.rs");
const host = read("src-tauri/src/lib.rs");
const steamPlugin = read("src/plugins/steam/plugin.ts");
const netPlugin = read("src/plugins/net/plugin.ts");
const bridge = read("src/engine/steam/internal/SteamBridgeService.ts");
const graph = JSON.parse(read("LAYER1_CAPABILITY_GRAPH_BASELINE_V1.json") || "{}");

for (const snippet of [
  "matchmaking.create_lobby",
  "matchmaking.join_lobby",
  "set_lobby_data",
  "lobby_data",
  "SteamAPI_ISteamNetworking_SendP2PPacket",
  "SteamAPI_ISteamNetworking_ReadP2PPacket",
  "SteamAPI_ISteamNetworking_GetP2PSessionState",
  "steam_accept_p2p_session",
  "steam_close_p2p_session",
]) {
  if (!native.includes(snippet)) failures.push(`Backend Steam sem ${snippet}`);
}

for (const command of [
  "steam_create_lobby",
  "steam_join_lobby",
  "steam_leave_lobby",
  "steam_set_lobby_data",
  "steam_get_lobby_data",
  "steam_send_p2p_packet",
  "steam_read_p2p_packet",
  "steam_accept_p2p_session",
  "steam_close_p2p_session",
  "steam_get_p2p_session_state",
]) {
  if (!host.includes(`steam::${command}`)) failures.push(`Invoke handler sem ${command}`);
}

if (!bridge.includes("implements SteamApi, SteamNetworkApi")) {
  failures.push("Bridge interno não satisfaz SteamNetworkApi.");
}

if (!netPlugin.includes("await steamApi") || !netPlugin.includes(".checkAvailability();")) {
  failures.push("game.net não aguarda checkAvailability antes do bind Steam P2P.");
}

if (steamPlugin.includes("SteamNetworkToken") || steamPlugin.includes("ctx.caps.provide(SteamNetworkToken")) {
  failures.push("game.steam.net foi ativada indevidamente na Stage84.");
}

if (!(graph.dormantOwnedCapabilitiesAtCapture ?? []).includes("game.steam.net")) {
  failures.push("Baseline Stage73 deixou de manter game.steam.net como dormente.");
}

if ((graph.graph?.providers ?? []).some((entry) => entry.capabilityId === "game.steam.net")) {
  failures.push("Capability graph contém provider indevido para game.steam.net.");
}

if (native.includes("mock_lobby") || native.includes("SystemTime::now()")) {
  failures.push("Lobby mock ainda está presente.");
}

if (failures.length > 0) {
  failures.forEach((failure) => console.error(`[FAIL] ${failure}`));
  process.exit(1);
}

console.log("[OK] Steam Matchmaking + P2P channel-aware + Stage83 compatibility smoke PASS.");
