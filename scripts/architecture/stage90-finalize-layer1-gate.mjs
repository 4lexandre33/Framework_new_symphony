#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const abs = (r) => path.join(ROOT, ...r.split("/"));
const readJson = (r) => JSON.parse(fs.readFileSync(abs(r), "utf8"));
const writeJson = (r, v) => fs.writeFileSync(abs(r), `${JSON.stringify(v, null, 2)}\n`, "utf8");
const sha256 = (r) => crypto.createHash("sha256").update(fs.readFileSync(abs(r))).digest("hex");

const validate = spawnSync(process.execPath, ["scripts/architecture/stage90-validate-layer1-gate.mjs"], { cwd: ROOT, stdio: "inherit" });
if (validate.status !== 0) {
  console.error("Stage 90 validate falhou; nenhuma evidência foi gravada. LAYER 1 NÃO certificada.");
  process.exit(1);
}

const results = readJson(".stage90-gate-results.json");
if (!results.every((r) => r.ok)) throw new Error("Resultados do gate contêm falha");
const smoke = results.find((r) => r.id === "runtime.linux");
if (!smoke?.ok) throw new Error("Runtime smoke Linux ausente ou reprovado");

const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" });
const head = git.status === 0 ? String(git.stdout).trim() : null;
const generatedAtUtc = new Date().toISOString();
const manifest = readJson("ETAPA90_MANIFEST.json");

writeJson("ETAPA90_RUNTIME_EVIDENCE.json", {
  schemaVersion: 1,
  stage: 90,
  status: "PASS",
  platform: "linux-xvfb-release",
  detail: smoke.detail,
  steamMode: "offline (Steam indisponível, controlado)",
  notVerified: manifest.notVerified,
  generatedAtUtc,
});

writeJson("ETAPA90_AUTOMATED_PASS.json", {
  schemaVersion: 1,
  stage: 90,
  stageName: "Final Layer 1 Gate",
  status: "PASS",
  layer1Gate: "LAYER 1 PASS",
  stagesCertified: "71-89",
  gitHeadBeforeStage90Commit: head,
  gates: Object.fromEntries(results.map((r) => [r.id, r.ok ? "PASS" : "FAIL"])),
  notVerified: manifest.notVerified,
  violations: 0,
  generatedAtUtc,
});

const files = [...new Set([...manifest.files, "ETAPA90_RUNTIME_EVIDENCE.json", "ETAPA90_AUTOMATED_PASS.json"])]
  .filter((f) => fs.existsSync(abs(f)))
  .sort();
fs.writeFileSync(abs("ETAPA90_SHA256SUMS.txt"), `${files.map((f) => `${sha256(f)}  ${f}`).join("\n")}\n`, "utf8");
fs.rmSync(abs(".stage90-gate-results.json"), { force: true });

console.log("\n============================================");
console.log("LAYER 1 PASS");
console.log("ETAPA 90 FINALIZED");
console.log("============================================\n");
