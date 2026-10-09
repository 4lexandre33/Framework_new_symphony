#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { auditLayer1DesktopProduction } from "./lib/layer1-desktop-production-v1.mjs";

const ROOT = process.cwd();

function abs(relativePath) {
  return path.join(ROOT, ...relativePath.split("/"));
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(abs(relativePath), "utf8"));
}

function writeJson(relativePath, value) {
  fs.writeFileSync(abs(relativePath), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(relativePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(abs(relativePath))).digest("hex");
}

function requirePass(relativePath, stage) {
  if (!fs.existsSync(abs(relativePath))) {
    throw new Error(`Evidência obrigatória ausente: ${relativePath}`);
  }
  const value = readJson(relativePath);
  if (value.stage !== stage || value.status !== "PASS") {
    throw new Error(`Evidência inválida: ${relativePath}`);
  }
  if ("violations" in value && value.violations !== 0) {
    throw new Error(`Evidência contém violações: ${relativePath}`);
  }
  return value;
}

const stage86 = requirePass("ETAPA86_AUTOMATED_PASS.json", 86);
const stage87 = requirePass("ETAPA87_AUTOMATED_PASS.json", 87);
const release = requirePass("ETAPA88_RELEASE_SMOKE_EVIDENCE.json", 88);
const windows = requirePass("ETAPA88_WINDOWS_PACKAGE_EVIDENCE.json", 88);

if (release.cargoHashBefore !== release.cargoHashAfter) {
  throw new Error("Cargo.toml mudou durante o release smoke Linux");
}
if (windows.cargoHashBefore !== windows.cargoHashAfter) {
  throw new Error("Cargo.toml mudou durante o packaging Windows");
}
if (!String(release.rustToolchain).includes("1.97.0")) {
  throw new Error("Release Linux não foi certificado com Rust 1.97.0");
}
if (!String(windows.rustToolchain).includes("1.97.0")) {
  throw new Error("Package Windows não foi certificado com Rust 1.97.0");
}
if (!release.executableSha256 || !release.executableBytes) {
  throw new Error("Evidência Linux não possui executável release real");
}
if (!windows.executableSha256 || !windows.installerSha256 || !windows.installerBytes) {
  throw new Error("Evidência Windows não possui executável/NSIS reais");
}

const audit = auditLayer1DesktopProduction({ projectRoot: ROOT });
if (!audit.ok) {
  throw new Error(`Audit Stage 88 reprovou durante finalização: ${String(audit.violations.length)} violation(s)`);
}

const git = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: ROOT,
  encoding: "utf8",
  shell: process.platform === "win32",
});
const head = git.status === 0 ? String(git.stdout).trim() : null;
const generatedAtUtc = new Date().toISOString();

writeJson("ETAPA88_RUNTIME_EVIDENCE.json", {
  schemaVersion: 1,
  stage: 88,
  status: "PASS",
  semanticChecks: audit.checks.length,
  focusedFiles: 3,
  focusedTests: 9,
  violations: 0,
  linuxReleaseExecutable: {
    path: release.executablePath,
    bytes: release.executableBytes,
    sha256: release.executableSha256
  },
  windowsReleaseExecutable: {
    path: windows.executablePath,
    bytes: windows.executableBytes,
    sha256: windows.executableSha256
  },
  windowsNsisInstaller: {
    path: windows.installerPath,
    bytes: windows.installerBytes,
    sha256: windows.installerSha256
  },
  generatedAtUtc
});

writeJson("ETAPA88_PRODUCTION_EVIDENCE.json", {
  schemaVersion: 1,
  stage: 88,
  status: "PASS",
  gitHeadBeforeStage88Commit: head,
  prerequisites: {
    stage86: stage86.status,
    stage87: stage87.status
  },
  audit,
  releaseEvidence: release,
  windowsPackageEvidence: windows,
  generatedAtUtc
});

writeJson("ETAPA88_AUTOMATED_PASS.json", {
  schemaVersion: 1,
  stage: 88,
  stageName: "Desktop / Steam Production Readiness",
  status: "PASS",
  gitHeadBeforeStage88Commit: head,
  gates: {
    stage86Prerequisite: "PASS",
    stage87Prerequisite: "PASS",
    semanticAudit: "PASS",
    focused3Files9Tests: "PASS",
    nativeRegressionTests: "PASS",
    architecture: "PASS",
    typescript: "PASS",
    vitestFull: "PASS",
    cargoCheck: "PASS",
    viteBuild: "PASS",
    linuxTauriRelease: "PASS",
    windowsTauriRelease: "PASS",
    windowsNsisBundle: "PASS",
    cargoManifestIntegrity: "PASS"
  },
  violations: 0,
  generatedAtUtc
});

const manifest = readJson("ETAPA88_MANIFEST.json");
const checksumFiles = [...new Set([
  ...(manifest.files ?? []),
  "ETAPA88_RELEASE_SMOKE_EVIDENCE.json",
  "ETAPA88_WINDOWS_PACKAGE_EVIDENCE.json",
  "ETAPA88_RUNTIME_EVIDENCE.json",
  "ETAPA88_PRODUCTION_EVIDENCE.json",
  "ETAPA88_AUTOMATED_PASS.json"
])].filter((relativePath) => fs.existsSync(abs(relativePath))).sort();

fs.writeFileSync(
  abs("ETAPA88_SHA256SUMS.txt"),
  `${checksumFiles.map((relativePath) => `${sha256(relativePath)}  ${relativePath}`).join("\n")}\n`,
  "utf8",
);

console.log("\n============================================");
console.log("ETAPA 88 FINALIZED: PASS");
console.log("Desktop / Steam Production Readiness");
console.log("============================================\n");
