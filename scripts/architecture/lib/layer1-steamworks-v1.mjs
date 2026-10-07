import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  auditLayer1PublicApi,
} from "./layer1-public-api-v1.mjs";

import {
  auditLayer1CapabilityGraph,
} from "./layer1-capability-graph-v1.mjs";

import {
  auditLayer1Lifecycle,
} from "./layer1-lifecycle-v1.mjs";

import {
  auditLayer1Networking,
} from "./layer1-networking-v1.mjs";

export const LAYER1_STEAMWORKS_AUDIT_VERSION = "1.0.2";
export const LAYER1_STEAMWORKS_BASELINE_FILE = "LAYER1_STEAMWORKS_BASELINE_V1.json";

export const STEAMWORKS_RUNTIME_FILES = Object.freeze([
  "src-tauri/Cargo.toml",
  "src-tauri/src/steam.rs",
  "src-tauri/src/lib.rs",
  "src/engine/steam/internal/SteamBridgeService.ts",
  "src/plugins/net/plugin.ts",
]);

const REQUIRED_NATIVE_COMMANDS = Object.freeze([
  "steam_runtime_status",
  "steam_is_initialized",
  "steam_get_user",
  "steam_unlock_achievement",
  "steam_set_stat",
  "steam_store_stats",
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
  "steam_cloud_status",
  "steam_cloud_list_files",
  "steam_cloud_write_file",
  "steam_cloud_read_file",
  "steam_cloud_delete_file",
  "steam_overlay_is_enabled",
  "steam_activate_overlay",
  "steam_workshop_download_item",
]);

function abs(projectRoot, relativePath) {
  return path.join(projectRoot, ...relativePath.split("/"));
}

function read(projectRoot, relativePath) {
  const target = abs(projectRoot, relativePath);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new Error(`arquivo ausente: ${relativePath}`);
  }
  return fs.readFileSync(target, "utf8");
}

function sha256(projectRoot, relativePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(abs(projectRoot, relativePath)))
    .digest("hex");
}

function violation(code, scope, message) {
  return Object.freeze({ code, scope, message });
}

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

function addCompatibilityViolation(violations, code, scope, result, message) {
  if (!result.ok) {
    violations.push(
      violation(
        code,
        scope,
        `${message} Violações encontradas: ${String(result.violations?.length ?? 0)}.`,
      ),
    );
  }
}

export function createSteamworksBaseline({ projectRoot = process.cwd() } = {}) {
  const root = path.resolve(projectRoot);
  const ownedFileSha256 = {};

  for (const relativePath of STEAMWORKS_RUNTIME_FILES) {
    ownedFileSha256[relativePath] = sha256(root, relativePath);
  }

  return Object.freeze({
    schemaVersion: 2,
    version: "1.0.2",
    baselineId: "layer1-steamworks-v1-stage84",
    stage: 84,
    layer: 1,
    auditVersion: LAYER1_STEAMWORKS_AUDIT_VERSION,
    referenceSnapshot: "Projeto1_106",
    capabilities: Object.freeze(["game.steam"]),
    dormantSecondaryCapability: "game.steam.net",
    nativeCommands: REQUIRED_NATIVE_COMMANDS,
    ownedFileSha256: Object.freeze(ownedFileSha256),
    baselinePolicy: Object.freeze({
      stage84OwnedRuntimeSha: true,
      publicApi: "delegated-to-stage72-canonical-audit",
      capabilityGraph: "delegated-to-stage73-canonical-audit",
      pluginLifecycle: "delegated-to-stage74-canonical-audit",
      networkingRuntime: "delegated-to-stage83-canonical-audit",
      rawPublicSurfaceShaGate: false,
      steamNetworkCapabilityActivation: "deferred-preserve-stage73",
    }),
  });
}

