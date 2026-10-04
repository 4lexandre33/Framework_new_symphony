#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  ARCHITECTURE_MIGRATION_VERSION,
} from "./module-map.mjs";

export const STAGE_NAME = "stage-17-fix-api-implementation-leaks";

const ARCH_VERSION = "v20";
const V20_JOURNAL = ".migration/v20-journal.json";
const STAGE14_JOURNAL = ".migration/stage14/facade-journal.json";
const STAGE15_JOURNAL = ".migration/stage15/core-alias-journal.json";
const STAGE16_JOURNAL = ".migration/stage16/core-api-journal.json";
const STAGE17_JOURNAL = ".migration/stage17/api-leak-journal.json";
const STAGE17_BACKUPS = ".migration/stage17/backups";

const CONTRACT_PATH = "src/contracts/net/types.ts";
const TOKEN_PATH = "src/tokens/net.ts";
const REPLICATOR_PATH = "src/engine/net/internal/StateReplicator.ts";
const SERVICE_PATH = "src/engine/net/internal/NetworkService.ts";
const PUBLIC_FACADE_PATH = "src/engine/net/public/index.ts";

const EXPECTED_STAGE_COUNTS = new Map([
  [10, 93],
  [12, 21],
  [13, 108],
  [14, 23],
  [15, 2],
]);

const EXPECTED_STAGE17_FILES = Object.freeze([
  CONTRACT_PATH,
  TOKEN_PATH,
  REPLICATOR_PATH,
  SERVICE_PATH,
]);

const EXPECTED_PUBLIC_METHODS = Object.freeze([
  "registerEntity",
  "unregisterEntity",
  "pushEntitySnapshot",
  "processWorldSnapshot",
  "getInterpolatedState",
  "generateWorldSnapshot",
  "clear",
]);

const SCAN_EXCLUDED_TOP_LEVEL = new Set([
  ".git",
  ".migration",
  "node_modules",
  "dist",
  "coverage",
  "target",
]);

const SCAN_EXCLUDED_PREFIXES = Object.freeze([
  ".cache/",
  ".turbo/",
  ".vite/",
  "src-tauri/target/",
]);

function fail(message) {
  throw new Error(message);
}

function normalizeAbsolute(inputPath) {
  const normalized = path.normalize(path.resolve(inputPath));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function toRelative(rootDir, absolutePath) {
  return toPosix(path.relative(rootDir, absolutePath));
}

function assertSafeRelative(relativePath, label = "Path") {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    relativePath.includes("\\")
  ) {
    fail(`${label} inválido: ${String(relativePath)}`);
  }

  const parts = relativePath.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    fail(`${label} inseguro: ${relativePath}`);
  }
}

function absoluteFromRelative(rootDir, relativePath) {
  assertSafeRelative(relativePath);
  const absolutePath = path.join(rootDir, ...relativePath.split("/"));
  const back = path.relative(rootDir, absolutePath);
  if (back.startsWith("..") || path.isAbsolute(back)) {
    fail(`Path escapou da raiz: ${relativePath}`);
  }
  return absolutePath;
}

function parseArgs(argv) {
  if (argv.length === 0) return { help: false };
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    return { help: true };
  }
  fail("Uso: node scripts/architecture/fix-api-leaks.mjs");
}

function printHelp() {
  console.log(`
Projeto1 — Etapa 17: correção de vazamentos API -> implementação

Uso:
  node scripts/architecture/fix-api-leaks.mjs

Escopo exato:
  - auditar src/tokens/** e src/contracts/**;
  - remover o vazamento NetworkApi -> StateReplicator;
  - criar StateReplicationApi em src/contracts/net/types.ts;
  - fazer StateReplicator implementar StateReplicationApi;
  - fazer NetworkApi.getStateReplicator() retornar StateReplicationApi;
  - manter src/engine/net/public/index.ts sem qualquer reexport de internal;
  - registrar backups e journal reversível da Etapa 17.

Esta etapa não implementa boundary checker, não cria novas fachadas,
não move arquivos e não executa a Etapa 16 caso ela esteja pendente.
`);
}

