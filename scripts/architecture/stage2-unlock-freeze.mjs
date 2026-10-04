#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT_NAME = "stage2-unlock-freeze.mjs";
const STAGE_NAME = "stage-2-controlled-freeze-unlock";
const SCHEMA_VERSION = 1;

const LOCK_RELATIVE_PATH = "tests/.freeze-lock.json";
const AGENTS_RELATIVE_PATH = "agents.mjs";
const OUTPUT_ROOT_RELATIVE_PATH = ".migration/stage2";

function fail(message) {
  throw new Error(message);
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

function sha256Buffer(buffer) {
  return crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
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

function runCommand(executable, args, cwd, options = {}) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    stdio: options.inherit
      ? "inherit"
      : ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    throw result.error;
  }

  return {
    exitCode: result.status,
    signal: result.signal,
    stdout:
      options.inherit
        ? ""
        : String(result.stdout ?? ""),
    stderr:
      options.inherit
        ? ""
        : String(result.stderr ?? ""),
  };
}

function runGit(args, cwd, allowFailure = false) {
  const result = runCommand("git", args, cwd);

  if (result.exitCode !== 0) {
    if (allowFailure) {
      return null;
    }

    const stderr = result.stderr.trim();

    fail(
      stderr.length > 0
        ? `git ${args.join(" ")} falhou: ${stderr}`
        : `git ${args.join(" ")} falhou com código ${String(result.exitCode)}.`,
    );
  }

  return result.stdout.trimEnd();
}

function assertRepositoryRoot(cwd) {
  const inside = runGit(
    ["rev-parse", "--is-inside-work-tree"],
    cwd,
  );

  if (inside !== "true") {
    fail(
      "O diretório atual não pertence a um repositório Git.",
    );
  }

  const gitRootRaw = runGit(
    ["rev-parse", "--show-toplevel"],
    cwd,
  );

  if (
    normalizeAbsolute(cwd) !==
    normalizeAbsolute(gitRootRaw)
  ) {
    fail(
      [
        "Este script deve ser executado exatamente na raiz do repositório.",
        `Diretório atual: ${cwd}`,
        `Raiz detectada: ${gitRootRaw}`,
      ].join("\n"),
    );
  }

  return path.resolve(gitRootRaw);
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
    runGit(
      ["branch", "--show-current"],
      rootDir,
      true,
    ) ??
    "";

  return {
    branch: branch.length > 0 ? branch : null,
    head,
    hasCommits: head !== null,
    gitVersion: runGit(["--version"], rootDir),
    statusBefore: runGit(
      [
        "status",
        "--short",
        "--branch",
        "--untracked-files=all",
      ],
      rootDir,
    ),
  };
}

function assertRequiredFiles(rootDir) {
  const agentsPath = path.join(
    rootDir,
    AGENTS_RELATIVE_PATH,
  );
  const lockPath = path.join(
    rootDir,
    ...LOCK_RELATIVE_PATH.split("/"),
  );

  if (!fs.existsSync(agentsPath)) {
    fail(
      `Arquivo obrigatório ausente: ${AGENTS_RELATIVE_PATH}`,
    );
  }

  if (!fs.statSync(agentsPath).isFile()) {
    fail(
      `${AGENTS_RELATIVE_PATH} existe, mas não é um arquivo regular.`,
    );
  }

  if (!fs.existsSync(lockPath)) {
    fail(
      [
        `A trava esperada não existe: ${LOCK_RELATIVE_PATH}`,
        "A Etapa 2 exige que o projeto esteja congelado antes do desbloqueio controlado.",
        "Não será criada nem removida nenhuma trava automaticamente fora de agents.mjs.",
      ].join("\n"),
    );
  }

  if (!fs.statSync(lockPath).isFile()) {
    fail(
      `${LOCK_RELATIVE_PATH} existe, mas não é um arquivo regular.`,
    );
  }

  return {
    agentsPath,
    lockPath,
  };
}

