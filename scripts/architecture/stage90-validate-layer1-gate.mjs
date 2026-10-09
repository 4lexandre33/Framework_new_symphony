#!/usr/bin/env node
// Stage 90 — Final Layer 1 Gate: agrega a certificação das Stages 71–89.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const ROOT = process.cwd();
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
const STAGES = Array.from({ length: 19 }, (_, i) => 71 + i);
const EVIDENCE_STAGES = [85, 86, 87, 88, 89];
const RUNTIME_MS = Number(process.env.STAGE90_RUNTIME_MS ?? 15000);

export const results = [];

function fail(message) {
  throw new Error(message);
}

function record(id, ok, detail = "") {
  results.push({ id, ok, detail });
}

function run(label, command, args, env = {}) {
  console.log(`\n===== ${label} =====`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, CARGO_BUILD_JOBS: "1", ...env },
    shell: process.platform === "win32",
  });
  const ok = result.status === 0;
  record(label, ok);
  if (!ok) fail(`${label} falhou com exit code ${String(result.status)}`);
}

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8"));
}

function stageAuditScript(stage) {
  const dir = path.join(ROOT, "scripts", "architecture");
  return fs.readdirSync(dir).find((f) => f.startsWith(`stage${String(stage)}-audit-`) && f.endsWith(".mjs"));
}

function checkEvidence() {
  console.log("\n===== LAYER 1 EVIDENCE (71–89) =====");
  for (const stage of STAGES) {
    const manifest = `ETAPA${String(stage)}_MANIFEST.json`;
    if (!fs.existsSync(path.join(ROOT, manifest))) fail(`Manifesto ausente: ${manifest}`);
    const doc = fs.readdirSync(ROOT).find((f) => f.startsWith(`ETAPA${String(stage)}_`) && f.endsWith(".txt") && !f.includes("SHA256"));
    if (!doc) fail(`Documento técnico ausente da Stage ${String(stage)}`);
  }
  for (const stage of EVIDENCE_STAGES) {
    const file = `ETAPA${String(stage)}_AUTOMATED_PASS.json`;
    if (!fs.existsSync(path.join(ROOT, file))) fail(`Evidência ausente: ${file}`);
    const value = readJson(file);
    const status = value.status ?? value.automatedGates; // Stage 85 usa "automatedGates"
    const violations = value.violations ?? 0;
    if (value.stage !== stage || status !== "PASS" || violations !== 0) fail(`Evidência não é PASS/0 violações: ${file}`);
  }
  record("evidence.stages-71-89", true);
}

async function runtimeSmoke() {
  console.log("\n===== RUNTIME SMOKE (Linux release) =====");
  if (process.platform !== "linux") {
    record("runtime.linux", false, "não-Linux");
    fail("Runtime smoke Linux só roda em Linux");
  }
  const bin = path.join(ROOT, "src-tauri", "target", "release", "projeto1");
  if (!fs.existsSync(bin)) fail("Binário release ausente; rode o build Tauri release antes (npx tauri build --no-bundle --config src-tauri/tauri.stage88.conf.json)");
  const buildDir = path.join(ROOT, "src-tauri", "target", "release", "build");
  const steamLib = fs
    .readdirSync(buildDir)
    .filter((d) => d.startsWith("steamworks-sys-"))
    .map((d) => path.join(buildDir, d, "out"))
    .find((d) => fs.existsSync(path.join(d, "libsteam_api.so")));
  const env = { ...process.env, LD_LIBRARY_PATH: [steamLib, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") };
  const child = spawn("xvfb-run", ["-a", bin], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let output = "";
  child.stdout.on("data", (d) => (output += String(d)));
  child.stderr.on("data", (d) => (output += String(d)));
  let exited = null;
  child.on("exit", (code, signal) => (exited = { code, signal }));
  await new Promise((r) => setTimeout(r, RUNTIME_MS));
  const aliveAfterWait = exited === null;
  try { process.kill(-child.pid, "SIGTERM"); } catch { /* já encerrou */ }
  await new Promise((r) => setTimeout(r, 2000));
  try { process.kill(-child.pid, "SIGKILL"); } catch { /* já encerrou */ }
  const panicked = /panicked at|thread '.*' panicked|error while loading shared libraries/u.test(output);
  const ok = aliveAfterWait && !panicked;
  record("runtime.linux", ok, `aliveAfterMs=${String(RUNTIME_MS)} panicked=${String(panicked)}`);
  fs.writeFileSync(path.join(ROOT, "ETAPA90_RUNTIME_SMOKE.log"), output, "utf8");
  if (!ok) fail(`App não ficou vivo por ${String(RUNTIME_MS)}ms sem panic (ver ETAPA90_RUNTIME_SMOKE.log)`);
}

try {
  checkEvidence();
  for (const stage of STAGES) {
    const script = stageAuditScript(stage);
    if (!script) fail(`Audit da Stage ${String(stage)} não encontrado`);
    run(`AUDIT STAGE ${String(stage)}`, process.execPath, [`scripts/architecture/${script}`]);
  }
  run("FREEZE / AGENTS", process.execPath, ["agents.mjs"]);
  run("ARCHITECTURE", npm, ["run", "arch:check"]);
  run("TYPESCRIPT", npx, ["tsc", "--noEmit"]);
  run("VITEST FULL", npx, ["vitest", "run", "--no-file-parallelism"]);
  run("CARGO CHECK", cargo, ["check", "--manifest-path", "src-tauri/Cargo.toml"]);
  run("VITE BUILD", npm, ["run", "build"]);
  await runtimeSmoke();

  fs.writeFileSync(path.join(ROOT, ".stage90-gate-results.json"), `${JSON.stringify(results, null, 2)}\n`, "utf8");
  console.log("\n============================================================");
  console.log("STAGE 90 PREFLIGHT: PASS");
  console.log("============================================================\n");
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
}
