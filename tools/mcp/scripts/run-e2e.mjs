#!/usr/bin/env node
/**
 * `npm run mcp:e2e` — liga ENGINE_MCP_E2E=1 e roda o vitest do e2e do runtime
 * sem depender da sintaxe de variável do shell (funciona igual no Windows/cmd,
 * PowerShell e POSIX; sem cross-env). Argumentos extras vão para o vitest.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const vitest = path.join(root, "node_modules", "vitest", "vitest.mjs");
if (!existsSync(vitest)) {
  console.error(`[mcp:e2e] vitest não encontrado em ${vitest} — rode npm install.`);
  process.exit(1);
}

const child = spawn(process.execPath, [vitest, "run", "tests/mcp/e2e", ...process.argv.slice(2)], {
  cwd: root,
  env: { ...process.env, ENGINE_MCP_E2E: "1" },
  stdio: "inherit",
  shell: false,
  windowsHide: true,
});

const forward = (signal) => {
  if (!child.killed) child.kill(signal);
};
process.on("SIGINT", forward);
process.on("SIGTERM", forward);

child.on("error", (error) => {
  console.error(`[mcp:e2e] falha ao iniciar o vitest: ${error.message}`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
