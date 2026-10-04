#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  CANONICAL_MODULES,
  FUNCTIONAL_MODULES,
  RUNTIME_MODULES,
} from "./module-map.mjs";

const ROOT = process.cwd();
const TAG = "stage-40-final-guardrails";

const REQUIRED_FILES = Object.freeze([
  ".freeze-lock.json",
  "agents.mjs",
  "tests/freeze-lock.mjs",
  "tests/freeze-invariants.mjs",
  "tests/architecture-smoke-test.mjs",
  "scripts/architecture/module-map.mjs",
  "scripts/architecture/check-boundaries.mjs",
  "scripts/architecture/check-dependencies.mjs",
]);

const SNAPSHOT_ROOTS = Object.freeze([
  "src",
  "src-tauri/src",
  "src-tauri/capabilities",
  "tests",
  "scripts/architecture",
]);

const SNAPSHOT_FILES = Object.freeze([
  ".freeze-lock.json",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "AGENTS.md",
  "agents.mjs",
]);

const EXCLUDED_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "target",
  "coverage",
]);

const EXCLUDED_EXTENSIONS = new Set([
  ".zip",
  ".exe",
  ".dll",
  ".pdb",
  ".png",
  ".ico",
  ".icns",
]);

function fail(message) {
  throw new Error(message);
}

function abs(relativePath) {
  return path.join(ROOT, ...relativePath.split("/"));
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function existsFile(relativePath) {
  const full = abs(relativePath);
  return fs.existsSync(full) && fs.statSync(full).isFile();
}

function existsDir(relativePath) {
  const full = abs(relativePath);
  return fs.existsSync(full) && fs.statSync(full).isDirectory();
}

function assertProjectRoot() {
  for (const relativePath of REQUIRED_FILES) {
    if (!existsFile(relativePath)) {
      fail(`arquivo obrigatório ausente: ${relativePath}`);
    }
  }
}

function walk(rootPath, output = []) {
  if (!fs.existsSync(rootPath)) return output;

  const stack = [rootPath];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    const entries = fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, "en"));

    for (const entry of entries) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;

      const full = path.join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }

      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!EXCLUDED_EXTENSIONS.has(ext)) {
          output.push(full);
        }
      }
    }
  }

  return output;
}

function stableSnapshot() {
  const records = [];
  const seen = new Set();

  function addFile(fullPath) {
    const relativePath = toPosix(path.relative(ROOT, fullPath));
    if (seen.has(relativePath)) return;
    seen.add(relativePath);

    const buffer = fs.readFileSync(fullPath);
    records.push(
      `F ${relativePath} ${buffer.length} ${sha256(buffer)}`,
    );
  }

  for (const relativeRoot of SNAPSHOT_ROOTS) {
    const fullRoot = abs(relativeRoot);

    for (const fullPath of walk(fullRoot)) {
      addFile(fullPath);
    }
  }

  for (const relativePath of SNAPSHOT_FILES) {
    const full = abs(relativePath);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      addFile(full);
    }
  }

  records.sort((a, b) => a.localeCompare(b, "en"));

  return {
    count: records.length,
    digest: sha256(Buffer.from(records.join("\n"), "utf8")),
  };
}

function runNode(args, label, requiredOutput = []) {
  console.log(`[RUN] node ${args.join(" ")}`);

  const result = spawnSync(
    process.execPath,
    args,
    {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    },
  );

  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");

  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    fail(`${label} falhou com código ${String(result.status)}.`);
  }

  for (const marker of requiredOutput) {
    if (!stdout.includes(marker)) {
      fail(
        `${label} terminou sem confirmação esperada: ${marker}`,
      );
    }
  }

  console.log(`[OK] ${label}`);
}

