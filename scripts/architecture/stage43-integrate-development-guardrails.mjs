#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const STAGE = "stage-43-permanent-architecture-integration";
const PACKAGE_PATH = "package.json";
const AGENTS_PATH = "agents.mjs";
const OUTPUT_ROOT = ".migration/stage43";

const EXPECTED_SCRIPTS = Object.freeze({
  "arch:audit": "node agents.mjs",
  "arch:check":
    "node scripts/architecture/check-boundaries.mjs && node scripts/architecture/check-dependencies.mjs",
  "arch:dependencies":
    "node scripts/architecture/check-dependencies.mjs",
  "arch:migrate":
    "node scripts/architecture/stage43-migration-status.mjs",
  build:
    "npm run arch:check && tsc && vite build",
});

const REQUIRED_AGENT_GUARDRAILS = Object.freeze([
  'runNode("tests/freeze-invariants.mjs");',
  'runNode("tests/freeze-lock.mjs");',
  'runNode("scripts/architecture/check-boundaries.mjs");',
  'runNode("scripts/architecture/check-dependencies.mjs");',
]);

const OLD_AGENT_BLOCK = `    runNode("tests/freeze-invariants.mjs");
    runNode("tests/freeze-lock.mjs");
    console.log("\\x1b[32m[PRONTO PARA DESENVOLVIMENTO]\\x1b[0m Ambiente seguro para os Agentes de IA.");`;

const NEW_AGENT_BLOCK = `    runNode("tests/freeze-invariants.mjs");
    runNode("tests/freeze-lock.mjs");

    console.log("\\nExecutando boundary checker arquitetural...");
    runNode("scripts/architecture/check-boundaries.mjs");

    console.log("\\nExecutando dependency graph checker...");
    runNode("scripts/architecture/check-dependencies.mjs");

    console.log("\\x1b[32m[PRONTO PARA DESENVOLVIMENTO]\\x1b[0m Ambiente seguro para os Agentes de IA.");`;

function fail(message) {
  throw new Error(message);
}

function abs(relativePath) {
  return path.join(ROOT, ...relativePath.split("/"));
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function parseArgs(argv) {
  const known = new Set(["--check", "--apply", "--help", "-h"]);

  for (const arg of argv) {
    if (!known.has(arg)) {
      fail(`argumento desconhecido: ${arg}`);
    }
  }

  if (argv.includes("--check") && argv.includes("--apply")) {
    fail("use somente --check ou --apply.");
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    return { help: true, mode: "check" };
  }

  return {
    help: false,
    mode: argv.includes("--apply") ? "apply" : "check",
  };
}

function printHelp() {
  console.log(`
Projeto1 — Etapa 43: integração permanente da arquitetura ao desenvolvimento

Uso:
  node scripts/architecture/stage43-integrate-development-guardrails.mjs
  node scripts/architecture/stage43-integrate-development-guardrails.mjs --check
  node scripts/architecture/stage43-integrate-development-guardrails.mjs --apply

Modo padrão:
  --check

Escopo:
  - adicionar scripts npm arch:audit, arch:check, arch:dependencies, arch:migrate;
  - fazer build executar arch:check antes de TypeScript/Vite;
  - integrar boundary/dependency checker ao modo normal de agents.mjs;
  - preservar --lock/--unlock;
  - não alterar runtime, Rust/Tauri, contracts, tokens ou módulos.
`);
}

function ensureFile(relativePath) {
  const full = abs(relativePath);

  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    fail(`arquivo obrigatório ausente: ${relativePath}`);
  }
}

