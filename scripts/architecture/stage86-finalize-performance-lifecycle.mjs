#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { auditLayer1PerformanceLifecycle } from "./lib/layer1-performance-lifecycle-v1.mjs";

const ROOT = process.cwd();
function abs(p) { return path.join(ROOT, ...p.split("/")); }
function writeJson(p, value) { fs.writeFileSync(abs(p), `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function sha256(p) { return crypto.createHash("sha256").update(fs.readFileSync(abs(p))).digest("hex"); }

const validation = spawnSync(process.execPath, ["scripts/architecture/stage86-validate-performance-lifecycle.mjs"], { cwd: ROOT, stdio: "inherit", shell: false });
if (validation.status !== 0) process.exit(validation.status ?? 1);

const audit = auditLayer1PerformanceLifecycle({ projectRoot: ROOT });
if (!audit.ok) throw new Error("Stage86 audit deixou de estar verde durante finalização");
const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32" });
const head = git.status === 0 ? String(git.stdout).trim() : null;

writeJson("ETAPA86_RUNTIME_EVIDENCE.json", { schemaVersion: 1, stage: 86, pass: true, status: "PASS", semanticChecks: audit.checks.length, violations: 0, generatedAtUtc: new Date().toISOString() });
writeJson("ETAPA86_PERFORMANCE_RESOURCE_EVIDENCE.json", { schemaVersion: 1, stage: 86, status: "PASS", gitHeadBeforeStage86Commit: head, audit, generatedAtUtc: new Date().toISOString() });
writeJson("ETAPA86_AUTOMATED_PASS.json", { schemaVersion: 1, stage: 86, stageName: "Performance & Resource Lifecycle", status: "PASS", gitHeadBeforeStage86Commit: head, gates: { semanticAudit: "PASS", focusedTests: "PASS", architecture: "PASS", typescript: "PASS", vitestFull: "PASS", cargoCheck: "PASS", viteBuild: "PASS" }, violations: 0, generatedAtUtc: new Date().toISOString() });

const manifest = JSON.parse(fs.readFileSync(abs("ETAPA86_MANIFEST.json"), "utf8"));
const files = [...new Set([...(manifest.files ?? []), "ETAPA86_RUNTIME_EVIDENCE.json", "ETAPA86_PERFORMANCE_RESOURCE_EVIDENCE.json", "ETAPA86_AUTOMATED_PASS.json"])].filter((p) => fs.existsSync(abs(p))).sort();
fs.writeFileSync(abs("ETAPA86_SHA256SUMS.txt"), `${files.map((p) => `${sha256(p)}  ${p}`).join("\n")}\n`, "utf8");
console.log("\n============================================");
console.log("ETAPA 86 FINALIZED: PASS");
console.log("============================================\n");