function assertProjectRoot(rootDir) {
  for (const relativePath of [
    "package.json",
    "scripts/architecture/module-map.mjs",
    V20_JOURNAL,
    STAGE14_JOURNAL,
    STAGE15_JOURNAL,
    ...EXPECTED_STAGE17_FILES,
    PUBLIC_FACADE_PATH,
  ]) {
    const absolutePath = absoluteFromRelative(rootDir, relativePath);
    if (!fs.existsSync(absolutePath)) {
      fail(`Pré-condição ausente: ${relativePath}`);
    }
  }
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function sha256Text(text) {
  return sha256(Buffer.from(text, "utf8"));
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort((a, b) => a.localeCompare(b, "en"))
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function semanticSha256(value) {
  return sha256Text(stableStringify(value));
}

function immutableOperationV7(operation) {
  const copy = {};
  for (const key of Object.keys(operation).sort((a, b) => a.localeCompare(b, "en"))) {
    if (key === "state" || key === "rollbackTimestampUtc") continue;
    copy[key] = operation[key];
  }
  return copy;
}

function readJson(absolutePath, label) {
  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (error) {
    fail(`JSON inválido em ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeAtomic(absolutePath, buffer) {
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const tempPath = `${absolutePath}.tmp-${String(process.pid)}`;
  fs.writeFileSync(tempPath, buffer, { flag: "w" });
  try {
    fs.renameSync(tempPath, absolutePath);
  } catch (error) {
    if (fs.existsSync(absolutePath)) {
      fs.rmSync(absolutePath, { force: true });
      fs.renameSync(tempPath, absolutePath);
    } else {
      throw error;
    }
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function writeTextAtomic(absolutePath, text) {
  writeAtomic(absolutePath, Buffer.from(text, "utf8"));
}

function writeJsonAtomic(absolutePath, value) {
  writeTextAtomic(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
}

function loadTypeScript() {
  const require = createRequire(import.meta.url);
  let ts;
  try {
    ts = require("typescript");
  } catch (error) {
    fail(`TypeScript não pôde ser carregado: ${error instanceof Error ? error.message : String(error)}`);
  }
  const major = Number.parseInt(String(ts.version).split(".")[0], 10);
  if (!Number.isFinite(major) || major < 5) {
    fail(`TypeScript 5+ é obrigatório. Detectado: ${String(ts.version)}`);
  }
  return ts;
}

function parseSource(ts, relativePath, text) {
  const sourceFile = ts.createSourceFile(
    relativePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    fail(
      `Erro de parsing em ${relativePath}: ${sourceFile.parseDiagnostics
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
        .join(" | ")}`,
    );
  }
  return sourceFile;
}

function walkCodeFiles(rootDir, relativeRoot) {
  const start = absoluteFromRelative(rootDir, relativeRoot);
  const files = [];
  const stack = [start];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(absolutePath);
      } else if (entry.isFile() && /\.(?:ts|tsx|mts|cts)$/u.test(entry.name)) {
        files.push(toRelative(rootDir, absolutePath));
      }
    }
  }
  return files.sort((a, b) => a.localeCompare(b, "en"));
}

function resolveRelativeModule(rootDir, sourcePath, specifier) {
  if (!specifier.startsWith(".")) return null;
  const baseAbsolute = path.resolve(path.dirname(absoluteFromRelative(rootDir, sourcePath)), specifier);
  const candidates = [
    baseAbsolute,
    `${baseAbsolute}.ts`,
    `${baseAbsolute}.tsx`,
    `${baseAbsolute}.mts`,
    `${baseAbsolute}.cts`,
    path.join(baseAbsolute, "index.ts"),
    path.join(baseAbsolute, "index.tsx"),
    path.join(baseAbsolute, "index.mts"),
    path.join(baseAbsolute, "index.cts"),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const stat = fs.lstatSync(candidate);
    if (!stat.isSymbolicLink() && stat.isFile()) return toRelative(rootDir, candidate);
  }
  return null;
}

function collectModuleReferences(ts, sourceFile) {
  const references = [];
  function push(kind, literal) {
    references.push({ kind, specifier: literal.text, node: literal });
  }
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      push(ts.isImportDeclaration(node) ? "import" : "export", node.moduleSpecifier);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      push("import-type", node.argument.literal);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      push(node.expression.kind === ts.SyntaxKind.ImportKeyword ? "dynamic-import" : "require", node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return references;
}

function auditApiImplementationLeaks(ts, rootDir) {
  const files = [
    ...walkCodeFiles(rootDir, "src/tokens"),
    ...walkCodeFiles(rootDir, "src/contracts"),
  ].sort((a, b) => a.localeCompare(b, "en"));

  const leaks = [];
  let referencesSeen = 0;

  for (const filePath of files) {
    const text = fs.readFileSync(absoluteFromRelative(rootDir, filePath), "utf8");
    const sourceFile = parseSource(ts, filePath, text);
    for (const reference of collectModuleReferences(ts, sourceFile)) {
      referencesSeen += 1;
      const target = resolveRelativeModule(rootDir, filePath, reference.specifier);
      if (!target) continue;
      if (target.startsWith("src/engine/") || target.startsWith("src/plugins/")) {
        leaks.push({
          sourcePath: filePath,
          kind: reference.kind,
          specifier: reference.specifier,
          targetPath: target,
        });
      }
    }
  }

  return {
    filesAudited: files.length,
    referencesSeen,
    leaks,
  };
}

function validateMigrationState(rootDir) {
  if (ARCHITECTURE_MIGRATION_VERSION !== ARCH_VERSION) {
    fail(`Arquitetura inesperada: ${String(ARCHITECTURE_MIGRATION_VERSION)}.`);
  }

  const global = readJson(absoluteFromRelative(rootDir, V20_JOURNAL), V20_JOURNAL);
  if (
    global.journal !== "v20-architecture-migration-journal" ||
    global.architectureMigrationVersion !== ARCH_VERSION ||
    global.status !== "migrated" ||
    !Array.isArray(global.operations)
  ) {
    fail("Journal global v20 inválido ou não está em estado migrated.");
  }

  const countsByStage = new Map();
  for (const operation of global.operations) {
    const stage = operation.sourceStage;
    countsByStage.set(stage, (countsByStage.get(stage) ?? 0) + 1);
  }

  for (const [stage, expected] of EXPECTED_STAGE_COUNTS) {
    if ((countsByStage.get(stage) ?? 0) !== expected) {
      fail(`Pré-condição da Etapa ${String(stage)} divergiu: esperado ${String(expected)}, atual ${String(countsByStage.get(stage) ?? 0)}.`);
    }
  }

  const stage14 = readJson(absoluteFromRelative(rootDir, STAGE14_JOURNAL), STAGE14_JOURNAL);
  const stage15 = readJson(absoluteFromRelative(rootDir, STAGE15_JOURNAL), STAGE15_JOURNAL);
  if (!Array.isArray(stage14.operations) || stage14.operations.length !== 23) {
    fail("Journal da Etapa 14 não contém 23 fachadas.");
  }
  if (!Array.isArray(stage15.operations) || stage15.operations.length !== 2) {
    fail("Journal da Etapa 15 não contém as 2 configurações esperadas.");
  }

  const stage16Absolute = absoluteFromRelative(rootDir, STAGE16_JOURNAL);
  const stage16Exists = fs.existsSync(stage16Absolute);
  const stage16Count = countsByStage.get(16) ?? 0;
  let stage16 = null;

  if (stage16Exists) {
    stage16 = readJson(stage16Absolute, STAGE16_JOURNAL);
    if (
      stage16.architectureMigrationVersion !== ARCH_VERSION ||
      !Array.isArray(stage16.operations) ||
      stage16.operations.length === 0 ||
      !["applied", "completed"].includes(stage16.status)
    ) {
      fail("Journal da Etapa 16 existe, mas não representa uma aplicação válida.");
    }
    if (stage16Count !== stage16.operations.length) {
      fail(`Journal global e Etapa 16 divergem: global=${String(stage16Count)}, stage16=${String(stage16.operations.length)}.`);
    }
  } else if (stage16Count !== 0) {
    fail("Journal global contém operações da Etapa 16, mas o journal específico está ausente.");
  }

  if (![5, 6].includes(global.schemaVersion)) {
    fail(`Pré-condição esperada: journal global schema 5 ou 6 antes da Etapa 17. Atual: ${String(global.schemaVersion)}.`);
  }

  return { global, stage16, stage16Exists };
}

function fullStatementRemovalRange(sourceFile, statement) {
  let start = statement.getStart(sourceFile);
  let end = statement.end;
  const text = sourceFile.text;
  if (text.slice(end, end + 2) === "\r\n") end += 2;
  else if (text[end] === "\n") end += 1;
  return { start, end, replacement: "" };
}

function applyEdits(text, edits) {
  let output = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    output = `${output.slice(0, edit.start)}${edit.replacement}${output.slice(edit.end)}`;
  }
  return output;
}

function eolOf(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function renderTypeImportWithAddedName(ts, sourceFile, importDeclaration, addedName) {
  const clause = importDeclaration.importClause;
  if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) {
    fail(`Import incompatível para adicionar ${addedName}: ${importDeclaration.getText(sourceFile)}`);
  }

  const names = [];
  for (const element of clause.namedBindings.elements) {
    const imported = element.propertyName
      ? `${element.propertyName.text} as ${element.name.text}`
      : element.name.text;
    names.push(imported);
  }
  if (!names.some((name) => name === addedName)) names.push(addedName);

  const eol = eolOf(sourceFile.text);
  return [
    "import type {",
    ...names.map((name) => `  ${name},`),
    `} from ${JSON.stringify(importDeclaration.moduleSpecifier.text)};`,
  ].join(eol);
}

function transformContract(ts, text) {
  const sourceFile = parseSource(ts, CONTRACT_PATH, text);
  const existing = sourceFile.statements.find(
    (statement) => ts.isInterfaceDeclaration(statement) && statement.name.text === "StateReplicationApi",
  );
  if (existing) fail("StateReplicationApi já existe sem journal da Etapa 17.");

  const anchor = sourceFile.statements.find(
    (statement) => ts.isInterfaceDeclaration(statement) && statement.name.text === "WorldStateSnapshot",
  );
  if (!anchor) fail("Interface WorldStateSnapshot não encontrada.");

  const eol = eolOf(text);
  const block = [
    "export interface StateReplicationApi {",
    "  registerEntity(entityId: string, initialSnapshot: EntitySnapshot): void;",
    "  unregisterEntity(entityId: string): void;",
    "  pushEntitySnapshot(snapshot: EntitySnapshot): void;",
    "  processWorldSnapshot(worldSnapshot: WorldStateSnapshot): void;",
    "  getInterpolatedState(entityId: string, alpha: number): EntitySnapshot | null;",
    "  generateWorldSnapshot(sequence: number, tick: number, hostSteamId: string): WorldStateSnapshot;",
    "  clear(): void;",
    "}",
  ].join(eol);

  const after = `${text.slice(0, anchor.end)}${eol}${eol}${block}${text.slice(anchor.end)}`;
  parseSource(ts, CONTRACT_PATH, after);
  return after;
}

function findNamedMethod(ts, container, methodName) {
  return container.members.find(
    (member) =>
      (ts.isMethodSignature(member) || ts.isMethodDeclaration(member)) &&
      member.name &&
      ts.isIdentifier(member.name) &&
      member.name.text === methodName,
  );
}

function transformToken(ts, rootDir, text) {
  const sourceFile = parseSource(ts, TOKEN_PATH, text);
  const networkApi = sourceFile.statements.find(
    (statement) => ts.isInterfaceDeclaration(statement) && statement.name.text === "NetworkApi",
  );
  if (!networkApi) fail("NetworkApi não encontrada em src/tokens/net.ts.");

  const method = findNamedMethod(ts, networkApi, "getStateReplicator");
  if (!method?.type || !ts.isTypeReferenceNode(method.type) || !ts.isIdentifier(method.type.typeName)) {
    fail("NetworkApi.getStateReplicator() não possui o tipo concreto esperado.");
  }
  if (method.type.typeName.text !== "StateReplicator") {
    fail(`Tipo inesperado em NetworkApi.getStateReplicator(): ${method.type.getText(sourceFile)}`);
  }

  let concreteImport = null;
  let contractImport = null;
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const target = resolveRelativeModule(rootDir, TOKEN_PATH, statement.moduleSpecifier.text);
    if (target === REPLICATOR_PATH) concreteImport = statement;
    if (target === CONTRACT_PATH) contractImport = statement;
  }
  if (!concreteImport) fail("Import concreto StateReplicator não encontrado em src/tokens/net.ts.");
  if (!contractImport) fail("Import de contracts/net/types não encontrado em src/tokens/net.ts.");

  const contractReplacement = renderTypeImportWithAddedName(ts, sourceFile, contractImport, "StateReplicationApi");
  const after = applyEdits(text, [
    fullStatementRemovalRange(sourceFile, concreteImport),
    {
      start: contractImport.getStart(sourceFile),
      end: contractImport.end,
      replacement: contractReplacement,
    },
    {
      start: method.type.getStart(sourceFile),
      end: method.type.end,
      replacement: "StateReplicationApi",
    },
  ]);
  parseSource(ts, TOKEN_PATH, after);
  return after;
}

function transformReplicator(ts, text) {
  const sourceFile = parseSource(ts, REPLICATOR_PATH, text);
  const classNode = sourceFile.statements.find(
    (statement) => ts.isClassDeclaration(statement) && statement.name?.text === "StateReplicator",
  );
  if (!classNode?.name) fail("Classe StateReplicator não encontrada.");
  if (classNode.heritageClauses?.length) fail("StateReplicator já possui heritage clauses inesperadas.");

  const contractImport = sourceFile.statements.find(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteralLike(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text.endsWith("contracts/net/types"),
  );
  if (!contractImport || !ts.isImportDeclaration(contractImport)) {
    fail("Import de contracts/net/types não encontrado em StateReplicator.");
  }

  const importReplacement = renderTypeImportWithAddedName(ts, sourceFile, contractImport, "StateReplicationApi");
  const after = applyEdits(text, [
    {
      start: contractImport.getStart(sourceFile),
      end: contractImport.end,
      replacement: importReplacement,
    },
    {
      start: classNode.name.end,
      end: classNode.name.end,
      replacement: " implements StateReplicationApi",
    },
  ]);
  parseSource(ts, REPLICATOR_PATH, after);
  return after;
}

function transformService(ts, text) {
  const sourceFile = parseSource(ts, SERVICE_PATH, text);
  const classNode = sourceFile.statements.find(
    (statement) => ts.isClassDeclaration(statement) && statement.name?.text === "NetworkService",
  );
  if (!classNode) fail("Classe NetworkService não encontrada.");
  const method = findNamedMethod(ts, classNode, "getStateReplicator");
  if (!method?.type || !ts.isTypeReferenceNode(method.type) || !ts.isIdentifier(method.type.typeName)) {
    fail("NetworkService.getStateReplicator() não possui tipo explícito esperado.");
  }
  if (method.type.typeName.text !== "StateReplicator") {
    fail(`Tipo inesperado em NetworkService.getStateReplicator(): ${method.type.getText(sourceFile)}`);
  }

  const contractImport = sourceFile.statements.find(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteralLike(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text.endsWith("contracts/net/types"),
  );
  if (!contractImport || !ts.isImportDeclaration(contractImport)) {
    fail("Import de contracts/net/types não encontrado em NetworkService.");
  }

  const importReplacement = renderTypeImportWithAddedName(ts, sourceFile, contractImport, "StateReplicationApi");
  const after = applyEdits(text, [
    {
      start: contractImport.getStart(sourceFile),
      end: contractImport.end,
      replacement: importReplacement,
    },
    {
      start: method.type.getStart(sourceFile),
      end: method.type.end,
      replacement: "StateReplicationApi",
    },
  ]);
  parseSource(ts, SERVICE_PATH, after);
  return after;
}

function inspectFinalTypes(ts, rootDir) {
  const contractText = fs.readFileSync(absoluteFromRelative(rootDir, CONTRACT_PATH), "utf8");
  const tokenText = fs.readFileSync(absoluteFromRelative(rootDir, TOKEN_PATH), "utf8");
  const replicatorText = fs.readFileSync(absoluteFromRelative(rootDir, REPLICATOR_PATH), "utf8");
  const serviceText = fs.readFileSync(absoluteFromRelative(rootDir, SERVICE_PATH), "utf8");
  const facadeText = fs.readFileSync(absoluteFromRelative(rootDir, PUBLIC_FACADE_PATH), "utf8");

  const contract = parseSource(ts, CONTRACT_PATH, contractText);
  const api = contract.statements.find(
    (statement) => ts.isInterfaceDeclaration(statement) && statement.name.text === "StateReplicationApi",
  );
  if (!api || !ts.isInterfaceDeclaration(api)) fail("StateReplicationApi não foi criada.");
  const apiMethods = api.members
    .filter((member) => ts.isMethodSignature(member) && member.name && ts.isIdentifier(member.name))
    .map((member) => member.name.text);
  if (
    apiMethods.length !== EXPECTED_PUBLIC_METHODS.length ||
    EXPECTED_PUBLIC_METHODS.some((name) => !apiMethods.includes(name))
  ) {
    fail(`StateReplicationApi não contém a superfície pública esperada: ${apiMethods.join(", ")}`);
  }

  const token = parseSource(ts, TOKEN_PATH, tokenText);
  const networkApi = token.statements.find(
    (statement) => ts.isInterfaceDeclaration(statement) && statement.name.text === "NetworkApi",
  );
  const tokenMethod = networkApi && ts.isInterfaceDeclaration(networkApi)
    ? findNamedMethod(ts, networkApi, "getStateReplicator")
    : null;
  if (
    !tokenMethod?.type ||
    tokenMethod.type.getText(token) !== "StateReplicationApi" ||
    tokenText.includes("engine/net/internal/StateReplicator")
  ) {
    fail("NetworkApi ainda expõe StateReplicator concreto.");
  }

  const replicator = parseSource(ts, REPLICATOR_PATH, replicatorText);
  const classNode = replicator.statements.find(
    (statement) => ts.isClassDeclaration(statement) && statement.name?.text === "StateReplicator",
  );
  const implementsApi = classNode?.heritageClauses?.some(
    (clause) =>
      clause.token === ts.SyntaxKind.ImplementsKeyword &&
      clause.types.some((type) => type.expression.getText(replicator) === "StateReplicationApi"),
  );
  if (!implementsApi) fail("StateReplicator não implementa StateReplicationApi.");

  const service = parseSource(ts, SERVICE_PATH, serviceText);
  const serviceClass = service.statements.find(
    (statement) => ts.isClassDeclaration(statement) && statement.name?.text === "NetworkService",
  );
  const serviceMethod = serviceClass && ts.isClassDeclaration(serviceClass)
    ? findNamedMethod(ts, serviceClass, "getStateReplicator")
    : null;
  if (!serviceMethod?.type || serviceMethod.type.getText(service) !== "StateReplicationApi") {
    fail("NetworkService.getStateReplicator() não retorna StateReplicationApi.");
  }

  if (
    !facadeText.includes('../../../contracts/net/types') ||
    !facadeText.includes('../../../tokens/net') ||
    facadeText.includes('/internal/')
  ) {
    fail("Fachada pública game.net deixou de ser contracts/tokens-only.");
  }
}

function isExcludedScanPath(relativePath, isDirectory) {
  const top = relativePath.split("/")[0];
  if (isDirectory && SCAN_EXCLUDED_TOP_LEVEL.has(top)) return true;
  const normalized = isDirectory ? `${relativePath}/` : relativePath;
  return SCAN_EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function protectedSnapshot(rootDir, mutablePaths) {
  const mutable = new Set(mutablePaths);
  const records = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      const absolutePath = path.join(current, entry.name);
      const relativePath = toRelative(rootDir, absolutePath);
      if (isExcludedScanPath(relativePath, entry.isDirectory())) continue;
      if (mutable.has(relativePath)) continue;
      if (entry.isSymbolicLink()) {
        records.push({ path: relativePath, kind: "symlink", target: fs.readlinkSync(absolutePath) });
      } else if (entry.isDirectory()) {
        stack.push(absolutePath);
      } else if (entry.isFile()) {
        const buffer = fs.readFileSync(absolutePath);
        records.push({ path: relativePath, kind: "file", bytes: buffer.length, sha256: sha256(buffer) });
      }
    }
  }
  records.sort((a, b) => a.path.localeCompare(b.path, "en"));
  return { count: records.length, digest: semanticSha256(records) };
}

function buildChange(filePath, before, after, role) {
  if (before === after) fail(`Transformação nula inesperada: ${filePath}`);
  return {
    filePath,
    role,
    before,
    after,
    beforeBytes: Buffer.byteLength(before, "utf8"),
    afterBytes: Buffer.byteLength(after, "utf8"),
    beforeSha: sha256Text(before),
    afterSha: sha256Text(after),
  };
}

function backupPaths(filePath) {
  return {
    before: `${STAGE17_BACKUPS}/before/${filePath}`,
    after: `${STAGE17_BACKUPS}/after/${filePath}`,
  };
}

function buildOperation(change, sequence, now) {
  const backups = backupPaths(change.filePath);
  return {
    sequence,
    sourceStage: 17,
    moduleKey: "net",
    capabilityId: "game.net",
    isWorker: false,
    oldPath: change.filePath,
    newPath: change.filePath,
    bytes: change.afterBytes,
    shaBefore: change.beforeSha,
    shaAfter: change.afterSha,
    timestampUtc: now,
    transformation: "fix-api-implementation-leak",
    state: "applied",
    rollbackTimestampUtc: null,
    filePath: change.filePath,
    role: change.role,
    leakId: "game.net.state-replication-concrete-return",
    publicInterface: "StateReplicationApi",
    concreteImplementation: "StateReplicator",
    fileBytesBefore: change.beforeBytes,
    fileBytesAfter: change.afterBytes,
    fileShaBefore: change.beforeSha,
    fileShaAfter: change.afterSha,
    backupBeforePath: backups.before,
    backupBeforeSha256: change.beforeSha,
    backupAfterPath: backups.after,
    backupAfterSha256: change.afterSha,
  };
}

function validateExistingStage17(rootDir, ts) {
  const stage17 = readJson(absoluteFromRelative(rootDir, STAGE17_JOURNAL), STAGE17_JOURNAL);
  if (
    stage17.stage !== STAGE_NAME ||
    stage17.architectureMigrationVersion !== ARCH_VERSION ||
    !["completed", "applied"].includes(stage17.status) ||
    !Array.isArray(stage17.operations) ||
    stage17.operations.length !== 4
  ) {
    fail("Journal existente da Etapa 17 é incompatível.");
  }

  for (const operation of stage17.operations) {
    const current = fs.readFileSync(absoluteFromRelative(rootDir, operation.filePath));
    if (sha256(current) !== operation.fileShaAfter) {
      fail(`Arquivo divergiu do journal da Etapa 17: ${operation.filePath}`);
    }
    for (const [relativePath, expectedSha] of [
      [operation.backupBeforePath, operation.backupBeforeSha256],
      [operation.backupAfterPath, operation.backupAfterSha256],
    ]) {
      const buffer = fs.readFileSync(absoluteFromRelative(rootDir, relativePath));
      if (sha256(buffer) !== expectedSha) fail(`Backup inválido: ${relativePath}`);
    }
  }

  const global = readJson(absoluteFromRelative(rootDir, V20_JOURNAL), V20_JOURNAL);
  if (global.schemaVersion !== 7 || !Array.isArray(global.operations)) {
    fail("Journal global não está no schema 7 esperado da Etapa 17.");
  }
  const stage17Global = global.operations.filter((operation) => operation.sourceStage === 17);
  if (stage17Global.length !== 4) fail("Journal global não contém 4 operações da Etapa 17.");
  const digest = semanticSha256(global.operations.map((operation) => immutableOperationV7(operation)));
  if (digest !== global.operationsIdentitySha256) fail("operationsIdentitySha256 v7 divergiu.");

  const audit = auditApiImplementationLeaks(ts, rootDir);
  if (audit.leaks.length !== 0) fail("Ainda existem vazamentos API -> implementação após a Etapa 17.");
  inspectFinalTypes(ts, rootDir);
  return { stage17, global, audit };
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const rootDir = path.resolve(process.cwd());
  assertProjectRoot(rootDir);
  const ts = loadTypeScript();

  const stage17Absolute = absoluteFromRelative(rootDir, STAGE17_JOURNAL);
  if (fs.existsSync(stage17Absolute)) {
    const validated = validateExistingStage17(rootDir, ts);
    console.log("============================================================");
    console.log("  PROJETO1 — ETAPA 17 JÁ ESTÁ CONCLUÍDA");
    console.log("============================================================");
    console.log(`[OK] Arquivos: ${String(validated.stage17.operations.length)}/4`);
    console.log(`[OK] Tokens/contracts auditados: ${String(validated.audit.filesAudited)}`);
    console.log("[OK] Vazamentos API -> implementação restantes: 0");
    return;
  }

  if (fs.existsSync(absoluteFromRelative(rootDir, ".migration/stage17"))) {
    fail(".migration/stage17 existe sem journal concluído; não sobrescrevo estado parcial.");
  }

  const migration = validateMigrationState(rootDir);
  const auditBefore = auditApiImplementationLeaks(ts, rootDir);
  if (
    auditBefore.leaks.length !== 1 ||
    auditBefore.leaks[0].sourcePath !== TOKEN_PATH ||
    auditBefore.leaks[0].targetPath !== REPLICATOR_PATH
  ) {
    fail(
      [
        `A auditoria prévia deveria encontrar exatamente 1 vazamento conhecido; encontrou ${String(auditBefore.leaks.length)}.`,
        ...auditBefore.leaks.map((leak) => `  ${leak.sourcePath}: ${leak.specifier} -> ${leak.targetPath}`),
      ].join("\n"),
    );
  }

  const beforeContract = fs.readFileSync(absoluteFromRelative(rootDir, CONTRACT_PATH), "utf8");
  const beforeToken = fs.readFileSync(absoluteFromRelative(rootDir, TOKEN_PATH), "utf8");
  const beforeReplicator = fs.readFileSync(absoluteFromRelative(rootDir, REPLICATOR_PATH), "utf8");
  const beforeService = fs.readFileSync(absoluteFromRelative(rootDir, SERVICE_PATH), "utf8");

  const changes = [
    buildChange(CONTRACT_PATH, beforeContract, transformContract(ts, beforeContract), "public-contract-interface"),
    buildChange(TOKEN_PATH, beforeToken, transformToken(ts, rootDir, beforeToken), "capability-api-return-type"),
    buildChange(REPLICATOR_PATH, beforeReplicator, transformReplicator(ts, beforeReplicator), "internal-interface-implementation"),
    buildChange(SERVICE_PATH, beforeService, transformService(ts, beforeService), "internal-service-return-type"),
  ];

  const mutablePaths = changes.map((change) => change.filePath);
  const protectedBefore = protectedSnapshot(rootDir, mutablePaths);
  const originalGlobalBuffer = fs.readFileSync(absoluteFromRelative(rootDir, V20_JOURNAL));
  const now = new Date().toISOString();
  const firstSequence = Math.max(...migration.global.operations.map((operation) => operation.sequence ?? 0)) + 1;
  const operations = changes.map((change, index) => buildOperation(change, firstSequence + index, now));

  const applied = [];
  try {
    for (let index = 0; index < changes.length; index += 1) {
      const change = changes[index];
      const operation = operations[index];
      writeTextAtomic(absoluteFromRelative(rootDir, operation.backupBeforePath), change.before);
      writeTextAtomic(absoluteFromRelative(rootDir, operation.backupAfterPath), change.after);
      writeTextAtomic(absoluteFromRelative(rootDir, change.filePath), change.after);
      applied.push(change);
    }

    const auditAfter = auditApiImplementationLeaks(ts, rootDir);
    if (auditAfter.leaks.length !== 0) {
      fail(`Pós-auditoria encontrou ${String(auditAfter.leaks.length)} vazamento(s).`);
    }
    inspectFinalTypes(ts, rootDir);

    const stage17Journal = {
      schemaVersion: 1,
      journal: "stage17-api-leak-journal",
      stage: STAGE_NAME,
      architectureMigrationVersion: ARCH_VERSION,
      status: "completed",
      createdAtUtc: now,
      updatedAtUtc: now,
      completedAtUtc: now,
      stage16WasAppliedBeforeStage17: migration.stage16Exists,
      auditBefore: {
        filesAudited: auditBefore.filesAudited,
        referencesSeen: auditBefore.referencesSeen,
        leaksFound: auditBefore.leaks.length,
        leaks: auditBefore.leaks,
      },
      auditAfter: {
        filesAudited: auditAfter.filesAudited,
        referencesSeen: auditAfter.referencesSeen,
        leaksFound: 0,
      },
      counts: {
        filesChanged: 4,
        publicInterfacesAdded: 1,
        concreteApiLeaksFixed: 1,
        concreteApiLeaksRemaining: 0,
        stateReplicatorImplementations: 1,
        publicFacadeInternalReexports: 0,
        applied: 4,
        rolledBack: 0,
        conflicts: 0,
      },
      operationsIdentitySha256: semanticSha256(operations.map((operation) => immutableOperationV7(operation))),
      operations,
    };

    writeJsonAtomic(stage17Absolute, stage17Journal);

    const sourceJournals = Array.isArray(migration.global.sourceJournals)
      ? [...migration.global.sourceJournals]
      : [];
    if (migration.stage16Exists && !sourceJournals.some((entry) => entry.path === STAGE16_JOURNAL)) {
      sourceJournals.push({
        stage: migration.stage16.stage ?? "stage-16-core-api-migration",
        path: STAGE16_JOURNAL,
        statusAtConsolidation: migration.stage16.status,
      });
    }
    sourceJournals.push({
      stage: STAGE_NAME,
      path: STAGE17_JOURNAL,
      statusAtConsolidation: "completed",
    });

    const globalOperations = [...migration.global.operations, ...operations];
    const nextGlobal = {
      ...migration.global,
      schemaVersion: 7,
      updatedAtUtc: now,
      sourceJournals,
      counts: {
        ...migration.global.counts,
        totalOperations: globalOperations.length,
        applied: globalOperations.length,
        rolledBack: 0,
        conflicts: 0,
        stage17FilesChanged: 4,
        stage17ApiLayersAudited: auditAfter.filesAudited,
        stage17PublicInterfacesAdded: 1,
        stage17ConcreteApiLeaksFixed: 1,
        stage17ConcreteApiLeaksRemaining: 0,
      },
      operationsIdentityAlgorithm: "semantic-sha256-v7-immutable-operation",
      operationsIdentitySha256: semanticSha256(globalOperations.map((operation) => immutableOperationV7(operation))),
      operations: globalOperations,
    };
    writeJsonAtomic(absoluteFromRelative(rootDir, V20_JOURNAL), nextGlobal);

    const protectedAfter = protectedSnapshot(rootDir, mutablePaths);
    if (protectedBefore.digest !== protectedAfter.digest) {
      fail(`Digest protegido divergiu. Antes=${protectedBefore.digest}; depois=${protectedAfter.digest}.`);
    }

    const idempotent = validateExistingStage17(rootDir, ts);

    console.log("============================================================");
    console.log("  PROJETO1 — ETAPA 17: CORREÇÃO API -> IMPLEMENTAÇÃO");
    console.log("============================================================\n");
    console.log(`[OK] Tokens/contracts auditados: ${String(auditBefore.filesAudited)}`);
    console.log(`[OK] Referências de módulo auditadas: ${String(auditBefore.referencesSeen)}`);
    console.log("[OK] Vazamentos concretos encontrados antes: 1");
    console.log("[OK] src/tokens/net.ts -> StateReplicator concrete leak identificado.");
    console.log(`[OK] Etapa 16 já aplicada antes desta etapa: ${migration.stage16Exists ? "sim" : "não"}`);
    console.log("\n=== APLICAÇÃO TRANSACIONAL ===");
    for (const operation of operations) {
      console.log(`  [OK] ${operation.filePath} | ${operation.role}`);
    }
    console.log("\n=== VALIDAÇÃO FINAL ===");
    console.log("[OK] StateReplicationApi criada: 1/1");
    console.log("[OK] StateReplicator implements StateReplicationApi: 1/1");
    console.log("[OK] NetworkApi.getStateReplicator(): StateReplicationApi");
    console.log("[OK] NetworkService.getStateReplicator(): StateReplicationApi");
    console.log("[OK] Vazamentos API -> implementação restantes: 0");
    console.log("[OK] Reexports de internal em game.net/public: 0");
    console.log(`[OK] Journal: ${STAGE17_JOURNAL}`);
    console.log(`[OK] Journal global v20: ${String(idempotent.global.operations.length)} operações.`);
    console.log(`[OK] Digest protegido antes: ${protectedBefore.digest}`);
    console.log(`[OK] Digest protegido depois: ${protectedAfter.digest}`);
    console.log("\n============================================================");
    console.log("  ETAPA 17 CONCLUÍDA COM SUCESSO");
    console.log("============================================================");
  } catch (error) {
    const compensationErrors = [];
    for (let index = applied.length - 1; index >= 0; index -= 1) {
      const change = applied[index];
      try {
        writeTextAtomic(absoluteFromRelative(rootDir, change.filePath), change.before);
      } catch (compensationError) {
        compensationErrors.push(`${change.filePath}: ${compensationError instanceof Error ? compensationError.message : String(compensationError)}`);
      }
    }
    try {
      writeAtomic(absoluteFromRelative(rootDir, V20_JOURNAL), originalGlobalBuffer);
      fs.rmSync(absoluteFromRelative(rootDir, ".migration/stage17"), { recursive: true, force: true });
    } catch (compensationError) {
      compensationErrors.push(`journal/cleanup: ${compensationError instanceof Error ? compensationError.message : String(compensationError)}`);
    }

    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    fail([
      message,
      compensationErrors.length === 0
        ? "[OK] Compensação restaurou todos os writes da Etapa 17."
        : `Compensação encontrou ${String(compensationErrors.length)} erro(s).`,
      ...compensationErrors.map((item) => `  - ${item}`),
    ].join("\n"));
  }
}

const executedAsMain =
  process.argv[1] !== undefined &&
  normalizeAbsolute(fileURLToPath(import.meta.url)) === normalizeAbsolute(process.argv[1]);

if (executedAsMain) {
  try {
    run();
  } catch (error) {
    console.error("\n[ERRO] Etapa 17 não concluída.");
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  }
}
