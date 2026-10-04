#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const SCRIPT_NAME = "stage1-functional-baseline.mjs";
const SCHEMA_VERSION = 1;
const STAGE_NAME = "stage-1-functional-baseline";
const DEFAULT_OUTPUT_ROOT = ".migration/stage1";
const DEFAULT_TIMEOUT_MINUTES = 30;

const CHECKS = Object.freeze([
  {
    id: "tsc",
    label: "TypeScript",
    command: "npx tsc --noEmit",
  },
  {
    id: "vitest",
    label: "Vitest",
    command: "npx vitest run",
  },
  {
    id: "cargo-check",
    label: "Cargo Check",
    command: "cargo check --manifest-path src-tauri/Cargo.toml",
  },
  {
    id: "build",
    label: "Build",
    command: "npm run build",
  },
  {
    id: "agents",
    label: "AGENTS Guardrail",
    command: "node agents.mjs",
  },
]);

function printHelp() {
  console.log(`
Projeto1 — Etapa 1: Baseline Funcional Completo

Uso:
  node scripts/architecture/${SCRIPT_NAME}
  node scripts/architecture/${SCRIPT_NAME} --timeout-minutes 45
  node scripts/architecture/${SCRIPT_NAME} --output .migration/stage1
  node scripts/architecture/${SCRIPT_NAME} --help

Executa, exatamente nesta ordem:
  1. npx tsc --noEmit
  2. npx vitest run
  3. cargo check --manifest-path src-tauri/Cargo.toml
  4. npm run build
  5. node agents.mjs

Regras:
  - deve ser executado exatamente na raiz do repositório;
  - exige um baseline válido da Etapa 0 em .migration/stage0/LATEST;
  - confirma que TODOS os arquivos presentes no baseline da Etapa 0 continuam
    byte-a-byte idênticos antes de iniciar os checks;
  - continua executando os checks mesmo quando um deles falha, para registrar
    o estado funcional completo pré-migração;
  - grava stdout, stderr, metadados e resumo em .migration/stage1/<timestamp>/;
  - verifica novamente os arquivos da Etapa 0 ao final para detectar qualquer
    mutação causada por testes/build;
  - não altera código-fonte intencionalmente.

Códigos de saída:
  0 = todos os checks passaram e a árvore da Etapa 0 permaneceu intacta;
  1 = erro de pré-condição/infraestrutura do próprio script;
  2 = um ou mais checks funcionais falharam;
  3 = algum arquivo pertencente ao baseline da Etapa 0 foi alterado/removido
      durante a execução da Etapa 1.

Opções:
  --timeout-minutes <n>  Timeout individual de cada check. Padrão: 30.
  --output <dir>         Diretório-base dos relatórios. Padrão: .migration/stage1.
  --help                 Mostra esta ajuda.
`);
}

function parseArgs(argv) {
  const options = {
    timeoutMinutes: DEFAULT_TIMEOUT_MINUTES,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--timeout-minutes") {
      const raw = argv[index + 1];
      if (!raw || raw.startsWith("--")) {
        throw new Error("--timeout-minutes exige um número.");
      }

      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("--timeout-minutes deve ser maior que zero.");
      }

      options.timeoutMinutes = value;
      index += 1;
      continue;
    }

    if (arg === "--output") {
      const raw = argv[index + 1];
      if (!raw || raw.startsWith("--")) {
        throw new Error("--output exige um diretório.");
      }

      options.outputRoot = raw;
      index += 1;
      continue;
    }

    throw new Error(`Argumento desconhecido: ${arg}`);
  }

  return options;
}

function normalizeAbsolute(inputPath) {
  const resolved = path.resolve(inputPath);
  const normalized = path.normalize(resolved);

  return process.platform === "win32"
    ? normalized.toLowerCase()
    : normalized;
}

function toPosixRelative(rootDir, absolutePath) {
  return path.relative(rootDir, absolutePath).split(path.sep).join("/");
}

