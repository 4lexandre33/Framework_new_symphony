#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SCRIPT_NAME = "stage0-baseline.mjs";
const SCHEMA_VERSION = 1;
const STAGE_NAME = "stage-0-reference-freeze";

const DEFAULT_OUTPUT_ROOT = ".migration/stage0";

const DEFAULT_EXCLUDED_TOP_LEVEL = new Set([
  ".git",
  ".migration",
  "node_modules",
  "dist",
  "coverage",
  "target",
]);

const DEFAULT_EXCLUDED_RELATIVE_PREFIXES = [
  "src-tauri/target/",
  ".vite/",
  ".turbo/",
  ".cache/",
];

function printHelp() {
  console.log(`
Projeto1 — Etapa 0: Congelamento do Estado de Referência

Uso:
  node scripts/architecture/${SCRIPT_NAME}
  node scripts/architecture/${SCRIPT_NAME} --output .migration/stage0
  node scripts/architecture/${SCRIPT_NAME} --fail-on-dirty
  node scripts/architecture/${SCRIPT_NAME} --verify-latest
  node scripts/architecture/${SCRIPT_NAME} --verify <caminho/migration-baseline.json>

O que este script faz:
  1. Confirma que o diretório atual é exatamente a raiz do repositório Git.
  2. Registra branch, HEAD, versão do Git e git status antes de qualquer escrita.
  3. Percorre os arquivos reais do projeto sem seguir symlinks.
  4. Calcula SHA-256 de cada arquivo relevante.
  5. Gera um hash agregado determinístico da árvore.
  6. Grava o baseline em .migration/stage0/<timestamp>/.
  7. Não modifica código-fonte, configuração da engine ou arquivos congelados.

Exclusões padrão da árvore de hashes:
  .git/
  .migration/
  node_modules/
  dist/
  coverage/
  target/
  src-tauri/target/
  .vite/
  .turbo/
  .cache/

Opções:
  --output <dir>       Altera o diretório-base dos baselines.
  --fail-on-dirty      Aborta se o working tree já estiver sujo.
  --verify <json>      Compara a árvore atual contra um baseline existente.
  --verify-latest      Verifica o último baseline gerado pelo output padrão.
  --help               Mostra esta ajuda.
`);
}

function parseArgs(argv) {
  const result = {
    outputRoot: DEFAULT_OUTPUT_ROOT,
    failOnDirty: false,
    verifyPath: null,
    verifyLatest: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }

    if (arg === "--fail-on-dirty") {
      result.failOnDirty = true;
      continue;
    }

    if (arg === "--verify-latest") {
      result.verifyLatest = true;
      continue;
    }

    if (arg === "--output") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--output exige um diretório.");
      }
      result.outputRoot = next;
      index += 1;
      continue;
    }

    if (arg === "--verify") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--verify exige o caminho para migration-baseline.json.");
      }
      result.verifyPath = next;
      index += 1;
      continue;
    }

    throw new Error(`Argumento desconhecido: ${arg}`);
  }

  if (result.verifyPath !== null && result.verifyLatest) {
    throw new Error("Use apenas --verify ou --verify-latest, não ambos.");
  }

  return result;
}

function normalizeAbsolute(inputPath) {
  const resolved = path.resolve(inputPath);
  const normalized = path.normalize(resolved);

  if (process.platform === "win32") {
    return normalized.toLowerCase();
  }

  return normalized;
}

function toPosixRelative(rootDir, absolutePath) {
  return path.relative(rootDir, absolutePath).split(path.sep).join("/");
}

function runGit(args, cwd, allowFailure = false) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }).trimEnd();
  } catch (error) {
    if (allowFailure) {
      return null;
    }

    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String(error.stderr ?? "").trim()
        : "";

    throw new Error(
      stderr.length > 0
        ? `git ${args.join(" ")} falhou: ${stderr}`
        : `git ${args.join(" ")} falhou.`,
    );
  }
}

