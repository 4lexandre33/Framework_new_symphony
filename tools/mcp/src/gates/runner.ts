/**
 * Executor de gates como job (`gate_run { async: true }`).
 *
 *   node --import <tsx> tools/mcp/src/gates/runner.ts --gate <nome> [--continue-on-failure]
 *
 * Roda na raiz do repositório (cwd), repassa a saída dos comandos e termina
 * com uma linha `@@ENGINE_GATE_RESULT@@ {json}` que `gate_result` lê do log.
 * Código de saída: 0 = gate aprovado, 1 = reprovado, 2 = erro.
 * SIGTERM/SIGINT (job_cancel) matam os processos filhos antes de sair.
 */

import { Executor } from "../core/exec.ts";
import { createRepoPaths } from "../core/paths.ts";
import { McpToolError } from "../core/errors.ts";
import { isGateName, RESULT_MARKER, runGate, type GateRunResult } from "./definitions.ts";

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const gate = argValue("--gate");
  if (!isGateName(gate)) {
    process.stdout.write(`\n${RESULT_MARKER} ${JSON.stringify({ error: { code: "INVALID_INPUT", message: `gate desconhecido: ${String(gate)}` } })}\n`);
    return 2;
  }
  const paths = createRepoPaths(process.cwd());
  const exec = new Executor(paths);
  const controller = new AbortController();
  const stop = (): void => {
    controller.abort();
    void exec.disposeAll().finally(() => process.exit(143));
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  try {
    const result: GateRunResult = await runGate({ root: paths.root, exec }, gate, {
      signal: controller.signal,
      continueOnFailure: process.argv.includes("--continue-on-failure"),
      onOutput: (c) => process.stdout.write(c),
      onStep: (e) => {
        if (e.phase === "start") process.stdout.write(`\n=== [gate ${e.index + 1}/${e.total}] ${e.gate} ===\n`);
        else if (e.result) process.stdout.write(`\n=== ${e.result.summary} (${e.result.durationMs} ms) ===\n`);
      },
    });
    process.stdout.write(`\n${RESULT_MARKER} ${JSON.stringify(result)}\n`);
    return result.ok ? 0 : 1;
  } catch (error) {
    const payload =
      error instanceof McpToolError
        ? error.toPayload()
        : { code: "INTERNAL", message: error instanceof Error ? error.message : String(error) };
    process.stdout.write(`\n${RESULT_MARKER} ${JSON.stringify({ error: payload })}\n`);
    return 2;
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`runner de gates falhou: ${String(error)}\n`);
    process.exitCode = 2;
  },
);
