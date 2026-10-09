import fs from "node:fs";
import path from "node:path";

export const LAYER1_DESKTOP_PRODUCTION_AUDIT_VERSION = "2.0.1";

function abs(root, relativePath) {
  return path.join(root, ...relativePath.split("/"));
}

function read(root, relativePath) {
  return fs.readFileSync(abs(root, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function readJson(root, relativePath) {
  return JSON.parse(read(root, relativePath));
}

function violation(code, scope, message) {
  return Object.freeze({ code, scope, message });
}

function previousStageIsGreen(root, file, stage) {
  try {
    const parsed = readJson(root, file);
    return parsed.stage === stage && parsed.status === "PASS" && parsed.violations === 0;
  } catch {
    return false;
  }
}

function parseCargoPackageVersion(cargo) {
  const packageBlock = cargo.match(/\[package\]([\s\S]*?)(?:\n\[|$)/u)?.[1] ?? "";
  return packageBlock.match(/^version\s*=\s*"([^"]+)"/mu)?.[1] ?? null;
}

export function auditLayer1DesktopProduction({ projectRoot = process.cwd() } = {}) {
  const root = path.resolve(projectRoot);
  const checks = [];
  const violations = [];

  const record = (id, ok, detail, scope = id) => {
    checks.push(Object.freeze({ id, ok, detail }));
    if (!ok) violations.push(violation("DESKTOP_PRODUCTION_CONTRACT", scope, detail));
  };

  const packageJson = readJson(root, "package.json");
  const tauri = readJson(root, "src-tauri/tauri.conf.json");
  const stage88Override = readJson(root, "src-tauri/tauri.stage88.conf.json");
  const cargo = read(root, "src-tauri/Cargo.toml");
  const main = read(root, "src-tauri/src/main.rs");
  const lib = read(root, "src-tauri/src/lib.rs");
  const viewport = read(root, "src/engine/render/internal/ViewportManager.ts");
  const input = read(root, "src/engine/input/internal/KeyboardMouseDriver.ts");
  const validator = read(root, "scripts/architecture/stage88-validate-desktop-production.mjs");
  const releaseSmoke = read(root, "tests/run-stage88-release-smoke.mjs");
  const windowsSmoke = read(root, "tests/run-stage88-windows-package-smoke.mjs");
  const appId = read(root, "src-tauri/steam_appid.txt").trim();

  record("previous.stage86", previousStageIsGreen(root, "ETAPA86_AUTOMATED_PASS.json", 86), "Stage 86 deve estar PASS/0 violations");
  record("previous.stage87", previousStageIsGreen(root, "ETAPA87_AUTOMATED_PASS.json", 87), "Stage 87 deve estar PASS/0 violations");

  const cargoVersion = parseCargoPackageVersion(cargo);
  record(
    "version.sync",
    packageJson.version === "0.1.0" && tauri.version === packageJson.version && cargoVersion === packageJson.version,
    "package.json, tauri.conf.json e Cargo.toml devem compartilhar version 0.1.0",
  );

  record(
    "tauri.identity",
    tauri.productName === "projeto1" && tauri.identifier === "com.projeto1.game",
    "identidade desktop deve permanecer projeto1/com.projeto1.game",
  );

  record(
    "tauri.build-paths",
    tauri.build?.beforeBuildCommand === "npm run build" &&
      tauri.build?.devUrl === "http://localhost:1420" &&
      tauri.build?.frontendDist === "../dist",
    "build Tauri deve usar npm run build, devUrl :1420 e frontendDist ../dist",
  );

  const icons = Array.isArray(tauri.bundle?.icon) ? tauri.bundle.icon : [];
  record(
    "tauri.bundle-assets",
    tauri.bundle?.active === true &&
      icons.length >= 4 &&
      icons.every((icon) => fs.existsSync(abs(root, `src-tauri/${icon}`))),
    "bundle deve estar ativo e todos os icons declarados devem existir",
  );

  record(
    "tauri.security",
    tauri.app?.withGlobalTauri === false &&
      typeof tauri.app?.security?.csp === "string" &&
      tauri.app.security.csp.length > 0,
    "withGlobalTauri deve estar false e CSP explícita",
  );

  const windowConfig = tauri.app?.windows?.[0] ?? {};
  record(
    "window.desktop-contract",
    windowConfig.width === 1280 &&
      windowConfig.height === 720 &&
      windowConfig.resizable === true &&
      windowConfig.transparent === true &&
      windowConfig.decorations === false &&
      windowConfig.alwaysOnTop === true,
    "configuração desktop da janela deve permanecer explícita e estável",
  );

  record(
    "window.dpi-resize",
    viewport.includes("MAX_PIXEL_RATIO = 2") &&
      viewport.includes("devicePixelRatio") &&
      viewport.includes('addEventListener(\n      "resize"') &&
      viewport.includes('removeEventListener(\n      "resize"'),
    "ViewportManager deve limitar DPR e possuir attach/detach de resize",
  );

  record(
    "window.focus-input",
    input.includes('"blur"') &&
      input.includes('"visibilitychange"') &&
      input.includes('"pointerlockchange"') &&
      input.includes("releaseAllContinuousState"),
    "input deve recuperar blur/visibility/pointer-lock sem estado preso",
  );

  record(
    "native.release-subsystem",
    main.includes('#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]') &&
      main.includes("projeto1_lib::run()"),
    "binário Windows deve ocultar console apenas em release e delegar ao host",
  );

  record(
    "native.startup-shutdown",
    lib.includes("SteamState::initialize()") &&
      lib.includes(".manage(steam_state)") &&
      lib.includes("tauri::RunEvent::Exit") &&
      lib.includes("state::<SteamState>().shutdown()"),
    "SteamState deve iniciar no host e encerrar no RunEvent::Exit",
  );

  const bundleResources = Array.isArray(tauri.bundle?.resources) ? tauri.bundle.resources : [];
  record(
    "steam.dev-release-separation",
    appId === "480" &&
      !lib.includes('std::env::set_var("SteamAppId"') &&
      !bundleResources.some((value) => String(value).includes("steam_appid")),
    "AppID 480 é somente desenvolvimento; release não deve hardcodar/bundlar steam_appid.txt",
  );

  record(
    "steam.cargo-feature",
    cargo.includes('steamworks = { version = "0.11", optional = true') &&
      cargo.includes('default = ["steam"]') &&
      cargo.includes('steam = ["dep:steamworks"]'),
    "Steamworks deve permanecer feature Cargo explícita e default",
  );

  record(
    "cargo.manifest-immutable",
    !cargo.includes("[profile.release]"),
    "Stage 88 não deve adicionar profile.release ao Cargo.toml certificado",
  );

  record(
    "release.override",
    stage88Override.build?.beforeBuildCommand === null,
    "override Stage 88 deve evitar build frontend duplicado dentro do Tauri CLI",
  );

  record(
    "release.cargo-manifest-preservation",
    releaseSmoke.includes("preserveCargoManifest") &&
      releaseSmoke.includes("cargoManifestRestored") &&
      windowsSmoke.includes("preserveCargoManifest") &&
      windowsSmoke.includes("cargoManifestRestored"),
    "smokes nativos devem restaurar Cargo.toml byte-a-byte após normalização transitória do Tauri CLI",
  );

  record(
    "validation.deterministic",
    validator.includes('"--no-file-parallelism"') &&
      validator.includes('CARGO_BUILD_JOBS: "1"'),
    "gate full deve serializar arquivos Vitest e Cargo jobs",
  );

  record(
    "release.linux-real-build",
    releaseSmoke.includes('"tauri", "build", "--no-bundle"') &&
      releaseSmoke.includes("ETAPA88_RELEASE_SMOKE_EVIDENCE.json") &&
      releaseSmoke.includes("cargoHashBefore") &&
      releaseSmoke.includes("executableSha256"),
    "smoke Linux deve gerar release real e evidência/hash do executável",
  );

  record(
    "release.windows-nsis",
    windowsSmoke.includes('"--bundles", "nsis"') &&
      windowsSmoke.includes("ETAPA88_WINDOWS_PACKAGE_EVIDENCE.json") &&
      windowsSmoke.includes("installerSha256") &&
      windowsSmoke.includes("cargoHashBefore"),
    "smoke Windows deve gerar NSIS real e evidência/hash do installer",
  );

  return Object.freeze({
    schemaVersion: 1,
    stage: 88,
    auditVersion: LAYER1_DESKTOP_PRODUCTION_AUDIT_VERSION,
    ok: violations.length === 0,
    checks: Object.freeze(checks),
    violations: Object.freeze(violations),
  });
}

export function formatLayer1DesktopProductionAudit(result) {
  const lines = [
    "============================================================",
    "STAGE 88 — DESKTOP / STEAM PRODUCTION READINESS AUDIT",
    "============================================================",
    `[INFO] Audit version: ${result.auditVersion}`,
    `[INFO] Semantic checks: ${String(result.checks.length)}`,
  ];

  for (const check of result.checks) {
    lines.push(`[${check.ok ? "OK" : "FAIL"}] ${check.id} — ${check.detail}`);
  }

  if (result.ok) {
    lines.push("[OK] Desktop/Steam production audit: 0 violations");
  } else {
    lines.push(`[FAIL] Violations: ${String(result.violations.length)}`);
    for (const item of result.violations) {
      lines.push(`[${item.code}] ${item.scope} — ${item.message}`);
    }
  }

  lines.push("============================================================", "");
  return lines.join("\n");
}
