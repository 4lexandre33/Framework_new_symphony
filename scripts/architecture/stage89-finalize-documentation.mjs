#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { auditLayer1Documentation } from "./lib/layer1-documentation-v1.mjs";

const ROOT = process.cwd();

const abs = (relativePath) => path.join(ROOT, ...relativePath.split("/"));
const readJson = (relativePath) => JSON.parse(fs.readFileSync(abs(relativePath), "utf8"));
const writeJson = (relativePath, value) =>
  fs.writeFileSync(abs(relativePath), `${JSON.stringify(value, null, 2)}\n`, "utf8");
const sha256 = (relativePath) => crypto.createHash("sha256").update(fs.readFileSync(abs(relativePath))).digest("hex");

// 1. O validate precisa passar; só então as evidências são gravadas.
const validate = spawnSync(process.execPath, ["scripts/architecture/stage89-validate-documentation.mjs"], {
  cwd: ROOT,
  stdio: "inherit",
});
if (validate.status !== 0) {
  console.error("Stage 89 validate falhou; nenhuma evidência foi gravada.");
  process.exit(1);
}

const previous = readJson("ETAPA88_AUTOMATED_PASS.json");
if (previous.stage !== 88 || previous.status !== "PASS" || previous.violations !== 0) {
  throw new Error("Stage 88 não está PASS com zero violações");
}

const audit = await auditLayer1Documentation({ projectRoot: ROOT });
if (!audit.ok) throw new Error(`Audit Stage 89 reprovou durante finalização: ${String(audit.violations.length)} violation(s)`);

const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32" });
const head = git.status === 0 ? String(git.stdout).trim() : null;
const generatedAtUtc = new Date().toISOString();

writeJson("ETAPA89_RUNTIME_EVIDENCE.json", {
  schemaVersion: 1,
  stage: 89,
  status: "PASS",
  semanticChecks: audit.checks.length,
  focusedFiles: 2,
  violations: 0,
  generatedAtUtc,
});

writeJson("ETAPA89_DOCUMENTATION_EVIDENCE.json", {
  schemaVersion: 1,
  stage: 89,
  status: "PASS",
  gitHeadBeforeStage89Commit: head,
  prerequisites: { stage88: previous.status },
  layer1FinalGate: "pending-stage-90",
  audit,
  generatedAtUtc,
});

writeJson("ETAPA89_AUTOMATED_PASS.json", {
  schemaVersion: 1,
  stage: 89,
  stageName: "Layer 1 Documentation",
  status: "PASS",
  gitHeadBeforeStage89Commit: head,
  gates: {
    stage88Prerequisite: "PASS",
    documentationAudit: "PASS",
    focused2Files: "PASS",
    stage88Regression: "PASS",
    architecture: "PASS",
    typescript: "PASS",
    vitestFull: "PASS",
    cargoCheck: "PASS",
    viteBuild: "PASS",
  },
  violations: 0,
  generatedAtUtc,
});

const manifest = readJson("ETAPA89_MANIFEST.json");
const checksumFiles = [
  ...new Set([
    ...(manifest.files ?? []),
    "ETAPA89_RUNTIME_EVIDENCE.json",
    "ETAPA89_DOCUMENTATION_EVIDENCE.json",
    "ETAPA89_AUTOMATED_PASS.json",
  ]),
]
  .filter((relativePath) => fs.existsSync(abs(relativePath)))
  .sort();

fs.writeFileSync(
  abs("ETAPA89_SHA256SUMS.txt"),
  `${checksumFiles.map((relativePath) => `${sha256(relativePath)}  ${relativePath}`).join("\n")}\n`,
  "utf8",
);

console.log("\n============================================");
console.log("ETAPA 89 FINALIZED: PASS");
console.log("Layer 1 Documentation");
console.log("============================================\n");