function runGit(args, cwd, allowFailure = false) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.error) {
    if (allowFailure) {
      return null;
    }
    throw result.error;
  }

  if (result.status !== 0) {
    if (allowFailure) {
      return null;
    }

    const stderr = String(result.stderr ?? "").trim();
    throw new Error(
      stderr.length > 0
        ? `git ${args.join(" ")} falhou: ${stderr}`
        : `git ${args.join(" ")} falhou com código ${result.status}.`,
    );
  }

  return String(result.stdout ?? "").trimEnd();
}

function assertRepositoryRoot(cwd) {
  const inside = runGit(["rev-parse", "--is-inside-work-tree"], cwd);

  if (inside !== "true") {
    throw new Error("O diretório atual não pertence a um repositório Git.");
  }

  const gitRootRaw = runGit(["rev-parse", "--show-toplevel"], cwd);

  if (
    normalizeAbsolute(cwd) !==
    normalizeAbsolute(gitRootRaw)
  ) {
    throw new Error(
      [
        "Este script deve ser executado exatamente na raiz do repositório.",
        `Diretório atual: ${cwd}`,
        `Raiz detectada: ${gitRootRaw}`,
      ].join("\n"),
    );
  }

  return path.resolve(gitRootRaw);
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function sha256Text(text) {
  return crypto
    .createHash("sha256")
    .update(text, "utf8")
    .digest("hex");
}

function parseShaManifest(text) {
  const entries = [];

  for (const rawLine of text.split(/\r?\n/u)) {
    if (rawLine.length === 0) {
      continue;
    }

    const match = /^([a-f0-9]{64})  (.+)$/u.exec(rawLine);

    if (!match) {
      throw new Error(
        `Linha inválida no manifesto SHA-256 da Etapa 0: ${rawLine}`,
      );
    }

    entries.push({
      sha256: match[1],
      path: match[2],
    });
  }

  return entries;
}

function loadStage0Anchor(rootDir) {
  const stage0Root = path.join(rootDir, ".migration", "stage0");
  const latestPath = path.join(stage0Root, "LATEST");

  if (!fs.existsSync(latestPath)) {
    throw new Error(
      "Baseline da Etapa 0 não encontrado: .migration/stage0/LATEST",
    );
  }

  const baselineId = fs.readFileSync(latestPath, "utf8").trim();

  if (baselineId.length === 0) {
    throw new Error(".migration/stage0/LATEST está vazio.");
  }

  const baselineDir = path.join(stage0Root, baselineId);
  const baselineJsonPath = path.join(
    baselineDir,
    "migration-baseline.json",
  );
  const manifestPath = path.join(
    baselineDir,
    "project-files.sha256",
  );

  if (!fs.existsSync(baselineJsonPath)) {
    throw new Error(
      `Baseline JSON da Etapa 0 ausente: ${toPosixRelative(rootDir, baselineJsonPath)}`,
    );
  }

  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `Manifesto SHA-256 da Etapa 0 ausente: ${toPosixRelative(rootDir, manifestPath)}`,
    );
  }

  const baseline = JSON.parse(
    fs.readFileSync(baselineJsonPath, "utf8"),
  );

  if (baseline.stage !== "stage-0-reference-freeze") {
    throw new Error(
      "O baseline indicado por .migration/stage0/LATEST não pertence à Etapa 0.",
    );
  }

  const manifestText = fs.readFileSync(manifestPath, "utf8");
  const entries = parseShaManifest(manifestText);

  return {
    baselineId,
    baselineDir,
    baselineJsonPath,
    manifestPath,
    baseline,
    manifestText,
    entries,
  };
}