export function loadSteamworksBaseline(projectRoot = process.cwd()) {
  const target = abs(path.resolve(projectRoot), LAYER1_STEAMWORKS_BASELINE_FILE);
  if (!fs.existsSync(target)) {
    throw new Error(`Steamworks baseline ausente: ${LAYER1_STEAMWORKS_BASELINE_FILE}`);
  }
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

export async function auditLayer1Steamworks({ projectRoot = process.cwd() } = {}) {
  const root = path.resolve(projectRoot);
  const baseline = loadSteamworksBaseline(root);
  const violations = [];

  if (baseline.referenceSnapshot !== "Projeto1_106") {
    violations.push(
      violation(
        "L1STEAM001",
        LAYER1_STEAMWORKS_BASELINE_FILE,
        "baseline da Etapa 84 não está ancorada no snapshot estável Projeto1_106",
      ),
    );
  }

  for (const relativePath of STEAMWORKS_RUNTIME_FILES) {
    const target = abs(root, relativePath);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      violations.push(violation("L1STEAM002", relativePath, "arquivo Stage84 obrigatório ausente"));
      continue;
    }

    const expectedHash = baseline.ownedFileSha256?.[relativePath];
    if (typeof expectedHash !== "string") {
      violations.push(violation("L1STEAM003", relativePath, "arquivo Stage84 não está coberto pela baseline própria"));
      continue;
    }

    if (sha256(root, relativePath) !== expectedHash) {
      violations.push(violation("L1STEAM004", relativePath, "SHA-256 do runtime pertencente à Stage84 divergiu da baseline"));
    }
  }

  const cargo = read(root, "src-tauri/Cargo.toml");
  const native = read(root, "src-tauri/src/steam.rs");
  const host = read(root, "src-tauri/src/lib.rs");
  const bridge = read(root, "src/engine/steam/internal/SteamBridgeService.ts");
  const steamPlugin = read(root, "src/plugins/steam/plugin.ts");
  const netPlugin = read(root, "src/plugins/net/plugin.ts");
  const publicFacade = read(root, "src/engine/steam/public/index.ts");
  const graphBaseline = JSON.parse(read(root, "LAYER1_CAPABILITY_GRAPH_BASELINE_V1.json"));

  if (!cargo.includes('features = ["raw-bindings"]')) {
    violations.push(violation("L1STEAM010", "src-tauri/Cargo.toml", "steamworks raw-bindings não está habilitado"));
  }

  if (countOccurrences(native, "steamworks::Client::init()") !== 1 || native.includes("Client::init_app")) {
    violations.push(violation("L1STEAM011", "native-init", "Steam deve possuir exatamente uma tentativa de inicialização e nenhum fallback init_app"));
  }

  if (!native.includes("AtomicBool") || !native.includes("JoinHandle") || !native.includes("impl Drop for SteamState")) {
    violations.push(violation("L1STEAM012", "native-lifecycle", "callback pump não possui stop/join/Drop certificável"));
  }

  if (native.includes("drop(single_client);")) {
    violations.push(
      violation(
        "L1STEAM012A",
        "native-lifecycle",
        "SingleClient é movido para a closure do callback pump e não pode ser usado novamente após thread::spawn",
      ),
    );
  }

  if (!native.includes("Aplicação seguirá em modo offline") || !bridge.includes("this.available = false")) {
    violations.push(violation("L1STEAM013", "offline-mode", "fallback offline controlado não foi encontrado"));
  }

  if (native.includes("mock_lobby") || native.includes("SystemTime::now()")) {
    violations.push(violation("L1STEAM014", "matchmaking", "lobby mock/sintético ainda existe"));
  }

  for (const command of REQUIRED_NATIVE_COMMANDS) {
    if (!native.includes(`fn ${command}`) || !host.includes(`steam::${command}`)) {
      violations.push(violation("L1STEAM015", command, "comando nativo não está implementado e registrado no invoke handler"));
    }
  }

  for (const symbol of [
    "SteamAPI_ISteamNetworking_SendP2PPacket",
    "SteamAPI_ISteamNetworking_ReadP2PPacket",
    "SteamAPI_ISteamNetworking_GetP2PSessionState",
  ]) {
    if (!native.includes(symbol)) {
      violations.push(violation("L1STEAM016", "p2p", `binding raw ausente: ${symbol}`));
    }
  }

  for (const symbol of [
    "remote_storage()",
    "SteamAPI_ISteamFriends_ActivateGameOverlay",
    "ugc().download_item",
  ]) {
    if (!native.includes(symbol)) {
      violations.push(violation("L1STEAM017", "platform-services", `integração Steam relacionada ausente: ${symbol}`));
    }
  }

  if (!bridge.includes("implements SteamApi, SteamNetworkApi") || bridge.includes("invoke<any>")) {
    violations.push(violation("L1STEAM018", "typescript-bridge", "bridge deve ser tipado, compatível com SteamApi/SteamNetworkApi e sem invoke<any>"));
  }

  if (!netPlugin.includes("await steamApi") || !netPlugin.includes(".checkAvailability();")) {
    violations.push(violation("L1STEAM019", "src/plugins/net/plugin.ts", "game.net precisa aguardar a disponibilidade Steam antes de bindSteamCapability"));
  }

  if (!steamPlugin.includes("ctx.caps.provide(SteamToken, steamService)")) {
    violations.push(violation("L1STEAM020", "src/plugins/steam/plugin.ts", "provider canônico game.steam não foi preservado"));
  }

  if (steamPlugin.includes("SteamNetworkToken") || steamPlugin.includes("ctx.caps.provide(SteamNetworkToken")) {
    violations.push(violation("L1STEAM021", "src/plugins/steam/plugin.ts", "Stage84 não deve ativar game.steam.net nem alterar o grafo certificado da Stage73"));
  }

  if (!(graphBaseline.dormantOwnedCapabilitiesAtCapture ?? []).includes("game.steam.net")) {
    violations.push(violation("L1STEAM022", "LAYER1_CAPABILITY_GRAPH_BASELINE_V1.json", "game.steam.net deve permanecer capability secundária/dormente da baseline canônica"));
  }

  const steamNetProvider = (graphBaseline.graph?.providers ?? []).find(
    (entry) => entry.capabilityId === "game.steam.net",
  );
  if (steamNetProvider !== undefined) {
    violations.push(violation("L1STEAM023", "LAYER1_CAPABILITY_GRAPH_BASELINE_V1.json", "provider de game.steam.net não deve ser introduzido na Stage84"));
  }

  if (host.includes('std::env::set_var("SteamAppId"') || host.includes('std::env::set_var("SteamGameId"')) {
    violations.push(violation("L1STEAM024", "native-host", "AppID de desenvolvimento não pode ser hardcoded no bootstrap nativo"));
  }

  for (const exportSpecifier of [
    '../../../contracts/steam/types',
    '../../../contracts/steam/net-types',
    '../../../tokens/steam',
    '../../../tokens/steam-net',
  ]) {
    if (!publicFacade.includes(exportSpecifier)) {
      violations.push(violation("L1STEAM025", "src/engine/steam/public/index.ts", `fachada pública canônica perdeu export: ${exportSpecifier}`));
    }
  }

  const publicApi = await auditLayer1PublicApi({ projectRoot: root });
  addCompatibilityViolation(
    violations,
    "L1STEAM030",
    "LAYER1_PUBLIC_API_BASELINE_V1.json",
    publicApi,
    "Public API canônica da Stage72 não permanece verde.",
  );

  const capabilityGraph = await auditLayer1CapabilityGraph({ projectRoot: root });
  addCompatibilityViolation(
    violations,
    "L1STEAM031",
    "LAYER1_CAPABILITY_GRAPH_BASELINE_V1.json",
    capabilityGraph,
    "Capability graph canônico da Stage73 não permanece verde.",
  );

  const lifecycle = await auditLayer1Lifecycle({ projectRoot: root });
  addCompatibilityViolation(
    violations,
    "L1STEAM032",
    "LAYER1_LIFECYCLE_BASELINE_V1.json",
    lifecycle,
    "Lifecycle canônico da Stage74 não permanece verde.",
  );

  const networking = await auditLayer1Networking({ projectRoot: root });
  addCompatibilityViolation(
    violations,
    "L1STEAM033",
    "LAYER1_NETWORKING_BASELINE_V1.json",
    networking,
    "Networking Runtime canônico da Stage83 não permanece verde.",
  );

  violations.sort((a, b) => `${a.code}|${a.scope}|${a.message}`.localeCompare(`${b.code}|${b.scope}|${b.message}`));

  return Object.freeze({
    version: LAYER1_STEAMWORKS_AUDIT_VERSION,
    baselineId: baseline.baselineId,
    referenceSnapshot: baseline.referenceSnapshot,
    capabilities: baseline.capabilities,
    dormantSecondaryCapability: baseline.dormantSecondaryCapability,
    nativeCommandCount: REQUIRED_NATIVE_COMMANDS.length,
    compatibility: Object.freeze({
      stage72: publicApi.ok,
      stage73: capabilityGraph.ok,
      stage74: lifecycle.ok,
      stage83: networking.ok,
    }),
    violations: Object.freeze(violations),
    ok: violations.length === 0,
  });
}

