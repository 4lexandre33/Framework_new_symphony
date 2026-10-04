#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const SCRIPT_NAME = "audit-layout.mjs";
const SCHEMA_VERSION = 1;
const STAGE_NAME = "stage-3-architecture-inventory";
const OUTPUT_ROOT_RELATIVE_PATH = ".migration/stage3";

const EXCLUDED_TOP_LEVEL_DIRECTORIES = new Set([
  ".git",
  ".migration",
  "node_modules",
  "dist",
  "coverage",
  "target",
]);

const EXCLUDED_RELATIVE_PREFIXES = [
  ".cache/",
  ".turbo/",
  ".vite/",
  "src-tauri/target/",
];

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
]);

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".json",
  ".md",
  ".txt",
  ".toml",
  ".rs",
  ".css",
  ".scss",
  ".html",
  ".svg",
  ".yml",
  ".yaml",
  ".bat",
  ".cmd",
  ".ps1",
  ".sh",
  ".gitignore",
]);

const CONCEPTUAL_DIRECTORIES = Object.freeze([
  {
    path: "src/domain/ports",
    purpose: "Ports/interfaces puras do domínio para dependências externas.",
  },
  {
    path: "src/domain/entities",
    purpose: "Entidades puras de gameplay, sem dependência da engine concreta.",
  },
  {
    path: "src/domain/economy",
    purpose: "Regras de economia e progressão independentes da infraestrutura.",
  },
  {
    path: "src/domain/mechanics",
    purpose: "Mecânicas e regras puras de gameplay.",
  },
  {
    path: "src/domain/narrative",
    purpose: "Modelos e regras narrativas de alto nível.",
  },
  {
    path: "src/domain/evaluation",
    purpose: "Avaliação de regras, condições e resultados do domínio.",
  },
  {
    path: "src/services/ui",
    purpose: "Serviços de aplicação ligados à UI por APIs/ports.",
  },
  {
    path: "src/services/usecases",
    purpose: "Casos de uso que orquestram domínio e portas.",
  },
  {
    path: "src/services/diagnostics",
    purpose: "Serviços de diagnóstico acima das implementações concretas.",
  },
  {
    path: "src/app/flows",
    purpose: "Fluxos/composition de aplicação e estados de alto nível.",
  },
]);

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

function isWithinRoot(rootDir, absolutePath) {
  const root = normalizeAbsolute(rootDir);
  const candidate = normalizeAbsolute(absolutePath);

  return (
    candidate === root ||
    candidate.startsWith(`${root}${path.sep}`)
  );
}

function toPosixRelative(rootDir, absolutePath) {
  return path.relative(rootDir, absolutePath).split(path.sep).join("/");
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

function sha256Buffer(buffer) {
  return crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function runCommand(executable, args, cwd, allowFailure = false) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
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
    fail(
      stderr.length > 0
        ? `${executable} ${args.join(" ")} falhou: ${stderr}`
        : `${executable} ${args.join(" ")} falhou com código ${String(result.status)}.`,
    );
  }

  return String(result.stdout ?? "").trimEnd();
}