function verifyStage0Files(rootDir, stage0Anchor) {
  const changed = [];
  const removed = [];

  for (const entry of stage0Anchor.entries) {
    const absolutePath = path.join(
      rootDir,
      ...entry.path.split("/"),
    );

    if (!fs.existsSync(absolutePath)) {
      removed.push(entry.path);
      continue;
    }

    const stat = fs.lstatSync(absolutePath);

    if (!stat.isFile()) {
      changed.push({
        path: entry.path,
        expected: entry.sha256,
        actual: "<não é mais um arquivo regular>",
      });
      continue;
    }

    const actual = sha256File(absolutePath);

    if (actual !== entry.sha256) {
      changed.push({
        path: entry.path,
        expected: entry.sha256,
        actual,
      });
    }
  }

  const canonicalManifest = stage0Anchor.entries
    .map((entry) => `${entry.sha256}  ${entry.path}`)
    .join("\n") + (stage0Anchor.entries.length > 0 ? "\n" : "");

  return {
    baselineId: stage0Anchor.baselineId,
    expectedFileCount: stage0Anchor.entries.length,
    changed,
    removed,
    intact: changed.length === 0 && removed.length === 0,
    manifestSha256: sha256Text(canonicalManifest),
  };
}

function getRepositoryMetadata(rootDir) {
  const head = runGit(
    ["rev-parse", "--verify", "HEAD"],
    rootDir,
    true,
  );

  const branch =
    runGit(
      ["symbolic-ref", "--quiet", "--short", "HEAD"],
      rootDir,
      true,
    ) ??
    runGit(["branch", "--show-current"], rootDir, true) ??
    "";

  return {
    branch: branch.length > 0 ? branch : null,
    head,
    hasCommits: head !== null,
    gitVersion: runGit(["--version"], rootDir),
    statusShortBranch: runGit(
      ["status", "--short", "--branch", "--untracked-files=all"],
      rootDir,
    ),
    statusPorcelainV1: runGit(
      ["status", "--porcelain=v1", "--untracked-files=all"],
      rootDir,
    ),
  };
}

function makeRunId(date) {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/u, "Z")
    .replaceAll(":", "-");
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeText(filePath, content) {
  fs.writeFileSync(filePath, content, {
    encoding: "utf8",
  });
}

function writeJson(filePath, value) {
  writeText(
    filePath,
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

function sanitizeForFileName(value) {
  return value.replace(/[^a-z0-9._-]+/giu, "-");
}

function createShellInvocation(command) {
  if (process.platform === "win32") {
    return {
      executable: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", command],
      detached: false,
    };
  }

  return {
    executable: "/bin/sh",
    args: ["-c", command],
    detached: true,
  };
}

function terminateChildTree(child) {
  if (!child.pid) {
    return;
  }

  if (process.platform === "win32") {
    spawnSync(
      "taskkill",
      ["/PID", String(child.pid), "/T", "/F"],
      {
        stdio: "ignore",
        windowsHide: true,
      },
    );
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // O processo já pode ter finalizado.
    }
  }
}

async function runCheck({
  rootDir,
  commandsDir,
  index,
  check,
  timeoutMs,
}) {
  const number = String(index + 1).padStart(2, "0");
  const baseName = `${number}-${sanitizeForFileName(check.id)}`;

  const stdoutPath = path.join(
    commandsDir,
    `${baseName}.stdout.log`,
  );
  const stderrPath = path.join(
    commandsDir,
    `${baseName}.stderr.log`,
  );
  const metaPath = path.join(
    commandsDir,
    `${baseName}.meta.json`,
  );

  const stdoutStream = fs.createWriteStream(stdoutPath, {
    flags: "w",
  });
  const stderrStream = fs.createWriteStream(stderrPath, {
    flags: "w",
  });

  const startedAt = new Date();
  const startedHr = process.hrtime.bigint();

  console.log("");
  console.log("------------------------------------------------------------");
  console.log(
    `[${index + 1}/${CHECKS.length}] ${check.label}`,
  );
  console.log(`$ ${check.command}`);
  console.log("------------------------------------------------------------");

  const invocation = createShellInvocation(check.command);

  const result = await new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let spawnError = null;
    let exitCode = null;
    let signal = null;

    const child = spawn(
      invocation.executable,
      invocation.args,
      {
        cwd: rootDir,
        env: process.env,
        windowsHide: true,
        detached: invocation.detached,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    child.stdout?.on("data", (chunk) => {
      stdoutStream.write(chunk);
      process.stdout.write(chunk);
    });

    child.stderr?.on("data", (chunk) => {
      stderrStream.write(chunk);
      process.stderr.write(chunk);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      console.error(
        `\n[TIMEOUT] ${check.label} excedeu ${Math.round(timeoutMs / 60000)} minuto(s).`,
      );
      terminateChildTree(child);
    }, timeoutMs);

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);

      stdoutStream.end(() => {
        stderrStream.end(() => {
          resolve({
            timedOut,
            spawnError,
            exitCode,
            signal,
          });
        });
      });
    };

    child.on("error", (error) => {
      spawnError =
        error instanceof Error
          ? error.message
          : String(error);
      finish();
    });

    child.on("close", (code, closeSignal) => {
      exitCode = code;
      signal = closeSignal;
      finish();
    });
  });

  const finishedAt = new Date();
  const durationMs = Number(
    (process.hrtime.bigint() - startedHr) / 1_000_000n,
  );

  const passed =
    result.spawnError === null &&
    result.timedOut === false &&
    result.exitCode === 0;

  const metadata = {
    id: check.id,
    label: check.label,
    command: check.command,
    startedAtUtc: startedAt.toISOString(),
    finishedAtUtc: finishedAt.toISOString(),
    durationMs,
    timeoutMs,
    passed,
    timedOut: result.timedOut,
    exitCode: result.exitCode,
    signal: result.signal,
    spawnError: result.spawnError,
    stdoutFile: `commands/${path.basename(stdoutPath)}`,
    stderrFile: `commands/${path.basename(stderrPath)}`,
  };

  writeJson(metaPath, metadata);

  console.log(
    passed
      ? `\n[PASS] ${check.label} (${durationMs} ms)`
      : `\n[FAIL] ${check.label} (${durationMs} ms)`,
  );

  return metadata;
}