function assertRepositoryRoot(cwd) {
  const inside = runGit(["rev-parse", "--is-inside-work-tree"], cwd);

  if (inside !== "true") {
    throw new Error("O diretório atual não pertence a um repositório Git.");
  }

  const gitRootRaw = runGit(["rev-parse", "--show-toplevel"], cwd);
  const cwdNormalized = normalizeAbsolute(cwd);
  const rootNormalized = normalizeAbsolute(gitRootRaw);

  if (cwdNormalized !== rootNormalized) {
    throw new Error(
      [
        "Este script deve ser executado exatamente na raiz do repositório.",
        `Diretório atual: ${cwd}`,
        `Raiz detectada: ${gitRootRaw}`,
        "",
        `Execute: cd "${gitRootRaw}"`,
      ].join("\n"),
    );
  }

  return path.resolve(gitRootRaw);
}

function getGitMetadata(rootDir) {
  const statusPorcelain = runGit(
    ["status", "--porcelain=v1", "--untracked-files=all"],
    rootDir,
  );

  const statusShortBranch = runGit(
    ["status", "--short", "--branch", "--untracked-files=all"],
    rootDir,
  );

  const statusLong = runGit(
    ["status", "--untracked-files=all"],
    rootDir,
  );

  const head = runGit(["rev-parse", "--verify", "HEAD"], rootDir, true);
  const branch =
    runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], rootDir, true) ??
    runGit(["branch", "--show-current"], rootDir, true) ??
    "";

  const gitVersion = runGit(["--version"], rootDir);

  return {
    gitVersion,
    branch: branch.length > 0 ? branch : null,
    head,
    hasCommits: head !== null,
    isDirty: statusPorcelain.trim().length > 0,
    statusPorcelain,
    statusShortBranch,
    statusLong,
  };
}

function isExcluded(relativePosixPath, dirent) {
  if (relativePosixPath.length === 0) {
    return false;
  }

  const segments = relativePosixPath.split("/");
  const topLevel = segments[0];

  if (DEFAULT_EXCLUDED_TOP_LEVEL.has(topLevel)) {
    return true;
  }

  const pathWithSlash = dirent.isDirectory()
    ? `${relativePosixPath}/`
    : relativePosixPath;

  return DEFAULT_EXCLUDED_RELATIVE_PREFIXES.some(
    (prefix) =>
      pathWithSlash === prefix ||
      pathWithSlash.startsWith(prefix),
  );
}

function collectProjectFiles(rootDir) {
  const files = [];
  const symlinks = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) {
      continue;
    }

    const entries = fs.readdirSync(currentDir, {
      withFileTypes: true,
    });

    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));

    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = toPosixRelative(rootDir, absolutePath);

      if (isExcluded(relativePath, entry)) {
        continue;
      }

      if (relativePath.includes("\n") || relativePath.includes("\r")) {
        throw new Error(
          `Nome de arquivo não suportado no manifesto SHA-256: ${JSON.stringify(relativePath)}`,
        );
      }

      if (entry.isSymbolicLink()) {
        symlinks.push({
          path: relativePath,
          target: fs.readlinkSync(absolutePath),
        });
        continue;
      }

      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }

      if (entry.isFile()) {
        files.push({
          absolutePath,
          relativePath,
        });
      }
    }
  }

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "en"));
  symlinks.sort((a, b) => a.path.localeCompare(b.path, "en"));

  return { files, symlinks };
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const fileBuffer = fs.readFileSync(filePath);
  hash.update(fileBuffer);
  return hash.digest("hex");
}

function hashProjectFiles(rootDir) {
  const { files, symlinks } = collectProjectFiles(rootDir);
  const records = [];
  let totalBytes = 0;

  for (const file of files) {
    const stat = fs.statSync(file.absolutePath);
    const sha256 = sha256File(file.absolutePath);

    totalBytes += stat.size;

    records.push({
      path: file.relativePath,
      bytes: stat.size,
      sha256,
    });
  }

  const manifestText = records
    .map((record) => `${record.sha256}  ${record.path}`)
    .join("\n") + (records.length > 0 ? "\n" : "");

  const treeSha256 = crypto
    .createHash("sha256")
    .update(manifestText, "utf8")
    .digest("hex");

  return {
    records,
    symlinks,
    manifestText,
    totalBytes,
    treeSha256,
  };
}