function readJson(relativePath) {
  try {
    return JSON.parse(fs.readFileSync(abs(relativePath), "utf8"));
  } catch (error) {
    fail(
      `JSON inválido em ${relativePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function normalize(text) {
  return text.replace(/\r\n/g, "\n");
}

function stablePackageText(packageJson) {
  return JSON.stringify(packageJson, null, 2) + "\n";
}

function packagePending(packageJson) {
  const scripts = packageJson.scripts;

  if (scripts === null || typeof scripts !== "object" || Array.isArray(scripts)) {
    fail("package.json.scripts ausente ou inválido.");
  }

  const pending = [];

  for (const [name, expected] of Object.entries(EXPECTED_SCRIPTS)) {
    if (scripts[name] !== expected) {
      pending.push({
        field: `scripts.${name}`,
        current: scripts[name] ?? null,
        expected,
      });
    }
  }

  return pending;
}

function agentsPending(source) {
  const hasAll = REQUIRED_AGENT_GUARDRAILS.every(
    (snippet) => source.includes(snippet),
  );

  if (hasAll) {
    return [];
  }

  if (!source.includes(OLD_AGENT_BLOCK)) {
    fail(
      [
        "agents.mjs está em estado inesperado.",
        "O bloco padrão conhecido não foi encontrado e a integração Stage 43 ainda não está completa.",
        "Abortando para não aplicar patch sobre versão desconhecida.",
      ].join("\n"),
    );
  }

  return [
    {
      field: "agents.default-guardrails",
      current:
        "freeze-invariants + freeze-lock",
      expected:
        "freeze-invariants + freeze-lock + boundaries + dependencies",
    },
  ];
}

function buildNextPackage(packageJson) {
  const next = structuredClone(packageJson);

  if (
    next.scripts === null ||
    typeof next.scripts !== "object" ||
    Array.isArray(next.scripts)
  ) {
    fail("package.json.scripts inválido.");
  }

  next.scripts["arch:audit"] = EXPECTED_SCRIPTS["arch:audit"];
  next.scripts["arch:check"] = EXPECTED_SCRIPTS["arch:check"];
  next.scripts["arch:dependencies"] =
    EXPECTED_SCRIPTS["arch:dependencies"];
  next.scripts["arch:migrate"] =
    EXPECTED_SCRIPTS["arch:migrate"];
  next.scripts.build = EXPECTED_SCRIPTS.build;

  return next;
}

function buildNextAgents(source) {
  if (
    REQUIRED_AGENT_GUARDRAILS.every(
      (snippet) => source.includes(snippet),
    )
  ) {
    return source;
  }

  const next = source.replace(
    OLD_AGENT_BLOCK,
    NEW_AGENT_BLOCK,
  );

  if (next === source) {
    fail("patch de agents.mjs não produziu alteração.");
  }

  return next;
}

function atomicWrite(relativePath, text) {
  const full = abs(relativePath);
  const temp = `${full}.stage43-${process.pid}.tmp`;

  fs.writeFileSync(temp, text, "utf8");
  fs.renameSync(temp, full);
}

function run(command, args, label, markers = []) {
  console.log(`[RUN] ${command} ${args.join(" ")}`);

  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });

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

  for (const marker of markers) {
    if (!stdout.includes(marker)) {
      fail(`${label} terminou sem marcador esperado: ${marker}`);
    }
  }

  console.log(`[OK] ${label}`);
  return { stdout, stderr };
}

function runNpm(scriptName, labelOrMarkers = [], maybeMarkers = []) {
  const label =
    typeof labelOrMarkers === "string"
      ? labelOrMarkers
      : `npm run ${scriptName}`;

  const markers =
    Array.isArray(labelOrMarkers)
      ? labelOrMarkers
      : maybeMarkers;

  let result;

  if (process.platform === "win32") {
    const commandProcessor =
      process.env.ComSpec ??
      process.env.COMSPEC ??
      "C:\\Windows\\System32\\cmd.exe";

    result = spawnSync(
      commandProcessor,
      ["/d", "/s", "/c", `npm run ${scriptName}`],
      {
        cwd: ROOT,
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } else {
    result = spawnSync(
      "npm",
      ["run", scriptName],
      {
        cwd: ROOT,
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  }

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

  for (const marker of markers) {
    if (!stdout.includes(marker)) {
      fail(`${label} sem marcador esperado: ${marker}`);
    }
  }

  console.log(`[OK] ${label}`);
  return { stdout, stderr };
}

function assertIntegrated(packageJson, agentsSource) {
  const packageProblems = packagePending(packageJson);
  if (packageProblems.length > 0) {
    fail(
      `package.json ainda possui ${packageProblems.length} integração(ões) pendente(s).`,
    );
  }

  const missing = REQUIRED_AGENT_GUARDRAILS.filter(
    (snippet) => !agentsSource.includes(snippet),
  );

  if (missing.length > 0) {
    fail(
      `agents.mjs ainda não possui ${missing.length} guardrail(s) obrigatório(s).`,
    );
  }

  if (
    !agentsSource.includes(
      'runNode("tests/freeze-lock.mjs", ["--lock"]);',
    ) ||
    !agentsSource.includes(
      'runNode("tests/freeze-lock.mjs", ["--unlock"]);',
    )
  ) {
    fail("semântica --lock/--unlock não foi preservada.");
  }
}

function evidenceSnapshot() {
  const packageBuffer = fs.readFileSync(abs(PACKAGE_PATH));
  const agentsBuffer = fs.readFileSync(abs(AGENTS_PATH));

  return {
    packageJsonSha256: sha256(packageBuffer),
    agentsSha256: sha256(agentsBuffer),
  };
}

function timestampFolder() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  try {
    ensureFile(PACKAGE_PATH);
    ensureFile(AGENTS_PATH);
    ensureFile("scripts/architecture/check-boundaries.mjs");
    ensureFile("scripts/architecture/check-dependencies.mjs");
    ensureFile("scripts/architecture/stage43-migration-status.mjs");
    ensureFile("tests/freeze-invariants.mjs");
    ensureFile("tests/freeze-lock.mjs");
    ensureFile(".freeze-lock.json");

    console.log("============================================================");
    console.log("  PROJETO1 — ETAPA 43: INTEGRAÇÃO PERMANENTE");
    console.log("============================================================");
    console.log(`Modo: ${options.mode.toUpperCase()}`);

    const packageJson = readJson(PACKAGE_PATH);
    const agentsSource = normalize(
      fs.readFileSync(abs(AGENTS_PATH), "utf8"),
    );

    const packageProblems = packagePending(packageJson);
    const agentProblems = agentsPending(agentsSource);

    console.log("");
    console.log("=== PACKAGE.JSON ===");

    if (packageProblems.length === 0) {
      console.log("[OK] Scripts npm Stage 43 já estão integrados.");
    } else {
      for (const problem of packageProblems) {
        console.log(
          `[PENDENTE] ${problem.field}: ${JSON.stringify(problem.current)} -> ${JSON.stringify(problem.expected)}`,
        );
      }
    }

    console.log("");
    console.log("=== AGENTS.MJS ===");

    if (agentProblems.length === 0) {
      console.log(
        "[OK] agents.mjs já executa freeze/invariants/boundaries/dependencies.",
      );
    } else {
      console.log(
        "[PENDENTE] Integrar boundary + dependency checkers ao modo normal.",
      );
    }

    const totalPending =
      packageProblems.length + agentProblems.length;

    console.log("");
    console.log(`Pendências: ${totalPending}`);

    if (options.mode === "check") {
      console.log("");
      console.log("============================================================");
      console.log("  ETAPA 43: CHECK PASS");
      console.log("============================================================");

      if (totalPending === 0) {
        console.log("[OK] Integração permanente já aplicada.");
      } else {
        console.log(
          `[INFO] ${totalPending} alteração(ões) pendente(s); nenhum arquivo foi modificado.`,
        );
        console.log(
          "[INFO] Execute com --apply para instalar a integração.",
        );
      }
      return;
    }

    const before = evidenceSnapshot();
    const nextPackage = buildNextPackage(packageJson);
    const nextAgents = buildNextAgents(agentsSource);

    console.log("");
    console.log("=== APPLY ATÔMICO ===");

    const originals = new Map([
      [PACKAGE_PATH, fs.readFileSync(abs(PACKAGE_PATH))],
      [AGENTS_PATH, fs.readFileSync(abs(AGENTS_PATH))],
    ]);

    try {
      atomicWrite(
        PACKAGE_PATH,
        stablePackageText(nextPackage),
      );
      atomicWrite(
        AGENTS_PATH,
        nextAgents.endsWith("\n")
          ? nextAgents
          : `${nextAgents}\n`,
      );

      const appliedPackage = readJson(PACKAGE_PATH);
      const appliedAgents = normalize(
        fs.readFileSync(abs(AGENTS_PATH), "utf8"),
      );

      assertIntegrated(appliedPackage, appliedAgents);
    } catch (error) {
      for (const [relativePath, buffer] of originals) {
        fs.writeFileSync(abs(relativePath), buffer);
      }
      throw error;
    }

    console.log("[OK] package.json atualizado.");
    console.log("[OK] agents.mjs atualizado.");
    console.log("[OK] --lock/--unlock preservados.");

    console.log("");
    console.log("=== VALIDAÇÃO DOS SCRIPTS NPM ===");

    runNpm(
      "arch:check",
      "npm run arch:check",
      [
        "Violações de boundary: 0",
        "Violações do grafo: 0",
      ],
    );

    runNpm(
      "arch:dependencies",
      "npm run arch:dependencies",
      ["Violações do grafo: 0"],
    );

    runNpm(
      "arch:audit",
      "npm run arch:audit",
      [
        "Violações de boundary: 0",
        "Violações do grafo: 0",
        "PRONTO PARA DESENVOLVIMENTO",
      ],
    );

    console.log("");
    console.log("=== ARCH:MIGRATE STATUS PÓS-MIGRAÇÃO ===");

    runNpm(
      "arch:migrate",
      "npm run arch:migrate",
      ["MIGRATION STATUS: PASS"],
    );

    console.log(
      "[OK] arch:migrate valida o estado pós-migração sem writes.",
    );

    console.log("");
    console.log("=== BUILD COM GUARDRAIL ===");

    runNpm(
      "build",
      "npm run build",
      [
        "Violações de boundary: 0",
        "Violações do grafo: 0",
      ],
    );

    const finalPackage = readJson(PACKAGE_PATH);
    const finalAgents = normalize(
      fs.readFileSync(abs(AGENTS_PATH), "utf8"),
    );

    assertIntegrated(finalPackage, finalAgents);

    const after = evidenceSnapshot();
    const runId = timestampFolder();
    const outputDir = `${OUTPUT_ROOT}/${runId}`;

    const evidence = {
      schemaVersion: 1,
      stage: STAGE,
      architectureMigrationVersion: "v20",
      status: "completed",
      completedAtUtc: new Date().toISOString(),
      changedFiles: [
        PACKAGE_PATH,
        AGENTS_PATH,
      ],
      scripts: EXPECTED_SCRIPTS,
      agentsDefaultGuardrails: [
        "tests/freeze-invariants.mjs",
        "tests/freeze-lock.mjs",
        "scripts/architecture/check-boundaries.mjs",
        "scripts/architecture/check-dependencies.mjs",
      ],
      lockUnlockPreserved: true,
      validation: {
        archCheck: "pass",
        archDependencies: "pass",
        archAudit: "pass",
        archMigrate: "postmigration-status-pass",
        build: "pass",
      },
      hashes: {
        before,
        after,
      },
      notes: [
        "arch:migrate is a read-only post-migration status check.",
        "build now fails fast on architecture boundary/dependency violations.",
        "agents.mjs default mode now enforces freeze, invariants, boundaries and dependency graph.",
        "No runtime, Tauri/Rust, module implementation, contract or token file is modified by Stage 43.",
      ],
    };

    fs.mkdirSync(abs(outputDir), { recursive: true });
    fs.writeFileSync(
      abs(`${outputDir}/stage43-evidence.json`),
      JSON.stringify(evidence, null, 2) + "\n",
      "utf8",
    );

    const report = [
      "# Stage 43 — Permanent Architecture Integration",
      "",
      "**ETAPA 43: PASS**",
      "",
      "## Installed npm scripts",
      "",
      ...Object.entries(EXPECTED_SCRIPTS).map(
        ([name, command]) => `- \`${name}\`: \`${command}\``,
      ),
      "",
      "## agents.mjs",
      "",
      "- freeze invariants: enabled",
      "- freeze lock verification: enabled",
      "- boundary checker: enabled",
      "- dependency graph checker: enabled",
      "- `--lock` preserved",
      "- `--unlock` preserved",
      "",
      "## Validation",
      "",
      "- `npm run arch:check`: PASS",
      "- `npm run arch:dependencies`: PASS",
      "- `npm run arch:audit`: PASS",
      "- `npm run arch:migrate`: PASS as read-only post-migration status",
      "- `npm run build`: PASS with architecture guardrail first",
      "",
      "## Hashes",
      "",
      `- package.json before: \`${before.packageJsonSha256}\``,
      `- package.json after: \`${after.packageJsonSha256}\``,
      `- agents.mjs before: \`${before.agentsSha256}\``,
      `- agents.mjs after: \`${after.agentsSha256}\``,
      "",
      "The v20 architecture is now enforced as part of normal development instead of existing only as a one-time migration process.",
      "",
    ].join("\n");

    fs.writeFileSync(
      abs(`${outputDir}/stage43-report.md`),
      report,
      "utf8",
    );

    console.log("");
    console.log("============================================================");
    console.log("  ETAPA 43: PASS");
    console.log("============================================================");
    console.log("[OK] arch:audit instalado.");
    console.log("[OK] arch:check instalado.");
    console.log("[OK] arch:dependencies instalado.");
    console.log("[OK] arch:migrate instalado como status pós-migração read-only.");
    console.log("[OK] build agora depende de arch:check.");
    console.log(
      "[OK] agents.mjs agora fiscaliza boundaries + dependency graph.",
    );
    console.log("[OK] --lock/--unlock preservados.");
    console.log("[OK] npm run build passou com os novos guardrails.");
    console.log(`[OK] Evidência: ${outputDir}/stage43-evidence.json`);
    console.log(`[OK] Relatório: ${outputDir}/stage43-report.md`);
    console.log("[INFO] Etapa 44 pode iniciar separadamente.");
  } catch (error) {
    console.error("");
    console.error("============================================================");
    console.error("  ETAPA 43: REPROVADA");
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