function runGit(args, cwd, allowFailure = false) {
  return runCommand("git", args, cwd, allowFailure);
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
    status: runGit(
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

function loadLatestStageReport(
  rootDir,
  stageDirectoryName,
  reportFileName,
  expectedStage,
  expectedStatus,
) {
  const stageRoot = path.join(
    rootDir,
    ".migration",
    stageDirectoryName,
  );
  const latestPath = path.join(
    stageRoot,
    "LATEST",
  );

  if (!fs.existsSync(latestPath)) {
    fail(
      `Pré-condição ausente: .migration/${stageDirectoryName}/LATEST`,
    );
  }

  const runId = fs
    .readFileSync(latestPath, "utf8")
    .trim();

  if (runId.length === 0) {
    fail(
      `.migration/${stageDirectoryName}/LATEST está vazio.`,
    );
  }

  const reportPath = path.join(
    stageRoot,
    runId,
    reportFileName,
  );

  if (!fs.existsSync(reportPath)) {
    fail(
      `Relatório ausente: ${toPosixRelative(rootDir, reportPath)}`,
    );
  }

  let report;

  try {
    report = JSON.parse(
      fs.readFileSync(reportPath, "utf8"),
    );
  } catch (error) {
    fail(
      `JSON inválido em ${toPosixRelative(rootDir, reportPath)}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (report.stage !== expectedStage) {
    fail(
      `Stage inesperado em ${toPosixRelative(rootDir, reportPath)}: ${String(report.stage)}`,
    );
  }

  if (report.status !== expectedStatus) {
    fail(
      `A ${stageDirectoryName} não está em estado "${expectedStatus}". Estado encontrado: ${String(report.status)}`,
    );
  }

  return {
    runId,
    reportPath: toPosixRelative(
      rootDir,
      reportPath,
    ),
    status: report.status,
  };
}

function assertStagePreconditions(rootDir) {
  const stage1 = loadLatestStageReport(
    rootDir,
    "stage1",
    "functional-baseline.json",
    "stage-1-functional-baseline",
    "passed",
  );

  const stage2 = loadLatestStageReport(
    rootDir,
    "stage2",
    "stage2-unlock-report.json",
    "stage-2-controlled-freeze-unlock",
    "unlocked",
  );

  const freezeLockPath = path.join(
    rootDir,
    "tests",
    ".freeze-lock.json",
  );

  if (fs.existsSync(freezeLockPath)) {
    fail(
      [
        "A Etapa 2 não está efetivamente desbloqueada.",
        "tests/.freeze-lock.json ainda existe.",
        "Execute a Etapa 2 antes da Etapa 3.",
      ].join("\n"),
    );
  }

  return {
    stage1,
    stage2,
    freezeUnlocked: true,
  };
}

function isExcluded(relativePath, dirent) {
  if (relativePath.length === 0) {
    return false;
  }

  const segments = relativePath.split("/");
  const topLevel = segments[0];

  if (
    dirent.isDirectory() &&
    EXCLUDED_TOP_LEVEL_DIRECTORIES.has(topLevel)
  ) {
    return true;
  }

  const pathWithSlash = dirent.isDirectory()
    ? `${relativePath}/`
    : relativePath;

  return EXCLUDED_RELATIVE_PREFIXES.some(
    (prefix) =>
      pathWithSlash === prefix ||
      pathWithSlash.startsWith(prefix),
  );
}

function classifyPath(relativePath) {
  if (relativePath.startsWith("src/core/")) {
    return {
      area: "core",
      module: null,
    };
  }

  if (relativePath.startsWith("src/contracts/")) {
    const rest = relativePath.slice(
      "src/contracts/".length,
    );
    const first = rest.split("/")[0];
    const moduleName = first.includes(".")
      ? path.posix.basename(first, path.posix.extname(first))
      : first;

    return {
      area: "contracts",
      module: moduleName,
    };
  }

  if (relativePath.startsWith("src/tokens/")) {
    const base = path.posix.basename(
      relativePath,
      path.posix.extname(relativePath),
    );

    return {
      area: "tokens",
      module: base,
    };
  }

  if (relativePath.startsWith("src/engine/")) {
    const moduleName = relativePath
      .slice("src/engine/".length)
      .split("/")[0];

    return {
      area: "engine",
      module: moduleName || null,
    };
  }

  if (relativePath.startsWith("src/plugins/")) {
    const moduleName = relativePath
      .slice("src/plugins/".length)
      .split("/")[0];

    return {
      area: "plugins",
      module: moduleName || null,
    };
  }

  if (relativePath.startsWith("src/app/")) {
    return {
      area: "app",
      module: null,
    };
  }

  if (relativePath.startsWith("src/debug/")) {
    return {
      area: "debug",
      module: null,
    };
  }

  if (relativePath.startsWith("src/styles/")) {
    return {
      area: "styles",
      module: null,
    };
  }

  if (relativePath.startsWith("src/assets/")) {
    return {
      area: "assets",
      module: null,
    };
  }

  if (relativePath.startsWith("src/domain/")) {
    return {
      area: "domain",
      module: null,
    };
  }

  if (relativePath.startsWith("src/services/")) {
    return {
      area: "services",
      module: null,
    };
  }

  if (relativePath.startsWith("src-tauri/")) {
    return {
      area: "tauri",
      module: null,
    };
  }

  if (relativePath.startsWith("tests/")) {
    return {
      area: "tests",
      module: null,
    };
  }

  if (relativePath.startsWith("scripts/")) {
    return {
      area: "scripts",
      module: null,
    };
  }

  if (relativePath.startsWith("src/")) {
    return {
      area: "src-other",
      module: null,
    };
  }

  return {
    area: "root",
    module: null,
  };
}

function isGeneratedPath(relativePath) {
  return (
    relativePath.startsWith("src-tauri/gen/") ||
    relativePath.startsWith("dist/") ||
    relativePath.startsWith("coverage/")
  );
}

function detectTextFile(relativePath, absolutePath) {
  const basename = path.posix.basename(relativePath);
  const extension = path.posix.extname(relativePath).toLowerCase();

  if (
    TEXT_EXTENSIONS.has(extension) ||
    basename === ".gitignore" ||
    basename === ".gitattributes" ||
    basename === ".npmrc" ||
    basename === "LICENSE"
  ) {
    return true;
  }

  const stat = fs.statSync(absolutePath);

  if (stat.size === 0) {
    return true;
  }

  const fd = fs.openSync(absolutePath, "r");

  try {
    const sampleLength = Math.min(
      8192,
      stat.size,
    );
    const buffer = Buffer.alloc(
      sampleLength,
    );
    fs.readSync(
      fd,
      buffer,
      0,
      sampleLength,
      0,
    );

    return !buffer.includes(0);
  } finally {
    fs.closeSync(fd);
  }
}

function collectProjectTree(rootDir) {
  const fileRecords = [];
  const directoryRecords = [];
  const symlinks = [];

  const stack = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();

    if (!currentDir) {
      continue;
    }

    const entries = fs.readdirSync(
      currentDir,
      {
        withFileTypes: true,
      },
    );

    entries.sort((a, b) =>
      a.name.localeCompare(
        b.name,
        "en",
      ),
    );

    let directFileCount = 0;
    let directDirectoryCount = 0;

    for (
      let index = entries.length - 1;
      index >= 0;
      index -= 1
    ) {
      const entry = entries[index];
      const absolutePath = path.join(
        currentDir,
        entry.name,
      );
      const relativePath =
        toPosixRelative(
          rootDir,
          absolutePath,
        );

      if (
        isExcluded(
          relativePath,
          entry,
        )
      ) {
        continue;
      }

      if (entry.isSymbolicLink()) {
        symlinks.push({
          path: relativePath,
          target: fs.readlinkSync(
            absolutePath,
          ),
        });
        continue;
      }

      if (entry.isDirectory()) {
        directDirectoryCount += 1;
        stack.push(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      directFileCount += 1;

      const stat = fs.statSync(
        absolutePath,
      );
      const classification =
        classifyPath(relativePath);

      fileRecords.push({
        path: relativePath,
        bytes: stat.size,
        extension:
          path.posix.extname(
            relativePath,
          ).toLowerCase(),
        isText: detectTextFile(
          relativePath,
          absolutePath,
        ),
        isGenerated:
          isGeneratedPath(
            relativePath,
          ),
        area:
          classification.area,
        module:
          classification.module,
        sha256:
          sha256File(
            absolutePath,
          ),
      });
    }

    if (
      normalizeAbsolute(currentDir) !==
      normalizeAbsolute(rootDir)
    ) {
      const relativeDirectory =
        toPosixRelative(
          rootDir,
          currentDir,
        );

      if (
        !EXCLUDED_RELATIVE_PREFIXES.some(
          (prefix) =>
            `${relativeDirectory}/`.startsWith(
              prefix,
            ),
        )
      ) {
        directoryRecords.push({
          path:
            relativeDirectory,
          directFileCount,
          directDirectoryCount,
        });
      }
    }
  }

  fileRecords.sort((a, b) =>
    a.path.localeCompare(
      b.path,
      "en",
    ),
  );
  directoryRecords.sort((a, b) =>
    a.path.localeCompare(
      b.path,
      "en",
    ),
  );
  symlinks.sort((a, b) =>
    a.path.localeCompare(
      b.path,
      "en",
    ),
  );

  const manifestText =
    fileRecords
      .map(
        (record) =>
          `${record.sha256}  ${record.path}`,
      )
      .join("\n") +
    (
      fileRecords.length > 0
        ? "\n"
        : ""
    );

  return {
    files: fileRecords,
    directories:
      directoryRecords,
    symlinks,
    treeSha256:
      sha256Buffer(
        Buffer.from(
          manifestText,
          "utf8",
        ),
      ),
    manifestText,
  };
}

function getScriptKind(ts, extension) {
  switch (extension) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    case ".json":
      return ts.ScriptKind.JSON;
    default:
      return ts.ScriptKind.TS;
  }
}

function loadTypeScript(rootDir) {
  const packageJsonPath = path.join(
    rootDir,
    "package.json",
  );

  const candidateRequires = [];

  if (
    fs.existsSync(
      packageJsonPath,
    )
  ) {
    candidateRequires.push(
      createRequire(
        packageJsonPath,
      ),
    );
  }

  candidateRequires.push(
    createRequire(
      import.meta.url,
    ),
  );

  for (
    const requireFn of
      candidateRequires
  ) {
    try {
      return requireFn(
        "typescript",
      );
    } catch {
      // Tenta a próxima origem.
    }
  }

  fail(
    [
      "Não foi possível carregar o pacote 'typescript'.",
      "A Etapa 3 usa o TypeScript Compiler API para inventariar imports sem regex cega.",
      "Execute npm install antes de rodar a Etapa 3.",
    ].join("\n"),
  );
}

function loadTsConfig(
  ts,
  rootDir,
) {
  const configPath = path.join(
    rootDir,
    "tsconfig.json",
  );

  if (
    !fs.existsSync(
      configPath,
    )
  ) {
    return {
      configPath: null,
      compilerOptions: {},
      diagnostics: [
        "tsconfig.json não encontrado.",
      ],
    };
  }

  const readResult =
    ts.readConfigFile(
      configPath,
      ts.sys.readFile,
    );

  const diagnostics = [];

  if (
    readResult.error
  ) {
    diagnostics.push(
      ts.flattenDiagnosticMessageText(
        readResult.error.messageText,
        "\n",
      ),
    );
  }

  const parsed =
    ts.parseJsonConfigFileContent(
      readResult.config ?? {},
      ts.sys,
      rootDir,
      undefined,
      configPath,
    );

  for (
    const diagnostic of
      parsed.errors ?? []
  ) {
    diagnostics.push(
      ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        "\n",
      ),
    );
  }

  return {
    configPath:
      "tsconfig.json",
    compilerOptions:
      parsed.options ?? {},
    diagnostics,
  };
}

function lineNumberAt(
  sourceFile,
  position,
) {
  return (
    sourceFile.getLineAndCharacterOfPosition(
      position,
    ).line + 1
  );
}

function classifySpecifier(
  specifier,
) {
  if (
    specifier.startsWith(".")
  ) {
    return "relative";
  }

  if (
    specifier.startsWith("/")
  ) {
    return "absolute";
  }

  if (
    specifier.startsWith("@") ||
    specifier.startsWith("#")
  ) {
    return "bare-or-alias";
  }

  return "bare";
}

function getPackageName(
  specifier,
) {
  if (
    specifier.startsWith("@")
  ) {
    return specifier
      .split("/")
      .slice(0, 2)
      .join("/");
  }

  return specifier.split("/")[0];
}

function resolveWithTypeScript(
  ts,
  rootDir,
  sourceAbsolutePath,
  specifier,
  compilerOptions,
) {
  const result =
    ts.resolveModuleName(
      specifier,
      sourceAbsolutePath,
      compilerOptions,
      ts.sys,
    );

  const resolved =
    result.resolvedModule;

  if (!resolved) {
    return {
      resolved: false,
      targetPath: null,
      targetArea: null,
      targetModule: null,
      externalPackage:
        specifier.startsWith(".")
          ? null
          : getPackageName(
              specifier,
            ),
    };
  }

  const resolvedFileName =
    path.resolve(
      resolved.resolvedFileName,
    );

  if (
    isWithinRoot(
      rootDir,
      resolvedFileName,
    ) &&
    !normalizeAbsolute(
      resolvedFileName,
    ).includes(
      `${path.sep}node_modules${path.sep}`,
    )
  ) {
    const targetPath =
      toPosixRelative(
        rootDir,
        resolvedFileName,
      );
    const targetClass =
      classifyPath(
        targetPath,
      );

    return {
      resolved: true,
      targetPath,
      targetArea:
        targetClass.area,
      targetModule:
        targetClass.module,
      externalPackage: null,
    };
  }

  return {
    resolved: true,
    targetPath: null,
    targetArea: "external",
    targetModule: null,
    externalPackage:
      getPackageName(
        specifier,
      ),
  };
}

function resolveUrlReference(
  rootDir,
  sourceAbsolutePath,
  specifier,
) {
  if (
    !specifier.startsWith(".")
  ) {
    return {
      resolved: false,
      targetPath: null,
      targetArea: null,
      targetModule: null,
      externalPackage: null,
    };
  }

  const base = path.resolve(
    path.dirname(
      sourceAbsolutePath,
    ),
    specifier,
  );

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.json`,
  ];

  for (
    const candidate of
      candidates
  ) {
    if (
      fs.existsSync(
        candidate,
      ) &&
      fs.statSync(
        candidate,
      ).isFile()
    ) {
      const targetPath =
        toPosixRelative(
          rootDir,
          candidate,
        );
      const targetClass =
        classifyPath(
          targetPath,
        );

      return {
        resolved: true,
        targetPath,
        targetArea:
          targetClass.area,
        targetModule:
          targetClass.module,
        externalPackage: null,
      };
    }
  }

  return {
    resolved: false,
    targetPath: null,
    targetArea: null,
    targetModule: null,
    externalPackage: null,
  };
}

function isImportMetaUrl(
  ts,
  node,
) {
  return (
    ts.isPropertyAccessExpression(
      node,
    ) &&
    node.name.text === "url" &&
    ts.isMetaProperty(
      node.expression,
    ) &&
    node.expression.keywordToken ===
      ts.SyntaxKind.ImportKeyword &&
    node.expression.name.text ===
      "meta"
  );
}

function scanImports(
  ts,
  rootDir,
  tree,
  compilerOptions,
) {
  const edges = [];
  const parseErrors = [];

  const sourceFiles =
    tree.files.filter(
      (record) =>
        SOURCE_EXTENSIONS.has(
          record.extension,
        ) &&
        record.isText,
    );

  for (
    const record of
      sourceFiles
  ) {
    const absolutePath =
      path.join(
        rootDir,
        ...record.path.split("/"),
      );
    const content =
      fs.readFileSync(
        absolutePath,
        "utf8",
      );

    let sourceFile;

    try {
      sourceFile =
        ts.createSourceFile(
          absolutePath,
          content,
          ts.ScriptTarget.Latest,
          true,
          getScriptKind(
            ts,
            record.extension,
          ),
        );
    } catch (error) {
      parseErrors.push({
        path: record.path,
        line: null,
        message:
          error instanceof Error
            ? error.message
            : String(error),
      });
      continue;
    }

    for (
      const diagnostic of
        sourceFile.parseDiagnostics ?? []
    ) {
      const start =
        typeof diagnostic.start === "number"
          ? diagnostic.start
          : 0;

      parseErrors.push({
        path: record.path,
        line:
          lineNumberAt(
            sourceFile,
            start,
          ),
        message:
          ts.flattenDiagnosticMessageText(
            diagnostic.messageText,
            "\n",
          ),
      });
    }

    const sourceClass =
      classifyPath(
        record.path,
      );

    const addEdge = (
      kind,
      specifier,
      node,
      isTypeOnly = false,
      resolver = "typescript",
    ) => {
      const resolution =
        resolver === "url"
          ? resolveUrlReference(
              rootDir,
              absolutePath,
              specifier,
            )
          : resolveWithTypeScript(
              ts,
              rootDir,
              absolutePath,
              specifier,
              compilerOptions,
            );

      edges.push({
        sourcePath:
          record.path,
        sourceArea:
          sourceClass.area,
        sourceModule:
          sourceClass.module,
        line:
          lineNumberAt(
            sourceFile,
            node.getStart(
              sourceFile,
            ),
          ),
        kind,
        isTypeOnly,
        specifier,
        specifierKind:
          classifySpecifier(
            specifier,
          ),
        ...resolution,
      });
    };

    const visit = (node) => {
      if (
        ts.isImportDeclaration(
          node,
        ) &&
        ts.isStringLiteralLike(
          node.moduleSpecifier,
        )
      ) {
        addEdge(
          "import",
          node.moduleSpecifier.text,
          node,
          Boolean(
            node.importClause
              ?.isTypeOnly,
          ),
        );
      } else if (
        ts.isExportDeclaration(
          node,
        ) &&
        node.moduleSpecifier &&
        ts.isStringLiteralLike(
          node.moduleSpecifier,
        )
      ) {
        addEdge(
          "export-from",
          node.moduleSpecifier.text,
          node,
          Boolean(
            node.isTypeOnly,
          ),
        );
      } else if (
        ts.isImportEqualsDeclaration(
          node,
        ) &&
        ts.isExternalModuleReference(
          node.moduleReference,
        ) &&
        node.moduleReference.expression &&
        ts.isStringLiteralLike(
          node.moduleReference.expression,
        )
      ) {
        addEdge(
          "import-equals",
          node.moduleReference.expression.text,
          node,
          Boolean(
            node.isTypeOnly,
          ),
        );
      } else if (
        ts.isCallExpression(
          node,
        ) &&
        node.arguments.length >= 1 &&
        ts.isStringLiteralLike(
          node.arguments[0],
        )
      ) {
        if (
          node.expression.kind ===
            ts.SyntaxKind.ImportKeyword
        ) {
          addEdge(
            "dynamic-import",
            node.arguments[0].text,
            node,
          );
        } else if (
          ts.isIdentifier(
            node.expression,
          ) &&
          node.expression.text ===
            "require"
        ) {
          addEdge(
            "require",
            node.arguments[0].text,
            node,
          );
        }
      } else if (
        ts.isNewExpression(
          node,
        ) &&
        ts.isIdentifier(
          node.expression,
        ) &&
        node.expression.text ===
          "URL" &&
        node.arguments &&
        node.arguments.length >= 2 &&
        ts.isStringLiteralLike(
          node.arguments[0],
        ) &&
        isImportMetaUrl(
          ts,
          node.arguments[1],
        )
      ) {
        addEdge(
          "url-reference",
          node.arguments[0].text,
          node,
          false,
          "url",
        );
      }

      ts.forEachChild(
        node,
        visit,
      );
    };

    visit(sourceFile);

    for (
      const referenced of
        sourceFile.referencedFiles
    ) {
      addEdge(
        "triple-slash-reference",
        referenced.fileName,
        sourceFile,
      );
    }
  }

  edges.sort((a, b) => {
    const pathCompare =
      a.sourcePath.localeCompare(
        b.sourcePath,
        "en",
      );

    if (pathCompare !== 0) {
      return pathCompare;
    }

    if (a.line !== b.line) {
      return a.line - b.line;
    }

    return a.kind.localeCompare(
      b.kind,
      "en",
    );
  });

  return {
    edges,
    parseErrors,
  };
}

function makeLineStarts(text) {
  const starts = [0];

  for (
    let index = 0;
    index < text.length;
    index += 1
  ) {
    if (
      text.charCodeAt(index) === 10
    ) {
      starts.push(index + 1);
    }
  }

  return starts;
}

function findLineNumber(
  lineStarts,
  position,
) {
  let low = 0;
  let high =
    lineStarts.length - 1;

  while (low <= high) {
    const mid =
      Math.floor(
        (low + high) / 2,
      );

    if (
      lineStarts[mid] <=
      position
    ) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return high + 1;
}

function scanTextualPathReferences(
  rootDir,
  tree,
) {
  const references = [];
  const regex =
    /\b(?:src|src-tauri|tests|scripts)\/[A-Za-z0-9_@./-]+/gu;

  for (
    const record of
      tree.files
  ) {
    if (
      !record.isText
    ) {
      continue;
    }

    const absolutePath =
      path.join(
        rootDir,
        ...record.path.split("/"),
      );

    const content =
      fs.readFileSync(
        absolutePath,
        "utf8",
      );

    const lineStarts =
      makeLineStarts(
        content,
      );

    const seen =
      new Set();

    for (
      const match of
        content.matchAll(regex)
    ) {
      let referencedPath =
        match[0];

      while (
        referencedPath.endsWith(
          ".",
        )
      ) {
        referencedPath =
          referencedPath.slice(
            0,
            -1,
          );
      }

      if (
        referencedPath.length ===
        0
      ) {
        continue;
      }

      const line =
        findLineNumber(
          lineStarts,
          match.index ?? 0,
        );

      const dedupeKey =
        `${line}\u0000${referencedPath}`;

      if (
        seen.has(
          dedupeKey,
        )
      ) {
        continue;
      }

      seen.add(
        dedupeKey,
      );

      const absoluteTarget =
        path.join(
          rootDir,
          ...referencedPath.split(
            "/",
          ),
        );

      references.push({
        sourcePath:
          record.path,
        sourceArea:
          record.area,
        line,
        referencedPath,
        exists:
          fs.existsSync(
            absoluteTarget,
          ),
        targetKind:
          fs.existsSync(
            absoluteTarget,
          )
            ? (
                fs.statSync(
                  absoluteTarget,
                ).isDirectory()
                  ? "directory"
                  : "file"
              )
            : "missing",
      });
    }
  }

  references.sort((a, b) => {
    const compare =
      a.sourcePath.localeCompare(
        b.sourcePath,
        "en",
      );

    if (compare !== 0) {
      return compare;
    }

    if (a.line !== b.line) {
      return a.line - b.line;
    }

    return a.referencedPath.localeCompare(
      b.referencedPath,
      "en",
    );
  });

  return references;
}

function listImmediateDirectories(
  rootDir,
  relativeRoot,
) {
  const absoluteRoot =
    path.join(
      rootDir,
      ...relativeRoot.split("/"),
    );

  if (
    !fs.existsSync(
      absoluteRoot,
    )
  ) {
    return [];
  }

  return fs
    .readdirSync(
      absoluteRoot,
      {
        withFileTypes: true,
      },
    )
    .filter(
      (entry) =>
        entry.isDirectory(),
    )
    .map(
      (entry) =>
        entry.name,
    )
    .sort(
      (a, b) =>
        a.localeCompare(
          b,
          "en",
        ),
    );
}

function listImmediateFiles(
  rootDir,
  relativeRoot,
) {
  const absoluteRoot =
    path.join(
      rootDir,
      ...relativeRoot.split("/"),
    );

  if (
    !fs.existsSync(
      absoluteRoot,
    )
  ) {
    return [];
  }

  return fs
    .readdirSync(
      absoluteRoot,
      {
        withFileTypes: true,
      },
    )
    .filter(
      (entry) =>
        entry.isFile(),
    )
    .map(
      (entry) =>
        entry.name,
    )
    .sort(
      (a, b) =>
        a.localeCompare(
          b,
          "en",
        ),
    );
}

function buildEngineModuleInventory(
  rootDir,
  tree,
) {
  const moduleNames =
    listImmediateDirectories(
      rootDir,
      "src/engine",
    );

  return moduleNames.map(
    (moduleName) => {
      const prefix =
        `src/engine/${moduleName}/`;

      const files =
        tree.files.filter(
          (record) =>
            record.path.startsWith(
              prefix,
            ),
        );

      return {
        name: moduleName,
        path:
          `src/engine/${moduleName}`,
        fileCount:
          files.length,
        sourceFileCount:
          files.filter(
            (record) =>
              SOURCE_EXTENSIONS.has(
                record.extension,
              ),
          ).length,
        workerFiles:
          files
            .filter(
              (record) =>
                /\.worker\.[cm]?[jt]sx?$/u.test(
                  record.path,
                ),
            )
            .map(
              (record) =>
                record.path,
            ),
        publicDirectoryPresent:
          fs.existsSync(
            path.join(
              rootDir,
              "src",
              "engine",
              moduleName,
              "public",
            ),
          ),
        internalDirectoryPresent:
          fs.existsSync(
            path.join(
              rootDir,
              "src",
              "engine",
              moduleName,
              "internal",
            ),
          ),
      };
    },
  );
}

function buildConceptualInventory(
  rootDir,
) {
  return CONCEPTUAL_DIRECTORIES.map(
    (item) => {
      const absolutePath =
        path.join(
          rootDir,
          ...item.path.split("/"),
        );

      const exists =
        fs.existsSync(
          absolutePath,
        );

      return {
        ...item,
        status:
          exists
            ? "present"
            : "conceptual-missing",
        kind:
          exists
            ? (
                fs.statSync(
                  absolutePath,
                ).isDirectory()
                  ? "directory"
                  : "path-collision"
              )
            : "conceptual-directory",
      };
    },
  );
}

function loadPackageInventory(
  rootDir,
) {
  const packagePath =
    path.join(
      rootDir,
      "package.json",
    );

  if (
    !fs.existsSync(
      packagePath,
    )
  ) {
    return null;
  }

  const packageJson =
    JSON.parse(
      fs.readFileSync(
        packagePath,
        "utf8",
      ),
    );

  return {
    name:
      packageJson.name ?? null,
    version:
      packageJson.version ?? null,
    type:
      packageJson.type ?? null,
    scripts:
      packageJson.scripts ?? {},
    dependencies:
      packageJson.dependencies ?? {},
    devDependencies:
      packageJson.devDependencies ?? {},
  };
}

function buildArchitectureSignals(
  imports,
) {
  const externalCoreSubpathImports = [];
  const tokenImplementationImports = [];
  const crossEngineImports = [];
  const pluginCrossEngineImports = [];
  const pluginOwnEngineImports = [];

  for (
    const edge of
      imports
  ) {
    if (
      edge.targetPath === null
    ) {
      continue;
    }

    if (
      edge.sourceArea !== "core" &&
      edge.targetPath.startsWith(
        "src/core/",
      ) &&
      edge.targetPath !==
        "src/core/index.ts"
    ) {
      externalCoreSubpathImports.push(
        edge,
      );
    }

    if (
      edge.sourceArea === "tokens" &&
      edge.targetArea === "engine"
    ) {
      tokenImplementationImports.push(
        edge,
      );
    }

    if (
      edge.sourceArea === "engine" &&
      edge.targetArea === "engine" &&
      edge.sourceModule !== null &&
      edge.targetModule !== null &&
      edge.sourceModule !==
        edge.targetModule
    ) {
      crossEngineImports.push(
        edge,
      );
    }

    if (
      edge.sourceArea === "plugins" &&
      edge.targetArea === "engine" &&
      edge.sourceModule !== null &&
      edge.targetModule !== null
    ) {
      if (
        edge.sourceModule ===
        edge.targetModule
      ) {
        pluginOwnEngineImports.push(
          edge,
        );
      } else {
        pluginCrossEngineImports.push(
          edge,
        );
      }
    }
  }

  return {
    externalCoreSubpathImports,
    tokenImplementationImports,
    crossEngineImports,
    pluginCrossEngineImports,
    pluginOwnEngineImports,
  };
}

function countBy(
  items,
  keySelector,
) {
  const counts =
    new Map();

  for (
    const item of
      items
  ) {
    const key =
      keySelector(item);

    counts.set(
      key,
      (counts.get(key) ?? 0) + 1,
    );
  }

  return Object.fromEntries(
    [...counts.entries()].sort(
      ([a], [b]) =>
        String(a).localeCompare(
          String(b),
          "en",
        ),
    ),
  );
}

function buildSummaryText(
  inventory,
) {
  const lines = [
    "============================================================",
    "  PROJETO1 — ETAPA 3: INVENTÁRIO ARQUITETURAL AUTOMÁTICO",
    "============================================================",
    "",
    `Run ID: ${inventory.runId}`,
    `Raiz: ${inventory.projectRoot}`,
    `Branch: ${inventory.repository.branch ?? "(sem branch nomeada)"}`,
    `HEAD: ${inventory.repository.head ?? "(sem commit)"}`,
    `Etapa 1: ${inventory.preconditions.stage1.runId} (${inventory.preconditions.stage1.status})`,
    `Etapa 2: ${inventory.preconditions.stage2.runId} (${inventory.preconditions.stage2.status})`,
    `Freeze desbloqueado: ${inventory.preconditions.freezeUnlocked ? "SIM" : "NÃO"}`,
    "",
    "Árvore real inventariada:",
    `  Arquivos: ${inventory.summary.fileCount}`,
    `  Diretórios: ${inventory.summary.directoryCount}`,
    `  Bytes: ${inventory.summary.totalBytes}`,
    `  Symlinks: ${inventory.summary.symlinkCount}`,
    `  Tree SHA-256: ${inventory.summary.treeSha256}`,
    "",
    "Áreas:",
  ];

  for (
    const [area, count] of
      Object.entries(
        inventory.summary.filesByArea,
      )
  ) {
    lines.push(
      `  ${area}: ${count}`,
    );
  }

  lines.push("");
  lines.push(
    `Módulos reais em src/engine: ${inventory.engineModules.length}`,
  );

  for (
    const moduleRecord of
      inventory.engineModules
  ) {
    lines.push(
      `  - ${moduleRecord.name}: ${moduleRecord.fileCount} arquivo(s), public=${moduleRecord.publicDirectoryPresent ? "sim" : "não"}, internal=${moduleRecord.internalDirectoryPresent ? "sim" : "não"}`,
    );
  }

  lines.push("");
  lines.push(
    `Plugins encontrados: ${inventory.plugins.length}`,
  );
  lines.push(
    `Tokens encontrados: ${inventory.tokens.length}`,
  );
  lines.push(
    `Áreas de contracts encontradas: ${inventory.contractAreas.length}`,
  );
  lines.push(
    `Arquivos Rust: ${inventory.rustTauri.rustFiles.length}`,
  );
  lines.push(
    `Workers: ${inventory.workers.length}`,
  );
  lines.push(
    `Testes *.test.*: ${inventory.tests.testFiles.length}`,
  );
  lines.push(
    `Smoke tests *.mjs: ${inventory.tests.smokeFiles.length}`,
  );

  lines.push("");
  lines.push("Grafo de imports/reexports:");
  lines.push(
    `  Referências AST: ${inventory.dependencyOverview.totalEdges}`,
  );
  lines.push(
    `  Resolvidas para o projeto: ${inventory.dependencyOverview.resolvedProjectEdges}`,
  );
  lines.push(
    `  Externas: ${inventory.dependencyOverview.externalEdges}`,
  );
  lines.push(
    `  Não resolvidas: ${inventory.dependencyOverview.unresolvedEdges}`,
  );
  lines.push(
    `  Pacotes externos únicos: ${inventory.dependencyOverview.externalPackages.length}`,
  );

  lines.push("");
  lines.push("Sinais arquiteturais inventariados (não corrigidos nesta etapa):");
  lines.push(
    `  Imports externos para subpaths de Core: ${inventory.signalsSummary.externalCoreSubpathImports}`,
  );
  lines.push(
    `  Tokens importando implementação de engine: ${inventory.signalsSummary.tokenImplementationImports}`,
  );
  lines.push(
    `  Imports engine -> outro módulo engine: ${inventory.signalsSummary.crossEngineImports}`,
  );
  lines.push(
    `  Plugins importando engine de outro módulo: ${inventory.signalsSummary.pluginCrossEngineImports}`,
  );
  lines.push(
    `  Plugins importando engine do próprio módulo: ${inventory.signalsSummary.pluginOwnEngineImports}`,
  );

  lines.push("");
  lines.push("Diretórios conceituais:");
  for (
    const item of
      inventory.conceptualDirectories
  ) {
    lines.push(
      `  - ${item.path}: ${item.status}`,
    );
  }

  lines.push("");
  lines.push(
    `Referências textuais a paths: ${inventory.textualReferenceCount}`,
  );
  lines.push(
    `Erros de parsing AST: ${inventory.parseErrorCount}`,
  );
  lines.push("");
  lines.push(
    "Esta etapa é somente inventário. Nenhum arquivo de src/, src-tauri/, tests/,",
  );
  lines.push(
    "package.json, tsconfig.json ou configuração da engine é modificado.",
  );
  lines.push("");

  return lines.join("\n");
}

function writeArtifactChecksums(
  auditDir,
) {
  const files =
    fs.readdirSync(
      auditDir,
      {
        withFileTypes: true,
      },
    )
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name !==
          "artifact-checksums.sha256",
    )
    .map(
      (entry) =>
        entry.name,
    )
    .sort(
      (a, b) =>
        a.localeCompare(
          b,
          "en",
        ),
    );

  const lines =
    files.map(
      (fileName) =>
        `${sha256File(path.join(auditDir, fileName))}  ${fileName}`,
    );

  writeText(
    path.join(
      auditDir,
      "artifact-checksums.sha256",
    ),
    `${lines.join("\n")}\n`,
  );
}

function main() {
  let auditDir = null;

  try {
    const rootDir =
      assertRepositoryRoot(
        process.cwd(),
      );

    const preconditions =
      assertStagePreconditions(
        rootDir,
      );

    const repository =
      getRepositoryMetadata(
        rootDir,
      );

    const ts =
      loadTypeScript(
        rootDir,
      );

    const tsConfig =
      loadTsConfig(
        ts,
        rootDir,
      );

    console.log("============================================================");
    console.log("  PROJETO1 — ETAPA 3: INVENTÁRIO ARQUITETURAL AUTOMÁTICO   ");
    console.log("============================================================\n");
    console.log(
      `[OK] Raiz Git: ${rootDir}`,
    );
    console.log(
      `[OK] Etapa 1: ${preconditions.stage1.runId} (${preconditions.stage1.status})`,
    );
    console.log(
      `[OK] Etapa 2: ${preconditions.stage2.runId} (${preconditions.stage2.status})`,
    );
    console.log(
      "[OK] Freeze está desbloqueado.",
    );
    console.log(
      `[INFO] TypeScript Compiler API: ${String(ts.version)}`,
    );

    console.log("");
    console.log(
      "[1/5] Inventariando arquivos, diretórios, hashes e symlinks...",
    );

    const treeBefore =
      collectProjectTree(
        rootDir,
      );

    console.log(
      `[OK] ${treeBefore.files.length} arquivos | ${treeBefore.directories.length} diretórios | Tree ${treeBefore.treeSha256}`,
    );

    console.log("");
    console.log(
      "[2/5] Extraindo imports, reexports, dynamic imports, require e URL(import.meta.url)...",
    );

    const importScan =
      scanImports(
        ts,
        rootDir,
        treeBefore,
        tsConfig.compilerOptions,
      );

    console.log(
      `[OK] ${importScan.edges.length} referências AST | ${importScan.parseErrors.length} erro(s) de parsing`,
    );

    console.log("");
    console.log(
      "[3/5] Inventariando referências textuais a paths operacionais...",
    );

    const textualReferences =
      scanTextualPathReferences(
        rootDir,
        treeBefore,
      );

    console.log(
      `[OK] ${textualReferences.length} referências textuais`,
    );

    console.log("");
    console.log(
      "[4/5] Classificando módulos, plugins, contracts, tokens, workers, testes e sinais arquiteturais...",
    );

    const engineModules =
      buildEngineModuleInventory(
        rootDir,
        treeBefore,
      );

    const plugins =
      listImmediateDirectories(
        rootDir,
        "src/plugins",
      );

    const tokenFiles =
      listImmediateFiles(
        rootDir,
        "src/tokens",
      );

    const tokens =
      tokenFiles
        .filter(
          (fileName) =>
            SOURCE_EXTENSIONS.has(
              path.posix.extname(
                fileName,
              ),
            ),
        )
        .map(
          (fileName) =>
            path.posix.basename(
              fileName,
              path.posix.extname(
                fileName,
              ),
            ),
        );

    const contractAreas =
      [
        ...new Set(
          treeBefore.files
            .filter(
              (record) =>
                record.area ===
                  "contracts",
            )
            .map(
              (record) =>
                record.module,
            )
            .filter(
              (value) =>
                value !== null,
            ),
        ),
      ].sort(
        (a, b) =>
          a.localeCompare(
            b,
            "en",
          ),
      );

    const rustFiles =
      treeBefore.files
        .filter(
          (record) =>
            record.path.startsWith(
              "src-tauri/",
            ) &&
            record.extension ===
              ".rs",
        )
        .map(
          (record) =>
            record.path,
        );

    const tauriConfigFiles =
      treeBefore.files
        .filter(
          (record) =>
            record.path ===
              "src-tauri/Cargo.toml" ||
            record.path ===
              "src-tauri/Cargo.lock" ||
            record.path ===
              "src-tauri/tauri.conf.json" ||
            record.path.startsWith(
              "src-tauri/capabilities/",
            ),
        )
        .map(
          (record) =>
            record.path,
        );

    const workers =
      treeBefore.files
        .filter(
          (record) =>
            /\.worker\.[cm]?[jt]sx?$/u.test(
              record.path,
            ),
        )
        .map(
          (record) =>
            record.path,
        );

    const testFiles =
      treeBefore.files
        .filter(
          (record) =>
            /(?:^|\/)[^/]+\.test\.[cm]?[jt]sx?$/u.test(
              record.path,
            ),
        )
        .map(
          (record) =>
            record.path,
        );

    const smokeFiles =
      treeBefore.files
        .filter(
          (record) =>
            record.path.startsWith(
              "tests/",
            ) &&
            /smoke.*\.mjs$/iu.test(
              path.posix.basename(
                record.path,
              ),
            ),
        )
        .map(
          (record) =>
            record.path,
        );

    const conceptualDirectories =
      buildConceptualInventory(
        rootDir,
      );

    const signals =
      buildArchitectureSignals(
        importScan.edges,
      );

    const externalPackages =
      [
        ...new Set(
          importScan.edges
            .map(
              (edge) =>
                edge.externalPackage,
            )
            .filter(
              (value) =>
                value !== null,
            ),
        ),
      ].sort(
        (a, b) =>
          a.localeCompare(
            b,
            "en",
          ),
      );

    const totalBytes =
      treeBefore.files.reduce(
        (sum, record) =>
          sum + record.bytes,
        0,
      );

    const inventory = {
      schemaVersion:
        SCHEMA_VERSION,
      stage:
        STAGE_NAME,
      runId:
        makeRunId(
          new Date(),
        ),
      generatedAtUtc:
        new Date().toISOString(),
      projectRoot:
        rootDir,
      repository: {
        branch:
          repository.branch,
        head:
          repository.head,
        hasCommits:
          repository.hasCommits,
        gitVersion:
          repository.gitVersion,
      },
      runtime: {
        nodeVersion:
          process.version,
        platform:
          process.platform,
        arch:
          process.arch,
        typescriptVersion:
          String(
            ts.version,
          ),
      },
      preconditions,
      scanPolicy: {
        followsSymlinks:
          false,
        excludedTopLevelDirectories:
          [
            ...EXCLUDED_TOP_LEVEL_DIRECTORIES,
          ].sort(),
        excludedRelativePrefixes:
          [
            ...EXCLUDED_RELATIVE_PREFIXES,
          ].sort(),
        sourceExtensions:
          [
            ...SOURCE_EXTENSIONS,
          ].sort(),
      },
      summary: {
        fileCount:
          treeBefore.files.length,
        directoryCount:
          treeBefore.directories.length,
        symlinkCount:
          treeBefore.symlinks.length,
        totalBytes,
        treeSha256:
          treeBefore.treeSha256,
        filesByArea:
          countBy(
            treeBefore.files,
            (record) =>
              record.area,
          ),
        filesByExtension:
          countBy(
            treeBefore.files,
            (record) =>
              record.extension ||
              "(sem extensão)",
          ),
      },
      package:
        loadPackageInventory(
          rootDir,
        ),
      tsconfig: {
        path:
          tsConfig.configPath,
        diagnostics:
          tsConfig.diagnostics,
      },
      engineModules,
      plugins,
      tokens,
      contractAreas,
      rustTauri: {
        rustFiles,
        configFiles:
          tauriConfigFiles,
      },
      workers,
      tests: {
        testFiles,
        smokeFiles,
      },
      conceptualDirectories,
      dependencyOverview: {
        totalEdges:
          importScan.edges.length,
        edgesByKind:
          countBy(
            importScan.edges,
            (edge) =>
              edge.kind,
          ),
        edgesBySpecifierKind:
          countBy(
            importScan.edges,
            (edge) =>
              edge.specifierKind,
          ),
        resolvedProjectEdges:
          importScan.edges.filter(
            (edge) =>
              edge.resolved &&
              edge.targetPath !==
                null,
          ).length,
        externalEdges:
          importScan.edges.filter(
            (edge) =>
              edge.resolved &&
              edge.targetArea ===
                "external",
          ).length,
        unresolvedEdges:
          importScan.edges.filter(
            (edge) =>
              !edge.resolved,
          ).length,
        externalPackages,
      },
      signalsSummary: {
        externalCoreSubpathImports:
          signals
            .externalCoreSubpathImports
            .length,
        tokenImplementationImports:
          signals
            .tokenImplementationImports
            .length,
        crossEngineImports:
          signals
            .crossEngineImports
            .length,
        pluginCrossEngineImports:
          signals
            .pluginCrossEngineImports
            .length,
        pluginOwnEngineImports:
          signals
            .pluginOwnEngineImports
            .length,
      },
      textualReferenceCount:
        textualReferences.length,
      parseErrorCount:
        importScan.parseErrors.length,
      artifacts: {
        files:
          "files.json",
        directories:
          "directories.json",
        symlinks:
          "symlinks.json",
        imports:
          "imports.json",
        parseErrors:
          "parse-errors.json",
        textualPathReferences:
          "textual-path-references.json",
        architectureSignals:
          "architecture-signals.json",
        summary:
          "architecture-summary.txt",
        gitStatus:
          "git-status.txt",
        checksums:
          "artifact-checksums.sha256",
      },
      notes: [
        "Esta etapa é somente leitura do projeto, exceto pela gravação de relatórios em .migration/stage3/.",
        "Nenhum arquivo de código é movido, renomeado ou reescrito nesta etapa.",
        "Os diretórios conceituais são apenas reportados como present/conceptual-missing; eles não são criados aqui.",
        "Os sinais arquiteturais são inventário para etapas posteriores e não são tratados como falhas nesta etapa.",
      ],
    };

    const runId =
      inventory.runId;

    auditDir = path.join(
      rootDir,
      OUTPUT_ROOT_RELATIVE_PATH,
      runId,
    );

    ensureDirectory(
      auditDir,
    );

    console.log("");
    console.log(
      "[5/5] Gravando o inventário em .migration/stage3 e verificando que a árvore do projeto não foi alterada...",
    );

    writeJson(
      path.join(
        auditDir,
        "files.json",
      ),
      treeBefore.files,
    );

    writeJson(
      path.join(
        auditDir,
        "directories.json",
      ),
      treeBefore.directories,
    );

    writeJson(
      path.join(
        auditDir,
        "symlinks.json",
      ),
      treeBefore.symlinks,
    );

    writeJson(
      path.join(
        auditDir,
        "imports.json",
      ),
      importScan.edges,
    );

    writeJson(
      path.join(
        auditDir,
        "parse-errors.json",
      ),
      importScan.parseErrors,
    );

    writeJson(
      path.join(
        auditDir,
        "textual-path-references.json",
      ),
      textualReferences,
    );

    writeJson(
      path.join(
        auditDir,
        "architecture-signals.json",
      ),
      signals,
    );

    writeText(
      path.join(
        auditDir,
        "git-status.txt",
      ),
      `${repository.status}\n`,
    );

    writeJson(
      path.join(
        auditDir,
        "architecture-inventory.json",
      ),
      inventory,
    );

    writeText(
      path.join(
        auditDir,
        "architecture-summary.txt",
      ),
      `${buildSummaryText(inventory)}\n`,
    );

    writeArtifactChecksums(
      auditDir,
    );

    const treeAfter =
      collectProjectTree(
        rootDir,
      );

    if (
      treeAfter.treeSha256 !==
      treeBefore.treeSha256
    ) {
      writeJson(
        path.join(
          auditDir,
          "TREE_MUTATION_DETECTED.json",
        ),
        {
          before:
            treeBefore.treeSha256,
          after:
            treeAfter.treeSha256,
        },
      );

      fail(
        [
          "A árvore do projeto mudou durante a execução da Etapa 3.",
          `Antes: ${treeBefore.treeSha256}`,
          `Depois: ${treeAfter.treeSha256}`,
          "Os relatórios em .migration/ são excluídos desse hash.",
        ].join("\n"),
      );
    }

    const outputRoot =
      path.join(
        rootDir,
        OUTPUT_ROOT_RELATIVE_PATH,
      );

    writeText(
      path.join(
        outputRoot,
        "LATEST",
      ),
      `${runId}\n`,
    );

    console.log(
      `[OK] Tree SHA-256 permaneceu ${treeAfter.treeSha256}`,
    );
    console.log("");
    console.log("============================================================");
    console.log("  ETAPA 3 CONCLUÍDA COM SUCESSO                             ");
    console.log("============================================================");
    console.log(
      `Arquivos: ${inventory.summary.fileCount}`,
    );
    console.log(
      `Diretórios: ${inventory.summary.directoryCount}`,
    );
    console.log(
      `Módulos engine: ${inventory.engineModules.length}`,
    );
    console.log(
      `Plugins: ${inventory.plugins.length}`,
    );
    console.log(
      `Imports/reexports: ${inventory.dependencyOverview.totalEdges}`,
    );
    console.log(
      `Referências textuais: ${inventory.textualReferenceCount}`,
    );
    console.log(
      `Relatório: ${toPosixRelative(rootDir, path.join(auditDir, "architecture-inventory.json"))}`,
    );
    console.log(
      `Resumo: ${toPosixRelative(rootDir, path.join(auditDir, "architecture-summary.txt"))}`,
    );
    console.log("");
    console.log(
      "Nenhum arquivo do projeto foi movido ou reescrito.",
    );

    process.exitCode = 0;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.stack || error.message
        : String(error);

    console.error("");
    console.error(
      "[ERRO] Etapa 3 não concluída.",
    );
    console.error(
      message,
    );

    if (
      auditDir !== null &&
      fs.existsSync(
        auditDir,
      )
    ) {
      try {
        writeText(
          path.join(
            auditDir,
            "STAGE3_ERROR.txt",
          ),
          `${message}\n`,
        );
      } catch {
        // Não mascara o erro original.
      }
    }

    process.exitCode = 1;
  }
}

main();
