#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  CANONICAL_MODULES,
} from "../scripts/architecture/module-map.mjs";

const ROOT = process.cwd();

function fail(message) {
  console.error(`[architecture-smoke] ERRO: ${message}`);
  process.exit(1);
}

function existsFile(relativePath) {
  const absolutePath = path.join(ROOT, ...relativePath.split("/"));
  return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile();
}

function existsDir(relativePath) {
  const absolutePath = path.join(ROOT, ...relativePath.split("/"));
  return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory();
}

function read(relativePath) {
  return fs.readFileSync(
    path.join(ROOT, ...relativePath.split("/")),
    "utf8",
  );
}

function assertProjectRoot() {
  for (const relativePath of [
    "package.json",
    "vite.config.ts",
    "src/core/index.ts",
    "scripts/architecture/module-map.mjs",
    "scripts/architecture/check-boundaries.mjs",
    "scripts/architecture/check-dependencies.mjs",
  ]) {
    if (!existsFile(relativePath)) {
      fail(`arquivo obrigatório ausente: ${relativePath}`);
    }
  }
}

function assertCanonicalModuleLayout() {
  const failures = [];

  for (const moduleRecord of CANONICAL_MODULES) {
    const publicRoot = moduleRecord.engine.publicRoot;
    const internalRoot = moduleRecord.engine.internalRoot;
    const facade = `${publicRoot}/index.ts`;

    if (!existsDir(publicRoot)) {
      failures.push(`${moduleRecord.key}: publicRoot ausente (${publicRoot})`);
    }

    if (!existsDir(internalRoot)) {
      failures.push(`${moduleRecord.key}: internalRoot ausente (${internalRoot})`);
    }

    if (!existsFile(facade)) {
      failures.push(`${moduleRecord.key}: fachada pública ausente (${facade})`);
    }
  }

  if (failures.length > 0) {
    fail(
      `layout canônico inválido:\n${failures
        .map((item) => `  - ${item}`)
        .join("\n")}`,
    );
  }
}

function assertPublicFacadesDoNotLeakInternal() {
  const violations = [];

  for (const moduleRecord of CANONICAL_MODULES) {
    const facade = `${moduleRecord.engine.publicRoot}/index.ts`;
    const source = read(facade);

    if (/["'][^"']*\/internal(?:\/|["'])/u.test(source)) {
      violations.push(facade);
    }
  }

  if (violations.length > 0) {
    fail(
      `fachadas públicas de módulos referenciam /internal:\n${violations
        .map((item) => `  - ${item}`)
        .join("\n")}`,
    );
  }
}

function assertCoreFacadePolicy() {
  const coreFacade = read("src/core/index.ts");

  if (!coreFacade.includes('export { satisfies } from "./internal/semver";')) {
    fail(
      "src/core/index.ts não contém a promoção pública explícita esperada de satisfies.",
    );
  }

  if (
    coreFacade.includes('"./runtime/') ||
    coreFacade.includes("'./runtime/")
  ) {
    fail(
      "src/core/index.ts começou a expor runtime/* diretamente; revisar a API pública.",
    );
  }
}

function assertViteExcludesMigrationHistory() {
  const viteConfig = read("vite.config.ts");
  if (!viteConfig.includes("**/.migration/**")) {
    fail("vite.config.ts não exclui .migration/** da coleta do Vitest.");
  }
}

function runGuardrail(relativePath, label) {
  const result = spawnSync(
    process.execPath,
    [relativePath],
    {
      cwd: ROOT,
      encoding: "utf8",
      stdio: "pipe",
    },
  );

  if (result.status !== 0) {
    const stdout = result.stdout?.trim() ?? "";
    const stderr = result.stderr?.trim() ?? "";
    fail(
      `${label} reprovou.\n${stdout}${stdout && stderr ? "\n" : ""}${stderr}`,
    );
  }
}

function main() {
  assertProjectRoot();
  assertCanonicalModuleLayout();
  assertPublicFacadesDoNotLeakInternal();
  assertCoreFacadePolicy();
  assertViteExcludesMigrationHistory();

  runGuardrail(
    "scripts/architecture/check-boundaries.mjs",
    "check-boundaries",
  );

  runGuardrail(
    "scripts/architecture/check-dependencies.mjs",
    "check-dependencies",
  );

  console.log("============================================================");
  console.log("  PROJETO1 — ETAPA 30: ARCHITECTURE SMOKE");
  console.log("============================================================");
  console.log(`[OK] Módulos canônicos: ${CANONICAL_MODULES.length}`);
  console.log("[OK] Todos possuem /public, /internal e public/index.ts.");
  console.log("[OK] Fachadas públicas dos módulos não referenciam /internal.");
  console.log("[OK] @core preserva promoção pública explícita de satisfies.");
  console.log("[OK] @core não expõe runtime/*.");
  console.log("[OK] Vitest ignora histórico em .migration/**.");
  console.log("[OK] check-boundaries passou.");
  console.log("[OK] check-dependencies passou.");
  console.log("============================================================");
  console.log("  ARCHITECTURE SMOKE: PASS");
  console.log("============================================================");
}

main();
