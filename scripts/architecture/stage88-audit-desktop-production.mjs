import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const checks = [];
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));
const record = (id, ok, detail) => checks.push({ id, ok, detail });

const pkg = json("package.json");
const tauri = json("src-tauri/tauri.conf.json");
const cargo = read("src-tauri/Cargo.toml");
const main = read("src-tauri/src/main.rs");
const lib = read("src-tauri/src/lib.rs");
const appId = read("src-tauri/steam_appid.txt").trim();
const input = read("src/engine/input/internal/KeyboardMouseDriver.ts");
const viewport = read("src/engine/render/internal/ViewportManager.ts");

record("project.version", pkg.version === "0.1.0", "package version remains synchronized with native package");
record("tauri.identity", tauri.productName === "projeto1" && tauri.identifier === "com.projeto1.game", "desktop identity is stable");
record("tauri.frontend-dist", tauri.build?.frontendDist === "../dist", "Tauri release consumes Vite dist");
record("tauri.bundle", tauri.bundle?.active === true && Array.isArray(tauri.bundle?.icon) && tauri.bundle.icon.length > 0, "bundle and icons are enabled");
record("tauri.csp", typeof tauri.app?.security?.csp === "string" && tauri.app.security.csp.length > 0, "explicit CSP is configured");
const win = tauri.app?.windows?.[0] ?? {};
record("window.desktop", win.width === 1280 && win.height === 720 && win.resizable === true, "desktop window size/resize contract");
record("window.focus-resize", viewport.includes("resize") && input.includes("blur") && input.includes("visibilitychange"), "resize/focus lifecycle cleanup is present");
record("native.release-subsystem", main.includes("windows_subsystem") && main.includes("release"), "Windows release subsystem policy exists");
record("native.shutdown", lib.includes("RunEvent::Exit") && lib.includes("shutdown"), "native shutdown is tied to Tauri exit");
record("steam.appid", appId === "480", "Steam dev AppID contract is explicit");
record("steam.feature", cargo.includes('default = ["steam"]') && cargo.includes('steam = ["dep:steamworks"]'), "Steam feature remains explicit");
record("cargo.manifest-scope", !cargo.includes("[profile.release]"), "Stage88 does not mutate prior Cargo manifest with release profiles");
record("validation.deterministic", pkg.scripts?.["stage88:validate"]?.includes("stage88-validate-desktop-production.mjs") === true, "Stage88 validation script is exposed");

const failed = checks.filter((x) => !x.ok);
console.log(`[INFO] Stage88 semantic checks: ${checks.length}`);
for (const c of checks) console.log(`[${c.ok ? "OK" : "FAIL"}] ${c.id} :: ${c.detail}`);
if (failed.length) {
  console.error(`[FAIL] Stage88 semantic audit: ${failed.length} violation(s)`);
  process.exit(1);
}
console.log("[OK] Stage88 semantic audit passed");