function makeBaselineId(date) {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
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

function detectFreezeFiles(rootDir) {
  const candidates = [
    ".freeze-lock.json",
    "tests/.freeze-lock.json",
  ];

  return candidates.map((relativePath) => {
    const absolutePath = path.join(rootDir, relativePath);
    if (!fs.existsSync(absolutePath)) {
      return {
        path: relativePath,
        exists: false,
        sha256: null,
      };
    }

    return {
      path: relativePath,
      exists: true,
      sha256: sha256File(absolutePath),
    };
  });
}

function createBaseline(rootDir, options) {
  const gitBefore = getGitMetadata(rootDir);

  if (options.failOnDirty && gitBefore.isDirty) {
    throw new Error(
      "O working tree está sujo e --fail-on-dirty foi informado. Nenhum baseline foi gravado.",
    );
  }

  console.log("============================================================");
  console.log("  PROJETO1 — ETAPA 0: BASELINE DE REFERÊNCIA                ");
  console.log("============================================================\n");

  console.log(`[OK] Raiz Git confirmada: ${rootDir}`);
  console.log(
    `[INFO] Branch: ${gitBefore.branch ?? "(sem branch nomeada)"}`,
  );
  console.log(
    `[INFO] HEAD: ${gitBefore.head ?? "(repositório ainda sem commits)"}`,
  );
  console.log(
    `[INFO] Working tree: ${gitBefore.isDirty ? "SUJO (registrado, não alterado)" : "LIMPO"}`,
  );

  console.log("\n[1/3] Calculando SHA-256 da árvore do projeto...");
  const hashResult = hashProjectFiles(rootDir);

  const generatedAt = new Date();
  const baselineId = makeBaselineId(generatedAt);

  const outputRootAbs = path.resolve(rootDir, options.outputRoot);
  const baselineDir = path.join(outputRootAbs, baselineId);

  if (fs.existsSync(baselineDir)) {
    throw new Error(
      `Diretório de baseline já existe: ${baselineDir}`,
    );
  }

  const baselineRelativeDir = toPosixRelative(rootDir, baselineDir);

  console.log(
    `[OK] ${hashResult.records.length} arquivos | ${hashResult.totalBytes} bytes`,
  );
  console.log(`[OK] Tree SHA-256: ${hashResult.treeSha256}`);

  console.log("\n[2/3] Gravando artefatos da Etapa 0...");
  ensureDirectory(baselineDir);

  const statusLongPath = path.join(baselineDir, "git-status.txt");
  const statusShortPath = path.join(
    baselineDir,
    "git-status-short-branch.txt",
  );
  const statusPorcelainPath = path.join(
    baselineDir,
    "git-status-porcelain-v1.txt",
  );
  const shaManifestPath = path.join(
    baselineDir,
    "project-files.sha256",
  );
  const symlinksPath = path.join(
    baselineDir,
    "symlinks.json",
  );
  const baselineJsonPath = path.join(
    baselineDir,
    "migration-baseline.json",
  );

  writeText(
    statusLongPath,
    `${gitBefore.statusLong}\n`,
  );
  writeText(
    statusShortPath,
    `${gitBefore.statusShortBranch}\n`,
  );
  writeText(
    statusPorcelainPath,
    gitBefore.statusPorcelain.length > 0
      ? `${gitBefore.statusPorcelain}\n`
      : "",
  );
  writeText(shaManifestPath, hashResult.manifestText);
  writeJson(symlinksPath, hashResult.symlinks);

  const baseline = {
    schemaVersion: SCHEMA_VERSION,
    stage: STAGE_NAME,
    baselineId,
    generatedAtUtc: generatedAt.toISOString(),
    projectRoot: rootDir,
    repository: {
      branch: gitBefore.branch,
      head: gitBefore.head,
      hasCommits: gitBefore.hasCommits,
      wasDirtyBeforeBaselineWrite: gitBefore.isDirty,
      gitVersion: gitBefore.gitVersion,
    },
    runtime: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    hashing: {
      algorithm: "sha256",
      fileCount: hashResult.records.length,
      totalBytes: hashResult.totalBytes,
      treeSha256: hashResult.treeSha256,
      followsSymlinks: false,
      symlinkCount: hashResult.symlinks.length,
      excludedTopLevelDirectories: Array.from(
        DEFAULT_EXCLUDED_TOP_LEVEL,
      ).sort(),
      excludedRelativePrefixes: [
        ...DEFAULT_EXCLUDED_RELATIVE_PREFIXES,
      ].sort(),
    },
    freezeLocks: detectFreezeFiles(rootDir),
    artifacts: {
      directory: baselineRelativeDir,
      sha256Manifest: "project-files.sha256",
      gitStatus: "git-status.txt",
      gitStatusShortBranch: "git-status-short-branch.txt",
      gitStatusPorcelainV1: "git-status-porcelain-v1.txt",
      symlinks: "symlinks.json",
    },
    notes: [
      "O status Git foi capturado antes da criação dos artefatos de baseline.",
      "A pasta .migration é excluída da árvore de hashes para evitar autorreferência.",
      "Symlinks não são seguidos; seus destinos são registrados separadamente.",
      "Nenhum arquivo de src/, src-tauri/, tests/, package.json, tsconfig.json ou configuração da engine é modificado por este script.",
    ],
  };

  writeJson(baselineJsonPath, baseline);

  ensureDirectory(outputRootAbs);
  writeText(
    path.join(outputRootAbs, "LATEST"),
    `${baselineId}\n`,
  );

  console.log(`[OK] ${baselineRelativeDir}/migration-baseline.json`);
  console.log(`[OK] ${baselineRelativeDir}/project-files.sha256`);
  console.log(`[OK] ${baselineRelativeDir}/git-status.txt`);
  console.log(`[OK] ${baselineRelativeDir}/symlinks.json`);

  console.log("\n[3/3] Verificando os artefatos recém-gravados...");
  verifyBaseline(rootDir, baselineJsonPath, {
    quietSuccessHeader: true,
  });

  console.log("\n============================================================");
  console.log("  ETAPA 0 CONCLUÍDA COM SUCESSO                              ");
  console.log("============================================================");
  console.log(`Baseline ID : ${baselineId}`);
  console.log(`Arquivos    : ${hashResult.records.length}`);
  console.log(`Tree SHA-256: ${hashResult.treeSha256}`);
  console.log(`Diretório   : ${baselineRelativeDir}`);
  console.log("");
  console.log("Próxima ação recomendada:");
  console.log(
    `  node scripts/architecture/${SCRIPT_NAME} --verify-latest`,
  );
  console.log("");
}

function parseShaManifest(text) {
  const map = new Map();

  for (const rawLine of text.split(/\r?\n/u)) {
    if (rawLine.length === 0) {
      continue;
    }

    const match = /^([a-f0-9]{64})  (.+)$/u.exec(rawLine);

    if (!match) {
      throw new Error(
        `Linha inválida em project-files.sha256: ${rawLine}`,
      );
    }

    map.set(match[2], match[1]);
  }

  return map;
}

function verifyBaseline(rootDir, baselineJsonPath, options = {}) {
  const absoluteJsonPath = path.resolve(
    rootDir,
    baselineJsonPath,
  );

  if (!fs.existsSync(absoluteJsonPath)) {
    throw new Error(
      `Baseline não encontrado: ${absoluteJsonPath}`,
    );
  }

  const baseline = JSON.parse(
    fs.readFileSync(absoluteJsonPath, "utf8"),
  );

  if (
    baseline.schemaVersion !== SCHEMA_VERSION ||
    baseline.stage !== STAGE_NAME
  ) {
    throw new Error(
      "O arquivo informado não é um baseline compatível com esta versão do script.",
    );
  }

  const baselineDir = path.dirname(absoluteJsonPath);
  const manifestPath = path.join(
    baselineDir,
    baseline.artifacts.sha256Manifest,
  );

  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `Manifesto SHA-256 não encontrado: ${manifestPath}`,
    );
  }

  const expected = parseShaManifest(
    fs.readFileSync(manifestPath, "utf8"),
  );
  const current = hashProjectFiles(rootDir);
  const currentMap = new Map(
    current.records.map((record) => [
      record.path,
      record.sha256,
    ]),
  );

  const added = [];
  const removed = [];
  const changed = [];

  for (const [filePath, expectedHash] of expected) {
    const currentHash = currentMap.get(filePath);

    if (currentHash === undefined) {
      removed.push(filePath);
      continue;
    }

    if (currentHash !== expectedHash) {
      changed.push({
        path: filePath,
        expected: expectedHash,
        actual: currentHash,
      });
    }
  }

  for (const filePath of currentMap.keys()) {
    if (!expected.has(filePath)) {
      added.push(filePath);
    }
  }

  if (!options.quietSuccessHeader) {
    console.log("============================================================");
    console.log("  PROJETO1 — VERIFICAÇÃO DO BASELINE                         ");
    console.log("============================================================\n");
  }

  if (
    added.length === 0 &&
    removed.length === 0 &&
    changed.length === 0 &&
    current.treeSha256 === baseline.hashing.treeSha256
  ) {
    console.log(
      `[OK] Baseline íntegro: ${baseline.baselineId}`,
    );
    console.log(
      `[OK] Tree SHA-256: ${current.treeSha256}`,
    );
    return;
  }

  console.error(
    `[FALHA] A árvore atual diverge do baseline ${baseline.baselineId}.`,
  );

  if (added.length > 0) {
    console.error(`\nArquivos adicionados (${added.length}):`);
    for (const filePath of added.slice(0, 50)) {
      console.error(`  + ${filePath}`);
    }
    if (added.length > 50) {
      console.error(`  ... +${added.length - 50} adicionais`);
    }
  }

  if (removed.length > 0) {
    console.error(`\nArquivos removidos (${removed.length}):`);
    for (const filePath of removed.slice(0, 50)) {
      console.error(`  - ${filePath}`);
    }
    if (removed.length > 50) {
      console.error(`  ... +${removed.length - 50} adicionais`);
    }
  }

  if (changed.length > 0) {
    console.error(`\nArquivos alterados (${changed.length}):`);
    for (const item of changed.slice(0, 50)) {
      console.error(`  * ${item.path}`);
      console.error(`      esperado: ${item.expected}`);
      console.error(`      atual   : ${item.actual}`);
    }
    if (changed.length > 50) {
      console.error(`  ... +${changed.length - 50} adicionais`);
    }
  }

  console.error(
    `\nTree esperado: ${baseline.hashing.treeSha256}`,
  );
  console.error(`Tree atual   : ${current.treeSha256}`);

  process.exitCode = 2;
}