function formatIntegrityProblems(integrity) {
  const lines = [];

  if (integrity.removed.length > 0) {
    lines.push(
      `Arquivos removidos (${integrity.removed.length}):`,
    );
    for (const filePath of integrity.removed.slice(0, 50)) {
      lines.push(`  - ${filePath}`);
    }
    if (integrity.removed.length > 50) {
      lines.push(
        `  ... +${integrity.removed.length - 50} adicionais`,
      );
    }
  }

  if (integrity.changed.length > 0) {
    lines.push(
      `Arquivos alterados (${integrity.changed.length}):`,
    );
    for (const item of integrity.changed.slice(0, 50)) {
      lines.push(`  * ${item.path}`);
      lines.push(`      esperado: ${item.expected}`);
      lines.push(`      atual   : ${item.actual}`);
    }
    if (integrity.changed.length > 50) {
      lines.push(
        `  ... +${integrity.changed.length - 50} adicionais`,
      );
    }
  }

  return lines;
}

function buildTextSummary(report) {
  const lines = [
    "============================================================",
    "  PROJETO1 — ETAPA 1: BASELINE FUNCIONAL COMPLETO",
    "============================================================",
    "",
    `Run ID: ${report.runId}`,
    `Início: ${report.startedAtUtc}`,
    `Fim: ${report.finishedAtUtc}`,
    `Raiz: ${report.projectRoot}`,
    `Branch: ${report.repository.branch ?? "(sem branch nomeada)"}`,
    `HEAD: ${report.repository.head ?? "(repositório ainda sem commits)"}`,
    `Baseline Etapa 0: ${report.stage0.baselineId}`,
    `Status geral: ${report.status.toUpperCase()}`,
    "",
    "Checks:",
  ];

  for (const check of report.checks) {
    lines.push(
      `  ${check.passed ? "[PASS]" : "[FAIL]"} ${check.label}`,
    );
    lines.push(`         ${check.command}`);
    lines.push(
      `         exit=${String(check.exitCode)} timeout=${String(check.timedOut)} duração=${check.durationMs}ms`,
    );
  }

  lines.push("");
  lines.push(
    `Integridade Etapa 0 antes: ${report.stage0.before.intact ? "OK" : "FALHA"}`,
  );
  lines.push(
    `Integridade Etapa 0 depois: ${report.stage0.after.intact ? "OK" : "FALHA"}`,
  );

  if (!report.stage0.after.intact) {
    lines.push("");
    lines.push(
      ...formatIntegrityProblems(report.stage0.after),
    );
  }

  if (report.failedChecks.length > 0) {
    lines.push("");
    lines.push("Falhas funcionais pré-migração registradas:");
    for (const id of report.failedChecks) {
      lines.push(`  - ${id}`);
    }
  }

  lines.push("");
  lines.push(
    "Classificação: baseline funcional pré-migração. Falhas registradas aqui",
  );
  lines.push(
    "são estado de referência e não devem ser atribuídas à reestruturação futura.",
  );
  lines.push("");

  return lines.join("\n");
}

