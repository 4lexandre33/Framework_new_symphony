#!/usr/bin/env node
// Prova que projetos consumidores são removíveis: copia o repositório, apaga
// os projetos e roda os gates. Nenhum arquivo do checkout real é alterado.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const SKIP = new Set(["node_modules", "dist", ".git", "target"]);

function copyRepo(target) {
  fs.cpSync(ROOT, target, {
    recursive: true,
    filter: (source) => !SKIP.has(path.basename(source)),
  });
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(target, "node_modules"), "junction");
}

function run(cwd, label, command, args, env = {}) {
  console.log(`\n===== ${label} =====`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: process.platform === "win32",
  });
  if (result.status !== 0) throw new Error(`${label} falhou (exit ${String(result.status)})`);
}

const temps = [];
try {
  // Cenário A: remove todos os jogos, mantém só o molde (_template).
  const a = fs.mkdtempSync(path.join(os.tmpdir(), "isolation-a-"));
  temps.push(a);
  copyRepo(a);
  for (const entry of fs.readdirSync(path.join(a, "src", "projects"))) {
    if (!entry.startsWith("_")) fs.rmSync(path.join(a, "src", "projects", entry), { recursive: true, force: true });
  }
  run(a, "A (sem jogos) ARCH", npm, ["run", "arch:check"]);
  run(a, "A (sem jogos) TSC", npx, ["tsc", "--noEmit"]);
  run(a, "A (sem jogos) VITEST", npx, ["vitest", "run", "--no-file-parallelism"]);
  run(a, "A (sem jogos) BUILD", npm, ["run", "build"]);

  // Cenário B: a pasta src/projects inteira não existe.
  const b = fs.mkdtempSync(path.join(os.tmpdir(), "isolation-b-"));
  temps.push(b);
  copyRepo(b);
  fs.rmSync(path.join(b, "src", "projects"), { recursive: true, force: true });
  run(b, "B (sem src/projects) ARCH", npm, ["run", "arch:check"]);
  run(b, "B (sem src/projects) TSC", npx, ["tsc", "--noEmit"]);
  run(b, "B (sem src/projects) BUILD", npm, ["run", "build"]);

  console.log("\nPROJECT ISOLATION: PASS (jogos removíveis sem tocar na engine)");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
}