function parseFreezeLock(lockPath) {
  let parsed;

  try {
    parsed = JSON.parse(
      fs.readFileSync(lockPath, "utf8"),
    );
  } catch (error) {
    fail(
      `Não foi possível interpretar ${LOCK_RELATIVE_PATH}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    fail(
      `${LOCK_RELATIVE_PATH} não contém um objeto JSON válido.`,
    );
  }

  if (
    typeof parsed.version !== "string" ||
    parsed.version.length === 0
  ) {
    fail(
      `${LOCK_RELATIVE_PATH} não possui campo "version" válido.`,
    );
  }

  if (
    parsed.files === null ||
    typeof parsed.files !== "object" ||
    Array.isArray(parsed.files)
  ) {
    fail(
      `${LOCK_RELATIVE_PATH} não possui mapa "files" válido.`,
    );
  }

  const protectedFiles = Object.keys(parsed.files);

  if (protectedFiles.length === 0) {
    fail(
      `${LOCK_RELATIVE_PATH} não protege nenhum arquivo.`,
    );
  }

  for (const relPath of protectedFiles) {
    const expectedHash = parsed.files[relPath];

    if (
      typeof expectedHash !== "string" ||
      !/^[a-f0-9]{64}$/u.test(expectedHash)
    ) {
      fail(
        `Hash inválido no freeze-lock para: ${relPath}`,
      );
    }
  }

  return {
    manifest: parsed,
    protectedFiles,
  };
}

function verifyProtectedFiles(rootDir, freezeLock) {
  const missing = [];
  const changed = [];

  for (const relPath of freezeLock.protectedFiles) {
    const absolutePath = path.join(
      rootDir,
      ...relPath.split("/"),
    );

    if (!fs.existsSync(absolutePath)) {
      missing.push(relPath);
      continue;
    }

    const stat = fs.lstatSync(absolutePath);

    if (!stat.isFile()) {
      changed.push({
        path: relPath,
        expected: freezeLock.manifest.files[relPath],
        actual: "<não é arquivo regular>",
      });
      continue;
    }

    const actual = sha256File(absolutePath);
    const expected = freezeLock.manifest.files[relPath];

    if (actual !== expected) {
      changed.push({
        path: relPath,
        expected,
        actual,
      });
    }
  }

  return {
    intact:
      missing.length === 0 &&
      changed.length === 0,
    protectedFileCount:
      freezeLock.protectedFiles.length,
    missing,
    changed,
  };
}

function formatIntegrityProblems(integrity) {
  const lines = [];

  if (integrity.missing.length > 0) {
    lines.push(
      `Arquivos protegidos ausentes (${integrity.missing.length}):`,
    );
    for (const relPath of integrity.missing) {
      lines.push(`  - ${relPath}`);
    }
  }

  if (integrity.changed.length > 0) {
    lines.push(
      `Arquivos protegidos alterados (${integrity.changed.length}):`,
    );

    for (const item of integrity.changed) {
      lines.push(`  * ${item.path}`);
      lines.push(`      esperado: ${item.expected}`);
      lines.push(`      atual   : ${item.actual}`);
    }
  }

  return lines;
}

function verifyGuardrailsThroughAgents(rootDir) {
  const result = runCommand(
    "node",
    [AGENTS_RELATIVE_PATH],
    rootDir,
  );

  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);

  if (result.exitCode !== 0) {
    fail(
      [
        "A auditoria pré-desbloqueio via agents.mjs falhou.",
        "A trava NÃO foi removida.",
      ].join("\n"),
    );
  }

  return {
    exitCode: result.exitCode,
    stdoutSha256: sha256Buffer(
      Buffer.from(result.stdout, "utf8"),
    ),
    stderrSha256: sha256Buffer(
      Buffer.from(result.stderr, "utf8"),
    ),
  };
}

function unlockThroughAgents(rootDir) {
  const result = runCommand(
    "node",
    [AGENTS_RELATIVE_PATH, "--unlock"],
    rootDir,
  );

  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);

  if (result.exitCode !== 0) {
    fail(
      [
        "agents.mjs --unlock terminou com falha.",
        "A Etapa 2 não foi concluída.",
      ].join("\n"),
    );
  }

  return {
    exitCode: result.exitCode,
    stdoutSha256: sha256Buffer(
      Buffer.from(result.stdout, "utf8"),
    ),
    stderrSha256: sha256Buffer(
      Buffer.from(result.stderr, "utf8"),
    ),
  };
}

function loadStage1StatusIfPresent(rootDir) {
  const stage1Root = path.join(
    rootDir,
    ".migration",
    "stage1",
  );
  const latestPath = path.join(
    stage1Root,
    "LATEST",
  );

  if (!fs.existsSync(latestPath)) {
    return {
      found: false,
      runId: null,
      status: null,
      reportPath: null,
    };
  }

  const runId = fs
    .readFileSync(latestPath, "utf8")
    .trim();

  if (runId.length === 0) {
    return {
      found: true,
      runId: null,
      status: "invalid-latest",
      reportPath: null,
    };
  }

  const reportPath = path.join(
    stage1Root,
    runId,
    "functional-baseline.json",
  );

  if (!fs.existsSync(reportPath)) {
    return {
      found: true,
      runId,
      status: "report-missing",
      reportPath:
        toPosixRelative(rootDir, reportPath),
    };
  }

  try {
    const report = JSON.parse(
      fs.readFileSync(reportPath, "utf8"),
    );

    return {
      found: true,
      runId,
      status:
        typeof report.status === "string"
          ? report.status
          : "status-missing",
      reportPath:
        toPosixRelative(rootDir, reportPath),
    };
  } catch {
    return {
      found: true,
      runId,
      status: "invalid-json",
      reportPath:
        toPosixRelative(rootDir, reportPath),
    };
  }
}

function main() {
  let auditDir = null;
  let lockBackupPath = null;
  let unlockCompleted = false;

  try {
    const rootDir = assertRepositoryRoot(
      process.cwd(),
    );
    const repository = getRepositoryMetadata(
      rootDir,
    );
    const required = assertRequiredFiles(
      rootDir,
    );
    const freezeLock = parseFreezeLock(
      required.lockPath,
    );

    const lockBytes = fs.readFileSync(
      required.lockPath,
    );
    const lockSha256 = sha256Buffer(lockBytes);

    const integrity = verifyProtectedFiles(
      rootDir,
      freezeLock,
    );

    console.log("============================================================");
    console.log("  PROJETO1 — ETAPA 2: DESBLOQUEIO CONTROLADO DO FREEZE     ");
    console.log("============================================================\n");

    console.log(
      `[OK] Raiz Git: ${rootDir}`,
    );
    console.log(
      `[OK] Trava encontrada: ${LOCK_RELATIVE_PATH}`,
    );
    console.log(
      `[INFO] Freeze version: ${freezeLock.manifest.version}`,
    );
    console.log(
      `[INFO] Arquivos protegidos: ${integrity.protectedFileCount}`,
    );
    console.log(
      `[INFO] Freeze SHA-256: ${lockSha256}`,
    );

    if (!integrity.intact) {
      console.error("");
      console.error(
        "[ERRO] A trava existe, mas o conteúdo protegido já divergiu.",
      );

      for (
        const line of
          formatIntegrityProblems(integrity)
      ) {
        console.error(line);
      }

      console.error("");
      console.error(
        "A trava NÃO será removida.",
      );
      process.exitCode = 1;
      return;
    }

    console.log(
      "[OK] Hashes protegidos conferem antes do desbloqueio.",
    );

    const stage1 = loadStage1StatusIfPresent(
      rootDir,
    );

    if (stage1.found) {
      console.log(
        `[INFO] Último baseline da Etapa 1: ${stage1.runId ?? "(inválido)"} | status=${stage1.status}`,
      );
    } else {
      console.log(
        "[INFO] Relatório .migration/stage1/LATEST não encontrado; a Etapa 2 continuará usando a auditoria real de agents.mjs como pré-condição.",
      );
    }

    const startedAt = new Date();
    const runId = makeRunId(startedAt);

    auditDir = path.join(
      rootDir,
      OUTPUT_ROOT_RELATIVE_PATH,
      runId,
    );

    ensureDirectory(auditDir);

    lockBackupPath = path.join(
      auditDir,
      "freeze-lock.before.json",
    );

    fs.writeFileSync(
      lockBackupPath,
      lockBytes,
    );

    writeText(
      path.join(
        auditDir,
        "git-status-before.txt",
      ),
      `${repository.statusBefore}\n`,
    );

    console.log("");
    console.log(
      "[1/2] Auditando invariantes e integridade pelo agents.mjs antes de remover a trava...",
    );

    const preflight =
      verifyGuardrailsThroughAgents(rootDir);

    console.log("");
    console.log(
      "[2/2] Solicitando desbloqueio exclusivamente por agents.mjs --unlock...",
    );

    const unlock =
      unlockThroughAgents(rootDir);

    if (fs.existsSync(required.lockPath)) {
      fail(
        [
          "agents.mjs --unlock retornou sucesso, mas tests/.freeze-lock.json ainda existe.",
          "A Etapa 2 não considera o repositório desbloqueado.",
        ].join("\n"),
      );
    }

    unlockCompleted = true;

    const statusAfter = runGit(
      [
        "status",
        "--short",
        "--branch",
        "--untracked-files=all",
      ],
      rootDir,
    );

    const finishedAt = new Date();

    const report = {
      schemaVersion: SCHEMA_VERSION,
      stage: STAGE_NAME,
      runId,
      startedAtUtc: startedAt.toISOString(),
      finishedAtUtc: finishedAt.toISOString(),
      projectRoot: rootDir,
      repository: {
        branch: repository.branch,
        head: repository.head,
        hasCommits: repository.hasCommits,
        gitVersion: repository.gitVersion,
      },
      stage1: stage1,
      freezeBefore: {
        relativePath: LOCK_RELATIVE_PATH,
        version: freezeLock.manifest.version,
        lockedAt:
          typeof freezeLock.manifest.lockedAt === "string"
            ? freezeLock.manifest.lockedAt
            : null,
        protectedFileCount:
          integrity.protectedFileCount,
        sha256: lockSha256,
        integrity,
        backup:
          toPosixRelative(
            rootDir,
            lockBackupPath,
          ),
      },
      preUnlockGuardrailAudit: preflight,
      unlockCommand: {
        command: "node agents.mjs --unlock",
        ...unlock,
      },
      freezeAfter: {
        relativePath: LOCK_RELATIVE_PATH,
        exists: fs.existsSync(
          required.lockPath,
        ),
        unlocked: !fs.existsSync(
          required.lockPath,
        ),
      },
      status: "unlocked",
      notes: [
        "A trava original foi copiada para .migration/stage2 antes do desbloqueio para auditoria.",
        "A remoção da trava foi solicitada exclusivamente através de node agents.mjs --unlock.",
        "O script não modifica arquivos protegidos nem regenera hashes.",
        "A partir deste ponto, alterações arquiteturais autorizadas podem modificar os caminhos que antes estavam congelados.",
      ],
    };

    writeJson(
      path.join(
        auditDir,
        "stage2-unlock-report.json",
      ),
      report,
    );

    writeText(
      path.join(
        auditDir,
        "git-status-after.txt",
      ),
      `${statusAfter}\n`,
    );

    const outputRoot = path.join(
      rootDir,
      OUTPUT_ROOT_RELATIVE_PATH,
    );

    writeText(
      path.join(outputRoot, "LATEST"),
      `${runId}\n`,
    );

    console.log("");
    console.log("============================================================");
    console.log("  ETAPA 2 CONCLUÍDA COM SUCESSO                             ");
    console.log("============================================================");
    console.log(
      `[DESBLOQUEADO] ${LOCK_RELATIVE_PATH} foi removido por agents.mjs.`,
    );
    console.log(
      `[BACKUP] ${toPosixRelative(rootDir, lockBackupPath)}`,
    );
    console.log(
      `[RELATÓRIO] ${toPosixRelative(rootDir, path.join(auditDir, "stage2-unlock-report.json"))}`,
    );
    console.log("");
    console.log(
      "O repositório permanece desbloqueado para as próximas etapas autorizadas.",
    );

    process.exitCode = 0;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.stack || error.message
        : String(error);

    console.error("");
    console.error(
      "[ERRO] Etapa 2 não concluída.",
    );
    console.error(message);

    if (
      auditDir !== null &&
      fs.existsSync(auditDir)
    ) {
      try {
        writeText(
          path.join(
            auditDir,
            "STAGE2_ERROR.txt",
          ),
          `${message}\n`,
        );
      } catch {
        // Não mascara o erro original.
      }
    }

    if (unlockCompleted) {
      console.error("");
      console.error(
        "[ATENÇÃO] O comando de desbloqueio já havia sido concluído antes do erro posterior.",
      );
      if (lockBackupPath !== null) {
        console.error(
          `Backup da trava original: ${lockBackupPath}`,
        );
      }
    }

    process.exitCode = 1;
  }
}

main();