function assertCanonicalShape() {
  if (FUNCTIONAL_MODULES.length !== 20) {
    fail(
      `FUNCTIONAL_MODULES deveria conter 20; atual=${FUNCTIONAL_MODULES.length}.`,
    );
  }

  if (RUNTIME_MODULES.length !== 3) {
    fail(
      `RUNTIME_MODULES deveria conter 3; atual=${RUNTIME_MODULES.length}.`,
    );
  }

  if (CANONICAL_MODULES.length !== 23) {
    fail(
      `CANONICAL_MODULES deveria conter 23; atual=${CANONICAL_MODULES.length}.`,
    );
  }

  const keys = new Set();
  const capabilities = new Set();

  for (const moduleRecord of CANONICAL_MODULES) {
    if (keys.has(moduleRecord.key)) {
      fail(`module key duplicada: ${moduleRecord.key}`);
    }
    keys.add(moduleRecord.key);

    if (capabilities.has(moduleRecord.capabilityId)) {
      fail(`capabilityId duplicada: ${moduleRecord.capabilityId}`);
    }
    capabilities.add(moduleRecord.capabilityId);

    const publicRoot = moduleRecord.engine?.publicRoot;
    const internalRoot = moduleRecord.engine?.internalRoot;
    const engineRoot = moduleRecord.engine?.root;

    if (
      typeof publicRoot !== "string" ||
      typeof internalRoot !== "string" ||
      typeof engineRoot !== "string"
    ) {
      fail(`roots inválidos no module-map para ${moduleRecord.key}.`);
    }

    if (!existsDir(engineRoot)) {
      fail(`${moduleRecord.key}: engine.root ausente (${engineRoot}).`);
    }

    if (!existsDir(publicRoot)) {
      fail(`${moduleRecord.key}: publicRoot ausente (${publicRoot}).`);
    }

    if (!existsDir(internalRoot)) {
      fail(`${moduleRecord.key}: internalRoot ausente (${internalRoot}).`);
    }

    const facade = `${publicRoot}/index.ts`;

    if (!existsFile(facade)) {
      fail(`${moduleRecord.key}: fachada pública ausente (${facade}).`);
    }

    if (!Array.isArray(moduleRecord.contracts)) {
      fail(`${moduleRecord.key}: contracts inválido.`);
    }

    for (const contractPath of moduleRecord.contracts) {
      if (!existsFile(contractPath)) {
        fail(
          `${moduleRecord.key}: contract ausente (${contractPath}).`,
        );
      }
    }

    if (!Array.isArray(moduleRecord.tokens)) {
      fail(`${moduleRecord.key}: tokens inválido.`);
    }

    for (const tokenRecord of moduleRecord.tokens) {
      if (
        typeof tokenRecord?.path !== "string" ||
        !existsFile(tokenRecord.path)
      ) {
        fail(
          `${moduleRecord.key}: token ausente/inválido (${String(tokenRecord?.path)}).`,
        );
      }
    }

    if (
      typeof moduleRecord.plugin !== "string" ||
      !existsFile(moduleRecord.plugin)
    ) {
      fail(
        `${moduleRecord.key}: plugin ausente (${String(moduleRecord.plugin)}).`,
      );
    }
  }

  console.log("[OK] 20 módulos funcionais + 3 runtimes = 23 canônicos.");
  console.log("[OK] Keys e capabilities primárias são únicas.");
  console.log("[OK] engine.root/publicRoot/internalRoot existem para os 23 módulos.");
  console.log("[OK] 23 fachadas public/index.ts existem.");
  console.log("[OK] Contracts, tokens e plugins canônicos existem.");
}

