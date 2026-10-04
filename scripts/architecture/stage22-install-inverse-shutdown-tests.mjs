#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const SCRIPT_NAME = "stage-22-inverse-shutdown-tests";
const TARGET = "src/core/runtime/inverse-shutdown.test.ts";
const STOP_FILE = "src/core/runtime/stop.ts";
const DISPOSE_FILE = "src/core/runtime/dispose.ts";

const TEST_SOURCE = `import { describe, expect, it } from "vitest";
import { Kernel } from "../kernel";
import { defineCapability } from "../contracts/capability-token";
import type { Plugin, PluginContext } from "../contracts/plugin-context";

interface LivenessApi {
  isAlive(): boolean;
}

interface DependencyObservation {
  readonly consumerId: string;
  readonly dependencyId: string;
  readonly phase: "onStop" | "dispose";
  readonly alive: boolean;
}

const ACapability = defineCapability<LivenessApi>(
  "test.inverse-shutdown.a",
  "1.0.0",
);

const BCapability = defineCapability<LivenessApi>(
  "test.inverse-shutdown.b",
  "1.0.0",
);

function recordDependencyLiveness(
  observations: DependencyObservation[],
  consumerId: string,
  dependencyId: string,
  phase: DependencyObservation["phase"],
  resolve: () => LivenessApi,
): void {
  let alive = false;

  try {
    alive = resolve().isAlive();
  } catch {
    alive = false;
  }

  observations.push({
    consumerId,
    dependencyId,
    phase,
    alive,
  });
}

function createPluginA(
  trace: string[],
): Plugin {
  let alive = true;

  return {
    manifest: {
      id: "test.inverse-shutdown.a",
      name: "Inverse Shutdown A",
      version: "1.0.0",
      api: "^1.0.0",
      kind: "internal",
      permissions: {
        capabilities: [ACapability.id],
      },
      capabilities: {
        provides: [
          {
            id: ACapability.id,
            version: "1.0.0",
          },
        ],
      },
      lifecycleHooks: {
        onStop(): void {
          trace.push("stop:A");
        },
      },
    },

    setup(ctx: PluginContext): void {
      trace.push("boot:A");

      ctx.caps.provide(ACapability, {
        isAlive(): boolean {
          return alive;
        },
      });

      ctx.lifecycle.onDispose((): void => {
        trace.push("dispose:A");
        alive = false;
      });

      ctx.lifecycle.ready();
    },
  };
}

function createPluginB(
  trace: string[],
  observations: DependencyObservation[],
): Plugin {
  let alive = true;

  return {
    manifest: {
      id: "test.inverse-shutdown.b",
      name: "Inverse Shutdown B",
      version: "1.0.0",
      api: "^1.0.0",
      kind: "internal",
      dependsOn: [
        {
          id: "test.inverse-shutdown.a",
          range: "^1.0.0",
        },
      ],
      permissions: {
        capabilities: [
          ACapability.id,
          BCapability.id,
        ],
      },
      capabilities: {
        provides: [
          {
            id: BCapability.id,
            version: "1.0.0",
          },
        ],
        consumes: [
          {
            id: ACapability.id,
            range: "^1.0.0",
            optional: false,
          },
        ],
      },
      lifecycleHooks: {
        onStop(ctx: PluginContext): void {
          trace.push("stop:B");
          recordDependencyLiveness(
            observations,
            "B",
            "A",
            "onStop",
            () => ctx.caps.require(ACapability),
          );
        },
      },
    },

    setup(ctx: PluginContext): void {
      trace.push("boot:B");

      ctx.caps.provide(BCapability, {
        isAlive(): boolean {
          return alive;
        },
      });

      ctx.lifecycle.onDispose((): void => {
        trace.push("dispose:B");
        recordDependencyLiveness(
          observations,
          "B",
          "A",
          "dispose",
          () => ctx.caps.require(ACapability),
        );
        alive = false;
      });

      ctx.lifecycle.ready();
    },
  };
}

function createPluginC(
  trace: string[],
  observations: DependencyObservation[],
): Plugin {
  return {
    manifest: {
      id: "test.inverse-shutdown.c",
      name: "Inverse Shutdown C",
      version: "1.0.0",
      api: "^1.0.0",
      kind: "internal",
      dependsOn: [
        {
          id: "test.inverse-shutdown.b",
          range: "^1.0.0",
        },
      ],
      permissions: {
        capabilities: [BCapability.id],
      },
      capabilities: {
        consumes: [
          {
            id: BCapability.id,
            range: "^1.0.0",
            optional: false,
          },
        ],
      },
      lifecycleHooks: {
        onStop(ctx: PluginContext): void {
          trace.push("stop:C");
          recordDependencyLiveness(
            observations,
            "C",
            "B",
            "onStop",
            () => ctx.caps.require(BCapability),
          );
        },
      },
    },

    setup(ctx: PluginContext): void {
      trace.push("boot:C");

      ctx.lifecycle.onDispose((): void => {
        trace.push("dispose:C");
        recordDependencyLiveness(
          observations,
          "C",
          "B",
          "dispose",
          () => ctx.caps.require(BCapability),
        );
      });

      ctx.lifecycle.ready();
    },
  };
}

describe("inverse shutdown", () => {
  it("preserva BOOT A -> B -> C e STOP C -> B -> A", async () => {
    const trace: string[] = [];
    const observations: DependencyObservation[] = [];
    const kernel = new Kernel();

    kernel.register(createPluginC(trace, observations));
    kernel.register(createPluginB(trace, observations));
    kernel.register(createPluginA(trace));

    await kernel.boot();

    expect(kernel.bootOrder).toEqual([
      "test.inverse-shutdown.a",
      "test.inverse-shutdown.b",
      "test.inverse-shutdown.c",
    ]);

    expect(trace).toEqual([
      "boot:A",
      "boot:B",
      "boot:C",
    ]);

    await kernel.stop();

    expect(trace).toEqual([
      "boot:A",
      "boot:B",
      "boot:C",
      "stop:C",
      "stop:B",
      "stop:A",
      "dispose:C",
      "dispose:B",
      "dispose:A",
    ]);

    expect(kernel.status).toBe("stopped");
  });

  it("mantém dependências vivas durante onStop e dispose dos consumidores", async () => {
    const trace: string[] = [];
    const observations: DependencyObservation[] = [];
    const kernel = new Kernel();

    kernel.register(createPluginA(trace));
    kernel.register(createPluginB(trace, observations));
    kernel.register(createPluginC(trace, observations));

    await kernel.boot();
    await kernel.stop();

    expect(observations).toEqual([
      {
        consumerId: "C",
        dependencyId: "B",
        phase: "onStop",
        alive: true,
      },
      {
        consumerId: "B",
        dependencyId: "A",
        phase: "onStop",
        alive: true,
      },
      {
        consumerId: "C",
        dependencyId: "B",
        phase: "dispose",
        alive: true,
      },
      {
        consumerId: "B",
        dependencyId: "A",
        phase: "dispose",
        alive: true,
      },
    ]);
  });
});
`;

