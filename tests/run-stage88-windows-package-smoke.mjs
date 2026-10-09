#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const CARGO_MANIFEST = path.join(ROOT, "src-tauri", "Cargo.toml");
const EXECUTABLE = path.join(ROOT, "src-tauri", "target", "release", "projeto1.exe");
const NSIS_DIR = path.join(ROOT, "src-tauri", "target", "release", "bundle", "nsis");
const EVIDENCE = path.join(ROOT, "ETAPA88_WINDOWS_PACKAGE_EVIDENCE.json");
const TAURI_ARGS = ["tauri", "build", "--bundles", "nsis", "--config", "src-tauri/tauri.stage88.conf.json"];

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function preserveCargoManifest() {
  const originalBytes = fs.readFileSync(CARGO_MANIFEST);

  return {
    hash: sha256Buffer(originalBytes),
    restore() {
      const currentBytes = fs.readFileSync(CARGO_MANIFEST);
      const mutated = !currentBytes.equals(originalBytes);

      if (mutated) {
        fs.writeFileSync(CARGO_MANIFEST, originalBytes);
        console.log("[OK] src-tauri/Cargo.toml restaurado byte-a-byte após Tauri CLI");
      }

      return mutated;
    },
  };
}

function rustVersion() {
  const result = spawnSync("rustc.exe", ["--version"], {
    cwd: ROOT,
    env: { ...process.env, CARGO_BUILD_JOBS: "1" },
    encoding: "utf8",
    shell: true,
  });

  if (result.status !== 0) {
    throw new Error("rustc --version falhou no runner Windows");
  }

  return String(result.stdout ?? "").trim();
}

function findInstallers() {
  if (!fs.existsSync(NSIS_DIR)) return [];

  return fs.readdirSync(NSIS_DIR)
    .filter((name) => name.toLowerCase().endsWith(".exe"))
    .map((name) => path.join(NSIS_DIR, name))
    .filter((filePath) => fs.statSync(filePath).isFile());
}

if (process.platform !== "win32") {
  throw new Error(`Stage88 Windows package smoke requer win32; atual=${process.platform}`);
}

if (!fs.existsSync(path.join(ROOT, "dist", "index.html"))) {
  throw new Error("dist/index.html ausente; execute npm run build antes do package smoke");
}

const cargoSnapshot = preserveCargoManifest();
const cargoHashBefore = cargoSnapshot.hash;
const rustToolchain = rustVersion();
let cargoManifestMutatedByTauri = false;
let tauriStatus = null;

console.log("===== STAGE88 TAURI WINDOWS RELEASE + NSIS =====");
try {
  const tauri = spawnSync("npx.cmd", TAURI_ARGS, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, CARGO_BUILD_JOBS: "1" },
    shell: true,
  });
  tauriStatus = tauri.status;
} finally {
  cargoManifestMutatedByTauri = cargoSnapshot.restore();
}

if (tauriStatus !== 0) {
  throw new Error(`Tauri Windows/NSIS falhou com exit code ${String(tauriStatus)}`);
}

const cargoHashAfter = sha256File(CARGO_MANIFEST);
const cargoManifestRestored = cargoHashAfter === cargoHashBefore;
if (!cargoManifestRestored) {
  throw new Error("src-tauri/Cargo.toml não foi restaurado ao conteúdo original");
}

if (!fs.existsSync(EXECUTABLE) || !fs.statSync(EXECUTABLE).isFile()) {
  throw new Error("projeto1.exe release não foi produzido");
}

const installers = findInstallers();
if (installers.length === 0) {
  throw new Error("Nenhum instalador .exe encontrado em src-tauri/target/release/bundle/nsis");
}

installers.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
const installer = installers[0];

const evidence = {
  schemaVersion: 1,
  stage: 88,
  status: "PASS",
  platform: process.platform,
  arch: process.arch,
  rustToolchain,
  cargoBuildJobs: 1,
  cargoHashBefore,
  cargoHashAfter,
  cargoManifestMutatedByTauri,
  cargoManifestRestored,
  executablePath: "src-tauri/target/release/projeto1.exe",
  executableBytes: fs.statSync(EXECUTABLE).size,
  executableSha256: sha256File(EXECUTABLE),
  installerPath: path.relative(ROOT, installer).replaceAll("\\", "/"),
  installerBytes: fs.statSync(installer).size,
  installerSha256: sha256File(installer),
  installerCount: installers.length,
  tauriConfigOverride: "src-tauri/tauri.stage88.conf.json",
  generatedAtUtc: new Date().toISOString()
};

fs.writeFileSync(EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(`[OK] Stage88 Windows NSIS: ${evidence.installerBytes} bytes / ${evidence.installerSha256}`);