async function main() {
  let runDir = null;

  try {
    const options = parseArgs(process.argv.slice(2));

    if (options.help) {
      printHelp();
      return;
    }

    const rootDir = assertRepositoryRoot(process.cwd());
    const stage0Anchor = loadStage0Anchor(rootDir);
    const beforeIntegrity = verifyStage0Files(
      rootDir,
      stage0Anchor,
    );

    const runStartedAt = new Date();
    const runId = makeRunId(runStartedAt);
    const outputRoot = path.resolve(
      rootDir,
      options.outputRoot,
    );

    runDir = path.join(outputRoot, runId);
    const commandsDir = path.join(runDir, "commands");

    ensureDirectory(commandsDir);

    const repositoryBefore = getRepositoryMetadata(rootDir);

    writeJson(
      path.join(runDir, "stage0-anchor.json"),
      {
        baselineId: stage0Anchor.baselineId,
        baselineJson: toPosixRelative(
          rootDir,
          stage0Anchor.baselineJsonPath,
        ),
        sha256Manifest: toPosixRelative(
          rootDir,
          stage0Anchor.manifestPath,
        ),
        treeSha256:
          stage0Anchor.baseline?.hashing?.treeSha256 ?? null,
        expectedFileCount: stage0Anchor.entries.length,
        verificationBefore: beforeIntegrity,
      },
    );

    writeText(
      path.join(runDir, "git-status-before.txt"),
      `${repositoryBefore.statusShortBranch}\n`,
    );

    console.log("============================================================");
    console.log("  PROJETO1 — ETAPA 1: BASELINE FUNCIONAL COMPLETO           ");
    console.log("============================================================\n");
    console.log(`[OK] Raiz Git: ${rootDir}`);
    console.log(
      `[OK] Baseline Etapa 0: ${stage0Anchor.baselineId}`,
    );

    if (!beforeIntegrity.intact) {
      const lines = formatIntegrityProblems(beforeIntegrity);
      writeText(
        path.join(runDir, "PRECONDITION_FAILED.txt"),
        [
          "A Etapa 1 não foi executada porque arquivos pertencentes",
          "ao baseline da Etapa 0 já estavam diferentes antes dos checks.",
          "",
          ...lines,
          "",
        ].join("\n"),
      );

      console.error("");
      console.error(
        "[ERRO] A árvore protegida pela Etapa 0 já divergiu do baseline.",
      );
      for (const line of lines) {
        console.error(line);
      }

      process.exitCode = 1;
      return;
    }

    console.log(
      `[OK] ${beforeIntegrity.expectedFileCount} arquivos da Etapa 0 permanecem byte-a-byte idênticos.`,
    );
    console.log(
      `[INFO] Timeout por check: ${options.timeoutMinutes} minuto(s).`,
    );

    const timeoutMs =
      options.timeoutMinutes * 60 * 1000;

    const results = [];

    for (let index = 0; index < CHECKS.length; index += 1) {
      const checkResult = await runCheck({
        rootDir,
        commandsDir,
        index,
        check: CHECKS[index],
        timeoutMs,
      });
      results.push(checkResult);
    }

    const afterIntegrity = verifyStage0Files(
      rootDir,
      stage0Anchor,
    );
    const repositoryAfter = getRepositoryMetadata(rootDir);
    const finishedAt = new Date();

    writeText(
      path.join(runDir, "git-status-after.txt"),
      `${repositoryAfter.statusShortBranch}\n`,
    );

    const failedChecks = results
      .filter((result) => !result.passed)
      .map((result) => result.id);

    let status = "passed";

    if (!afterIntegrity.intact) {
      status = "source-mutated";
    } else if (failedChecks.length > 0) {
      status = "failed";
    }

    const report = {
      schemaVersion: SCHEMA_VERSION,
      stage: STAGE_NAME,
      classification: "pre-migration-functional-baseline",
      runId,
      startedAtUtc: runStartedAt.toISOString(),
      finishedAtUtc: finishedAt.toISOString(),
      projectRoot: rootDir,
      status,
      repository: {
        branch: repositoryBefore.branch,
        head: repositoryBefore.head,
        hasCommits: repositoryBefore.hasCommits,
        gitVersion: repositoryBefore.gitVersion,
      },
      runtime: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      stage0: {
        baselineId: stage0Anchor.baselineId,
        treeSha256:
          stage0Anchor.baseline?.hashing?.treeSha256 ?? null,
        before: beforeIntegrity,
        after: afterIntegrity,
      },
      checks: results,
      failedChecks,
      notes: [
        "Todos os checks foram executados em sequência mesmo quando um check anterior falhou.",
        "Falhas registradas nesta etapa representam o estado funcional pré-migração.",
        "Arquivos adicionados após a Etapa 0 não invalidam o anchor; arquivos que pertenciam à Etapa 0 devem permanecer byte-a-byte idênticos.",
        "A pasta .migration contém somente artefatos de auditoria e não faz parte da árvore SHA-256 da Etapa 0.",
      ],
    };

    writeJson(
      path.join(runDir, "functional-baseline.json"),
      report,
    );

    writeText(
      path.join(runDir, "functional-baseline.txt"),
      `${buildTextSummary(report)}\n`,
    );

    ensureDirectory(outputRoot);
    writeText(
      path.join(outputRoot, "LATEST"),
      `${runId}\n`,
    );

    console.log("");
    console.log("============================================================");
    console.log("  RESULTADO DA ETAPA 1                                      ");
    console.log("============================================================");

    for (const result of results) {
      console.log(
        `${result.passed ? "[PASS]" : "[FAIL]"} ${result.label}`,
      );
    }

    console.log(
      `${afterIntegrity.intact ? "[PASS]" : "[FAIL]"} Integridade dos arquivos da Etapa 0 após os checks`,
    );
    console.log("");
    console.log(
      `Relatório: ${toPosixRelative(rootDir, path.join(runDir, "functional-baseline.json"))}`,
    );

    if (!afterIntegrity.intact) {
      console.error("");
      console.error(
        "[FALHA] Um ou mais arquivos pertencentes ao baseline da Etapa 0 foram alterados/removidos durante a Etapa 1.",
      );
      for (const line of formatIntegrityProblems(afterIntegrity)) {
        console.error(line);
      }
      process.exitCode = 3;
      return;
    }

    if (failedChecks.length > 0) {
      console.error("");
      console.error(
        `[BASELINE COM FALHAS] ${failedChecks.length} check(s) falharam. O relatório foi salvo integralmente.`,
      );
      process.exitCode = 2;
      return;
    }

    console.log("");
    console.log(
      "[SUCESSO] Etapa 1 concluída: baseline funcional totalmente verde.",
    );
    process.exitCode = 0;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.stack || error.message
        : String(error);

    console.error("");
    console.error("[ERRO] Etapa 1 não concluída.");
    console.error(message);

    if (runDir !== null && fs.existsSync(runDir)) {
      try {
        writeText(
          path.join(runDir, "SCRIPT_ERROR.txt"),
          `${message}\n`,
        );
      } catch {
        // Evita mascarar o erro original.
      }
    }

    process.exitCode = 1;
  }
}

await main();