function normalizeEol(value) {
  return value.replace(/\r\n/g, "\n");
}

function fail(message) {
  console.error(`[${SCRIPT_NAME}] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function parseArgs(argv) {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === "--check")) {
    return "check";
  }

  if (argv.length === 1 && argv[0] === "--apply") {
    return "apply";
  }

  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    return "help";
  }

  fail("Argumentos inválidos. Use --check, --apply ou --help.");
}

function printHelp() {
  console.log(`
Projeto1 — Etapa 22: preservação e teste do Inverse Shutdown

Uso:
  node scripts/architecture/stage22-install-inverse-shutdown-tests.mjs --check
  node scripts/architecture/stage22-install-inverse-shutdown-tests.mjs --apply

Escopo:
  - NÃO altera src/core/runtime/stop.ts;
  - NÃO altera src/core/runtime/dispose.ts;
  - cria somente ${TARGET};
  - testa BOOT A -> B -> C;
  - testa STOP/onStop C -> B -> A;
  - testa dispose C -> B -> A;
  - testa que dependências seguem vivas durante onStop/dispose do consumidor.
`);
}

function assertProjectRoot(rootDir) {
  const required = [
    "package.json",
    STOP_FILE,
    DISPOSE_FILE,
    "src/core/kernel.ts",
    "src/core/contracts/plugin-context.ts",
    "src/core/contracts/capability-token.ts",
  ];

  for (const relativePath of required) {
    const absolutePath = path.join(rootDir, relativePath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      fail(`Execute na raiz do Projeto1. Arquivo obrigatório ausente: ${relativePath}`);
    }
  }
}

function assertExistingInverseShutdown(rootDir) {
  const stopSource = normalizeEol(fs.readFileSync(path.join(rootDir, STOP_FILE), "utf8"));
  const disposeSource = normalizeEol(fs.readFileSync(path.join(rootDir, DISPOSE_FILE), "utf8"));

  const stopAnchors = [
    "[...state.bootOrder].reverse()",
    "await runOnStopHooks(state, ids);",
    "for (const id of ids) await disposePlugin(state, id, { rebindConsumers: false, force: true });",
  ];

  for (const anchor of stopAnchors) {
    if (!stopSource.includes(anchor)) {
      fail(`Inverse Shutdown atual não corresponde ao estado esperado da Etapa 22. Âncora ausente em ${STOP_FILE}: ${anchor}`);
    }
  }

  const disposerIndex = disposeSource.indexOf("await runDisposers(state, id);");
  const capabilityRemovalIndex = disposeSource.indexOf("notifyCapabilityRemoval(state, id, opts.notifyUnavailable !== false);");

  if (disposerIndex < 0 || capabilityRemovalIndex < 0 || disposerIndex >= capabilityRemovalIndex) {
    fail(
      `Ordem de teardown inesperada em ${DISPOSE_FILE}: disposers precisam executar antes da remoção das capabilities.`,
    );
  }
}

function inspectTarget(rootDir) {
  const absolutePath = path.join(rootDir, TARGET);

  if (!fs.existsSync(absolutePath)) {
    return { pending: true, reason: "arquivo ausente" };
  }

  if (!fs.statSync(absolutePath).isFile()) {
    fail(`${TARGET} existe, mas não é arquivo regular.`);
  }

  const current = normalizeEol(fs.readFileSync(absolutePath, "utf8"));
  const expected = normalizeEol(TEST_SOURCE);

  if (current === expected) {
    return { pending: false, reason: "ok" };
  }

  return { pending: true, reason: "conteúdo diferente do teste canônico da Etapa 22" };
}

function apply(rootDir, inspection) {
  if (!inspection.pending) {
    console.log("Etapa 22 já está instalada e idempotente.");
    return;
  }

  const absolutePath = path.join(rootDir, TARGET);

  if (fs.existsSync(absolutePath)) {
    fail(
      `${TARGET} já existe com conteúdo diferente. A Etapa 22 não sobrescreve teste existente automaticamente.`,
    );
  }

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, TEST_SOURCE, { encoding: "utf8", flag: "wx" });

  const after = inspectTarget(rootDir);
  if (after.pending) {
    try {
      fs.unlinkSync(absolutePath);
    } catch {
      // best-effort rollback
    }
    fail(`Falha ao validar ${TARGET} após escrita; criação revertida.`);
  }

  console.log(`[${SCRIPT_NAME}] aplicado com sucesso.`);
  console.log("Arquivos alterados/criados: 1");
  console.log(`  OK ${TARGET}`);
  console.log("Implementação de shutdown preservada; somente testes foram adicionados.");
}

function main() {
  const mode = parseArgs(process.argv.slice(2));

  if (mode === "help") {
    printHelp();
    return;
  }

  const rootDir = process.cwd();
  assertProjectRoot(rootDir);
  assertExistingInverseShutdown(rootDir);

  const inspection = inspectTarget(rootDir);

  console.log(`[${SCRIPT_NAME}] modo ${mode}${mode === "check" ? " (read-only)" : ""}`);
  console.log("Arquivos no escopo: 1");
  console.log(`Arquivos pendentes: ${inspection.pending ? 1 : 0}`);

  if (inspection.pending) {
    console.log(`  PENDENTE ${TARGET} (${inspection.reason})`);
  }

  if (mode === "check") {
    if (!inspection.pending) {
      console.log("Etapa 22 já está instalada e idempotente.");
    }
    return;
  }

  apply(rootDir, inspection);
}

main();