function resolveLatestBaseline(rootDir, outputRoot) {
  const outputRootAbs = path.resolve(rootDir, outputRoot);
  const latestPath = path.join(outputRootAbs, "LATEST");

  if (!fs.existsSync(latestPath)) {
    throw new Error(
      `Nenhum baseline LATEST encontrado em ${outputRootAbs}.`,
    );
  }

  const baselineId = fs
    .readFileSync(latestPath, "utf8")
    .trim();

  if (baselineId.length === 0) {
    throw new Error(
      `Arquivo LATEST vazio: ${latestPath}`,
    );
  }

  return path.join(
    outputRootAbs,
    baselineId,
    "migration-baseline.json",
  );
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));

    if (options.help) {
      printHelp();
      return;
    }

    const cwd = process.cwd();
    const rootDir = assertRepositoryRoot(cwd);

    if (options.verifyLatest) {
      const baselinePath = resolveLatestBaseline(
        rootDir,
        options.outputRoot,
      );
      verifyBaseline(rootDir, baselinePath);
      return;
    }

    if (options.verifyPath !== null) {
      verifyBaseline(
        rootDir,
        path.resolve(rootDir, options.verifyPath),
      );
      return;
    }

    createBaseline(rootDir, options);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error("\n[ERRO] Etapa 0 não concluída.");
    console.error(message);
    process.exitCode = 1;
  }
}

main();
