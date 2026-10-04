#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { CANONICAL_MODULES } from "./scripts/architecture/module-map.mjs";

const args = process.argv.slice(2);
const isLock = args.includes("--lock");
const isUnlock = args.includes("--unlock");

if (isLock && isUnlock) {
  console.error("[ERRO] --lock e --unlock são mutuamente exclusivos.");
  process.exit(1);
}

const unknownArgs = args.filter((arg) => arg !== "--lock" && arg !== "--unlock");
if (unknownArgs.length > 0) {
  console.error(`[ERRO] Argumento(s) desconhecido(s): ${unknownArgs.join(", ")}`);
  process.exit(1);
}

function runNode(script, scriptArgs = []) {
  execFileSync(
    process.execPath,
    [script, ...scriptArgs],
    { stdio: "inherit" },
  );
}

console.log("============================================================");
console.log("  AGENTS GUARDRAIL ORCHESTRATOR - PROJETO 1                  ");
console.log("============================================================");
console.log(`Fonte canônica: scripts/architecture/module-map.mjs (${CANONICAL_MODULES.length} módulos)`);
console.log("Freeze lock canônico: /.freeze-lock.json\n");

if (isLock) {
  console.log("Congelando módulos a partir do catálogo canônico...");
  runNode("tests/freeze-lock.mjs", ["--lock"]);
} else if (isUnlock) {
  console.log("Desbloqueando código congelado para alterações autorizadas...");
  runNode("tests/freeze-lock.mjs", ["--unlock"]);
} else {
  try {
    runNode("tests/freeze-invariants.mjs");
    runNode("tests/freeze-lock.mjs");

    console.log("\nExecutando boundary checker arquitetural...");
    runNode("scripts/architecture/check-boundaries.mjs");

    console.log("\nExecutando dependency graph checker...");
    runNode("scripts/architecture/check-dependencies.mjs");

    console.log("\x1b[32m[PRONTO PARA DESENVOLVIMENTO]\x1b[0m Ambiente seguro para os Agentes de IA.");
  } catch {
    console.error("\x1b[31m[EXECUÇÃO BLOQUEADA]\x1b[0m Corrija as violações antes de prosseguir.");
    process.exit(1);
  }
}
