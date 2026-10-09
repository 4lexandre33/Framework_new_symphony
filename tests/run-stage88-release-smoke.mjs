#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const CARGO_MANIFEST = path.join(ROOT, "src-tauri", "Cargo.toml");
const EXECUTABLE = path.join(ROOT, "src-tauri", "target", "release", "projeto1");
const EVIDENCE = path.join(ROOT, "ETAPA88_RELEASE_SMOKE_EVIDENCE.json");
const TAURI_ARGS = ["tauri", "build", "--no-bundle", "--config", "src-tauri/tauri.stage88.conf.json"];

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function preserveCargoManifest() {
  const originalBytes = fs.readFileSync(CARGO_MANIFEST);
  const originalMode = fs.statSync(CARGO_MANIFEST).mode;

  return {
    hash: sha256Buffer(originalBytes),
    restore() {
      const currentBytes = fs.readFileSync(CARGO_MANIFEST);
      const mutated = !currentBytes.equals(originalBytes);

      if (mutated) {
        fs.writeFileSync(CARGO_MANIFEST, originalBytes);
        fs.chmodSync(CARGO_MANIFEST, originalMode);
        console.log("[OK] src-tauri/Cargo.toml restaurado byte-a-byte após Tauri CLI");
      }

      return mutated;
    },
  };
}

function runCapture(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: { ...process.env, CARGO_BUILD_JOBS: "1" },
    encoding: "utf8",
    shell: false,
  });

  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`${command} ${args.join(" ")} falhou com exit code ${String(result.status)}`);
  }

  return String(result.stdout ?? "").trim();
}

if (process.platform !== "linux") {
  throw new Error(`Stage88 Linux release smoke requer linux; atual=${process.platform}`);
}

if (!fs.existsSync(path.join(ROOT, "dist", "index.html"))) {
  throw new Error("dist/index.html ausente; execute Stage88 validator antes do release smoke");
}

const cargoSnapshot = preserveCargoManifest();
const cargoHashBefore = cargoSnapshot.hash;
const rustToolchain = runCapture("rustc", ["--version"]);
let cargoManifestMutatedByTauri = false;
let tauriStatus = null;

console.log("===== STAGE88 TAURI LINUX RELEASE (NO BUNDLE) =====");
try {
  const tauri = spawnSync("npx", TAURI_ARGS, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, CARGO_BUILD_JOBS: "1" },
    shell: false,
  });
  tauriStatus = tauri.status;
} finally {
  cargoManifestMutatedByTauri = cargoSnapshot.restore();
}

if (tauriStatus !== 0) {
  throw new Error(`Tauri Linux release falhou com exit code ${String(tauriStatus)}`);
}

const cargoHashAfter = sha256File(CARGO_MANIFEST);
const cargoManifestRestored = cargoHashAfter === cargoHashBefore;
if (!cargoManifestRestored) {
  throw new Error("src-tauri/Cargo.toml não foi restaurado ao conteúdo original");
}

if (!fs.existsSync(EXECUTABLE) || !fs.statSync(EXECUTABLE).isFile()) {
  throw new Error("Executável release Linux não foi produzido em src-tauri/target/release/projeto1");
}

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
  executablePath: "src-tauri/target/release/projeto1",
  executableBytes: fs.statSync(EXECUTABLE).size,
  executableSha256: sha256File(EXECUTABLE),
  frontendEntry: "dist/index.html",
  tauriConfigOverride: "src-tauri/tauri.stage88.conf.json",
  generatedAtUtc: new Date().toISOString()
};

fs.writeFileSync(EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(`[OK] Stage88 Linux release: ${evidence.executableBytes} bytes / ${evidence.executableSha256}`);