function assertFreezeLockShape() {
  const lockPath = abs(".freeze-lock.json");
  let lock;

  try {
    lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  } catch (error) {
    fail(
      `.freeze-lock.json inválido: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (
    lock === null ||
    typeof lock !== "object" ||
    Array.isArray(lock)
  ) {
    fail(".freeze-lock.json deve ser um objeto JSON.");
  }

  const serialized = JSON.stringify(lock);

  if (!serialized.includes("src/engine/")) {
    fail("freeze lock não contém paths de src/engine.");
  }

  if (!serialized.includes("/public/") && !serialized.includes("/public")) {
    fail("freeze lock não reconhece paths /public.");
  }

  if (!serialized.includes("/internal/") && !serialized.includes("/internal")) {
    fail("freeze lock não reconhece paths /internal.");
  }

  console.log("[OK] /.freeze-lock.json existe e é JSON válido.");
  console.log("[OK] Freeze lock reconhece paths v20 /public e /internal.");
}

function assertGovernanceScope() {
  const agents = fs.readFileSync(abs("agents.mjs"), "utf8");

  if (
    !agents.includes("tests/freeze-invariants.mjs") ||
    !agents.includes("tests/freeze-lock.mjs")
  ) {
    fail(
      "agents.mjs não executa freeze-invariants + freeze-lock no modo padrão.",
    );
  }

  if (
    !agents.includes("./scripts/architecture/module-map.mjs")
  ) {
    fail("agents.mjs não deriva do module-map canônico.");
  }

  console.log(
    "[OK] agents.mjs usa module-map e executa invariants + freeze-lock.",
  );

  if (
    !agents.includes("check-boundaries.mjs") ||
    !agents.includes("check-dependencies.mjs")
  ) {
    console.log(
      "[INFO] boundaries/dependencies ainda não estão integrados permanentemente ao agents.mjs; isso permanece reservado à Etapa 43.",
    );
  }
}

function main() {
  try {
    assertProjectRoot();

    console.log("============================================================");
    console.log("  PROJETO1 — ETAPA 40: AUDITORIA FINAL DOS GUARDRAILS");
    console.log("============================================================");
    console.log("[INFO] Modo estritamente read-only.");

    const before = stableSnapshot();

    console.log("");
    console.log("=== FREEZE LOCK v20 ===");
    assertFreezeLockShape();

    console.log("");
    console.log("=== FONTE CANÔNICA / PATHS ESSENCIAIS ===");
    assertCanonicalShape();

    console.log("");
    console.log("=== GOVERNANÇA ===");
    assertGovernanceScope();

    console.log("");
    console.log("=== AGENTS GUARDRAIL ORCHESTRATOR ===");
    runNode(
      ["agents.mjs"],
      "agents.mjs",
      [
        "PRONTO PARA DESENVOLVIMENTO",
      ],
    );

    console.log("");
    console.log("=== BOUNDARY CHECKER OFICIAL ===");
    runNode(
      ["scripts/architecture/check-boundaries.mjs"],
      "check-boundaries.mjs",
    );

    console.log("");
    console.log("=== DEPENDENCY CHECKER OFICIAL ===");
    runNode(
      ["scripts/architecture/check-dependencies.mjs"],
      "check-dependencies.mjs",
    );

    console.log("");
    console.log("=== ARCHITECTURE SMOKE ===");
    runNode(
      ["tests/architecture-smoke-test.mjs"],
      "architecture-smoke-test.mjs",
      [
        "ARCHITECTURE SMOKE: PASS",
      ],
    );

    const after = stableSnapshot();

    console.log("");
    console.log("=== PROVA DE NÃO-MUTAÇÃO ===");
    console.log(`Arquivos protegidos antes: ${before.count}`);
    console.log(`Arquivos protegidos depois: ${after.count}`);
    console.log(`Digest antes: ${before.digest}`);
    console.log(`Digest depois: ${after.digest}`);

    if (
      before.count !== after.count ||
      before.digest !== after.digest
    ) {
      fail(
        [
          "a auditoria Stage 40 alterou o projeto.",
          `Arquivos: ${before.count} -> ${after.count}`,
          `Digest: ${before.digest} -> ${after.digest}`,
        ].join("\n"),
      );
    }

    console.log("[OK] Estado protegido permaneceu byte-identical.");

    console.log("");
    console.log("============================================================");
    console.log("  ETAPA 40: PASS");
    console.log("============================================================");
    console.log("[OK] Freeze v20 íntegro.");
    console.log("[OK] 23 módulos canônicos e paths essenciais íntegros.");
    console.log("[OK] Invariantes existentes verdes.");
    console.log("[OK] Boundary checker verde.");
    console.log("[OK] Dependency graph verde.");
    console.log("[OK] Architecture smoke verde.");
    console.log("[OK] Auditoria read-only: zero mutações.");
    console.log("[INFO] Integração permanente de boundary/dependency ao agents.mjs continua reservada à Etapa 43.");
  } catch (error) {
    console.error("");
    console.error("============================================================");
    console.error("  ETAPA 40: REPROVADA");
    console.error("============================================================");
    console.error(
      error instanceof Error
        ? error.stack ?? error.message
        : String(error),
    );
    process.exitCode = 1;
  }
}

main();
