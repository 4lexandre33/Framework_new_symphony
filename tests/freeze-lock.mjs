#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  CANONICAL_MODULES,
  MODULE_MAP_SCHEMA_VERSION,
} from "../scripts/architecture/module-map.mjs";

const ROOT_DIR = process.cwd();
const TESTS_DIR = path.join(ROOT_DIR, "tests");
const LOCK_FILE = path.join(ROOT_DIR, ".freeze-lock.json");
const LEGACY_LOCK_FILE = path.join(TESTS_DIR, ".freeze-lock.json");

const SHARED_HOST_FILES = Object.freeze([
  "src-tauri/src/lib.rs",
  "src-tauri/Cargo.toml",
]);

function migrateLegacyLockIfNeeded() {
  const canonicalExists = fs.existsSync(LOCK_FILE);
  const legacyExists = fs.existsSync(LEGACY_LOCK_FILE);

  if (canonicalExists && legacyExists) {
    console.error(
      "[ERRO] Existem simultaneamente /.freeze-lock.json e tests/.freeze-lock.json. " +
      "Remova a ambiguidade antes de continuar.",
    );
    process.exit(1);
  }

  if (!canonicalExists && legacyExists) {
    try {
      JSON.parse(fs.readFileSync(LEGACY_LOCK_FILE, "utf8"));
    } catch (error) {
      console.error(
        `[ERRO] Lock legado inválido em tests/.freeze-lock.json: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      process.exit(1);
    }

    fs.renameSync(LEGACY_LOCK_FILE, LOCK_FILE);
    console.log(
      "\x1b[36m[MIGRADO]\x1b[0m tests/.freeze-lock.json -> /.freeze-lock.json",
    );
    return true;
  }

  return false;
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function comparePath(a, b) {
  return a.localeCompare(b, "en");
}

function collectFilesRecursively(relativeRoot) {
  const absoluteRoot = path.join(ROOT_DIR, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) {
    return [];
  }

  const stat = fs.statSync(absoluteRoot);
  if (!stat.isDirectory()) {
    return [relativeRoot];
  }

  const files = [];
  const stack = [absoluteRoot];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    const entries = fs.readdirSync(current, { withFileTypes: true });
    entries.sort((a, b) => comparePath(a.name, b.name));

    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      const absolutePath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }

      if (entry.isFile()) {
        files.push(toPosix(path.relative(ROOT_DIR, absolutePath)));
      }
    }
  }

  return files.sort(comparePath);
}

function collectDeclaredModuleFiles(moduleRecord) {
  return [
    ...moduleRecord.contracts,
    ...moduleRecord.tokens.map((tokenRecord) => tokenRecord.path),
    moduleRecord.plugin,
    ...moduleRecord.nativeFiles,
    ...moduleRecord.tests,
    ...moduleRecord.extraFiles,
  ];
}

function collectProtectedFiles() {
  const protectedFiles = new Set(SHARED_HOST_FILES);

  for (const moduleRecord of CANONICAL_MODULES) {
    for (const relPath of collectDeclaredModuleFiles(moduleRecord)) {
      protectedFiles.add(relPath);
    }

    for (const relPath of collectFilesRecursively(moduleRecord.engine.root)) {
      protectedFiles.add(relPath);
    }
  }

  return [...protectedFiles].sort(comparePath);
}

function calculateHash(relativePath) {
  const fullPath = path.join(ROOT_DIR, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  const content = fs.readFileSync(fullPath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function ensureTestsDirectory() {
  if (!fs.existsSync(TESTS_DIR)) {
    fs.mkdirSync(TESTS_DIR, { recursive: true });
  }
}

function lock() {
  ensureTestsDirectory();

  console.log("============================================================");
  console.log("  Congelando Módulos Estáveis do Projeto (Freeze Lock)     ");
  console.log("============================================================");
  console.log("Fonte: scripts/architecture/module-map.mjs\n");

  const protectedFiles = collectProtectedFiles();
  const manifest = {
    version: "20.0.0",
    moduleMapSchemaVersion: MODULE_MAP_SCHEMA_VERSION,
    lockedAt: new Date().toISOString(),
    files: {},
  };

  let missing = 0;

  for (const relPath of protectedFiles) {
    const hash = calculateHash(relPath);
    if (hash) {
      manifest.files[relPath] = hash;
      console.log(`\x1b[32m[CONGELADO]\x1b[0m ${relPath} (SHA-256: ${hash.substring(0, 12)}...)`);
    } else {
      missing += 1;
      console.log(`\x1b[31m[ALERTA]\x1b[0m Arquivo declarado no module-map não encontrado: ${relPath}`);
    }
  }

  if (missing > 0) {
    console.error(`\n[ERRO] ${missing} arquivo(s) canônico(s) ausente(s). Lock não foi gravado.`);
    process.exit(1);
  }

  fs.writeFileSync(LOCK_FILE, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`\n\x1b[32mSucesso:\x1b[0m Trava de imutabilidade gerada em '${LOCK_FILE}'.`);
}

function verify() {
  if (!fs.existsSync(LOCK_FILE)) {
    console.log("\x1b[33m[AVISO]\x1b[0m Nenhum arquivo de trava '/.freeze-lock.json' encontrado. Execute '--lock' primeiro.");
    return true;
  }

  const manifest = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
  const currentProtectedFiles = collectProtectedFiles();
  const lockedFiles = Object.keys(manifest.files ?? {}).sort(comparePath);
  let hasViolation = false;

  console.log("============================================================");
  console.log("  Verificando Integridade de Módulos Congelados            ");
  console.log("============================================================");
  console.log("Fonte: scripts/architecture/module-map.mjs\n");

  if (manifest.moduleMapSchemaVersion !== MODULE_MAP_SCHEMA_VERSION) {
    console.log(
      `\x1b[31m[VIOLAÇÃO DETECTADA]\x1b[0m O lock usa moduleMapSchemaVersion=${String(manifest.moduleMapSchemaVersion)}, ` +
      `mas o catálogo atual usa ${String(MODULE_MAP_SCHEMA_VERSION)}.`,
    );
    hasViolation = true;
  }

  const currentSet = new Set(currentProtectedFiles);
  const lockedSet = new Set(lockedFiles);

  const missingFromLock = currentProtectedFiles.filter((relPath) => !lockedSet.has(relPath));
  const staleInLock = lockedFiles.filter((relPath) => !currentSet.has(relPath));

  if (missingFromLock.length > 0) {
    hasViolation = true;
    for (const relPath of missingFromLock) {
      console.log(`\x1b[31m[ERRO DE CONGELAMENTO]\x1b[0m Arquivo canônico não está no lock: ${relPath}`);
    }
  }

  if (staleInLock.length > 0) {
    hasViolation = true;
    for (const relPath of staleInLock) {
      console.log(`\x1b[31m[ERRO DE CONGELAMENTO]\x1b[0m Path obsoleto permanece no lock: ${relPath}`);
    }
  }

  for (const [relPath, expectedHash] of Object.entries(manifest.files ?? {})) {
    const currentHash = calculateHash(relPath);
    if (!currentHash) {
      console.log(`\x1b[31m[ERRO DE CONGELAMENTO]\x1b[0m Arquivo removido: ${relPath}`);
      hasViolation = true;
    } else if (currentHash !== expectedHash) {
      console.log(`\x1b[31m[VIOLAÇÃO DETECTADA]\x1b[0m O arquivo congelado '${relPath}' foi alterado!`);
      hasViolation = true;
    } else {
      console.log(`\x1b[32m[ÍNTEGRO]\x1b[0m ${relPath}`);
    }
  }

  if (hasViolation) {
    console.log("\n\x1b[31m[BLOQUEIO DE BUILD] Modificações não autorizadas ou drift do catálogo foram detectados!\x1b[0m");
    console.log("Para atualizar legitimamente o código, desbloqueie antes da alteração e regenere o lock na etapa apropriada.\n");
    process.exit(1);
  }

  console.log("\n\x1b[32mTodos os módulos congelados estão protegidos e íntegros.\x1b[0m\n");
  return true;
}

const args = process.argv.slice(2);
const isLock = args.includes("--lock");
const isUnlock = args.includes("--unlock");

if (isLock && isUnlock) {
  console.error("[ERRO] --lock e --unlock são mutuamente exclusivos.");
  process.exit(1);
}

const unknownArgs = args.filter((arg) => arg !== "--lock" && arg !== "--unlock");
if (unknownArgs.length > 0) {
  console.error(`[ERRO] Argumento(s) desconhecido(s): ${unknownArgs.join(", ")}`);
  process.exit(1);
}

migrateLegacyLockIfNeeded();

if (isLock) {
  lock();
} else if (isUnlock) {
  if (fs.existsSync(LOCK_FILE)) {
    fs.unlinkSync(LOCK_FILE);
    console.log("\x1b[33m[DESBLOQUEADO]\x1b[0m Trava de imutabilidade removida temporariamente.");
  } else {
    console.log("\x1b[33m[DESBLOQUEADO]\x1b[0m Nenhuma trava ativa em /.freeze-lock.json.");
  }
} else {
  verify();
}
