#!/usr/bin/env node
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const isLock = args.includes("--lock");
const isUnlock = args.includes("--unlock");

console.log("============================================================");
console.log("  AGENTS GUARDRAIL ORCHESTRATOR - PROJETO 1                  ");
console.log("============================================================\n");

if (isLock) {
  console.log("Congelando módulos estáveis da integração Steam...");
  execSync("node tests/freeze-lock.mjs --lock", { stdio: "inherit" });
} else if (isUnlock) {
  console.log("Desbloqueando código congelado para alterações autorizadas...");
  execSync("node tests/freeze-lock.mjs --unlock", { stdio: "inherit" });
} else {
  try {
    execSync("node tests/freeze-invariants.mjs", { stdio: "inherit" });
    execSync("node tests/freeze-lock.mjs", { stdio: "inherit" });
    console.log("\x1b[32m[PRONTO PARA DESENVOLVIMENTO]\x1b[0m Ambiente seguro para os Agentes de IA.");
  } catch {
    console.error("\x1b[31m[EXECUÇÃO BLOQUEADA]\x1b[0m Corrija as violações antes de prosseguir.");
    process.exit(1);
  }
}