export function formatLayer1SteamworksAudit(result) {
  const lines = [
    "============================================================",
    " ETAPA 84 — STEAMWORKS INTEGRATION AUDIT",
    "============================================================",
    `[INFO] Baseline: ${result.baselineId}`,
    `[INFO] Reference snapshot: ${result.referenceSnapshot}`,
    `[INFO] Primary capability: ${result.capabilities.join(", ")}`,
    `[INFO] Secondary capability preserved dormant: ${result.dormantSecondaryCapability}`,
    `[INFO] Native commands: ${String(result.nativeCommandCount)}`,
    `[INFO] Stage72 public API: ${result.compatibility.stage72 ? "PASS" : "FAIL"}`,
    `[INFO] Stage73 capability graph: ${result.compatibility.stage73 ? "PASS" : "FAIL"}`,
    `[INFO] Stage74 lifecycle: ${result.compatibility.stage74 ? "PASS" : "FAIL"}`,
    `[INFO] Stage83 networking: ${result.compatibility.stage83 ? "PASS" : "FAIL"}`,
  ];

  if (result.violations.length === 0) {
    lines.push("[OK] Init/offline/shutdown Steamworks certificados.");
    lines.push("[OK] Achievements/stats + matchmaking + P2P certificados.");
    lines.push("[OK] Steam Cloud + Overlay + Workshop native surfaces certificados.");
    lines.push("[OK] game.net aguarda disponibilidade real da Steam antes do bind P2P.");
    lines.push("[OK] API pública e capability graph anteriores foram preservados.");
    lines.push("ETAPA 84: PASS");
  } else {
    for (const item of result.violations) {
      lines.push(`[FAIL] ${item.code} ${item.scope}: ${item.message}`);
    }
    lines.push("ETAPA 84: FAIL");
  }

  return `${lines.join("\n")}\n`;
}
