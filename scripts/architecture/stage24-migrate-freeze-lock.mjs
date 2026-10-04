#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const STAGE = "stage-24-freeze-lock-root";
const ROOT = process.cwd();
const CANONICAL_LOCK = path.join(ROOT, ".freeze-lock.json");
const LEGACY_LOCK = path.join(ROOT, "tests", ".freeze-lock.json");

const TARGETS = {
  "agents.mjs": "#!/usr/bin/env node\nimport { execFileSync } from \"node:child_process\";\nimport { CANONICAL_MODULES } from \"./scripts/architecture/module-map.mjs\";\n\nconst args = process.argv.slice(2);\nconst isLock = args.includes(\"--lock\");\nconst isUnlock = args.includes(\"--unlock\");\n\nif (isLock && isUnlock) {\n  console.error(\"[ERRO] --lock e --unlock são mutuamente exclusivos.\");\n  process.exit(1);\n}\n\nconst unknownArgs = args.filter((arg) => arg !== \"--lock\" && arg !== \"--unlock\");\nif (unknownArgs.length > 0) {\n  console.error(`[ERRO] Argumento(s) desconhecido(s): ${unknownArgs.join(\", \")}`);\n  process.exit(1);\n}\n\nfunction runNode(script, scriptArgs = []) {\n  execFileSync(\n    process.execPath,\n    [script, ...scriptArgs],\n    { stdio: \"inherit\" },\n  );\n}\n\nconsole.log(\"============================================================\");\nconsole.log(\"  AGENTS GUARDRAIL ORCHESTRATOR - PROJETO 1                  \");\nconsole.log(\"============================================================\");\nconsole.log(`Fonte canônica: scripts/architecture/module-map.mjs (${CANONICAL_MODULES.length} módulos)`);\nconsole.log(\"Freeze lock canônico: /.freeze-lock.json\\n\");\n\nif (isLock) {\n  console.log(\"Congelando módulos a partir do catálogo canônico...\");\n  runNode(\"tests/freeze-lock.mjs\", [\"--lock\"]);\n} else if (isUnlock) {\n  console.log(\"Desbloqueando código congelado para alterações autorizadas...\");\n  runNode(\"tests/freeze-lock.mjs\", [\"--unlock\"]);\n} else {\n  try {\n    runNode(\"tests/freeze-invariants.mjs\");\n    runNode(\"tests/freeze-lock.mjs\");\n    console.log(\"\\x1b[32m[PRONTO PARA DESENVOLVIMENTO]\\x1b[0m Ambiente seguro para os Agentes de IA.\");\n  } catch {\n    console.error(\"\\x1b[31m[EXECUÇÃO BLOQUEADA]\\x1b[0m Corrija as violações antes de prosseguir.\");\n    process.exit(1);\n  }\n}\n",
  "tests/freeze-lock.mjs": "#!/usr/bin/env node\nimport fs from \"node:fs\";\nimport path from \"node:path\";\nimport crypto from \"node:crypto\";\nimport {\n  CANONICAL_MODULES,\n  MODULE_MAP_SCHEMA_VERSION,\n} from \"../scripts/architecture/module-map.mjs\";\n\nconst ROOT_DIR = process.cwd();\nconst TESTS_DIR = path.join(ROOT_DIR, \"tests\");\nconst LOCK_FILE = path.join(ROOT_DIR, \".freeze-lock.json\");\nconst LEGACY_LOCK_FILE = path.join(TESTS_DIR, \".freeze-lock.json\");\n\nconst SHARED_HOST_FILES = Object.freeze([\n  \"src-tauri/src/lib.rs\",\n  \"src-tauri/Cargo.toml\",\n]);\n\nfunction migrateLegacyLockIfNeeded() {\n  const canonicalExists = fs.existsSync(LOCK_FILE);\n  const legacyExists = fs.existsSync(LEGACY_LOCK_FILE);\n\n  if (canonicalExists && legacyExists) {\n    console.error(\n      \"[ERRO] Existem simultaneamente /.freeze-lock.json e tests/.freeze-lock.json. \" +\n      \"Remova a ambiguidade antes de continuar.\",\n    );\n    process.exit(1);\n  }\n\n  if (!canonicalExists && legacyExists) {\n    try {\n      JSON.parse(fs.readFileSync(LEGACY_LOCK_FILE, \"utf8\"));\n    } catch (error) {\n      console.error(\n        `[ERRO] Lock legado inválido em tests/.freeze-lock.json: ${\n          error instanceof Error ? error.message : String(error)\n        }`,\n      );\n      process.exit(1);\n    }\n\n    fs.renameSync(LEGACY_LOCK_FILE, LOCK_FILE);\n    console.log(\n      \"\\x1b[36m[MIGRADO]\\x1b[0m tests/.freeze-lock.json -> /.freeze-lock.json\",\n    );\n    return true;\n  }\n\n  return false;\n}\n\nfunction toPosix(relativePath) {\n  return relativePath.split(path.sep).join(\"/\");\n}\n\nfunction comparePath(a, b) {\n  return a.localeCompare(b, \"en\");\n}\n\nfunction collectFilesRecursively(relativeRoot) {\n  const absoluteRoot = path.join(ROOT_DIR, relativeRoot);\n  if (!fs.existsSync(absoluteRoot)) {\n    return [];\n  }\n\n  const stat = fs.statSync(absoluteRoot);\n  if (!stat.isDirectory()) {\n    return [relativeRoot];\n  }\n\n  const files = [];\n  const stack = [absoluteRoot];\n\n  while (stack.length > 0) {\n    const current = stack.pop();\n    if (!current) continue;\n\n    const entries = fs.readdirSync(current, { withFileTypes: true });\n    entries.sort((a, b) => comparePath(a.name, b.name));\n\n    for (let index = entries.length - 1; index >= 0; index -= 1) {\n      const entry = entries[index];\n      const absolutePath = path.join(current, entry.name);\n\n      if (entry.isDirectory()) {\n        stack.push(absolutePath);\n        continue;\n      }\n\n      if (entry.isFile()) {\n        files.push(toPosix(path.relative(ROOT_DIR, absolutePath)));\n      }\n    }\n  }\n\n  return files.sort(comparePath);\n}\n\nfunction collectDeclaredModuleFiles(moduleRecord) {\n  return [\n    ...moduleRecord.contracts,\n    ...moduleRecord.tokens.map((tokenRecord) => tokenRecord.path),\n    moduleRecord.plugin,\n    ...moduleRecord.nativeFiles,\n    ...moduleRecord.tests,\n    ...moduleRecord.extraFiles,\n  ];\n}\n\nfunction collectProtectedFiles() {\n  const protectedFiles = new Set(SHARED_HOST_FILES);\n\n  for (const moduleRecord of CANONICAL_MODULES) {\n    for (const relPath of collectDeclaredModuleFiles(moduleRecord)) {\n      protectedFiles.add(relPath);\n    }\n\n    for (const relPath of collectFilesRecursively(moduleRecord.engine.root)) {\n      protectedFiles.add(relPath);\n    }\n  }\n\n  return [...protectedFiles].sort(comparePath);\n}\n\nfunction calculateHash(relativePath) {\n  const fullPath = path.join(ROOT_DIR, relativePath);\n  if (!fs.existsSync(fullPath)) return null;\n  const content = fs.readFileSync(fullPath);\n  return crypto.createHash(\"sha256\").update(content).digest(\"hex\");\n}\n\nfunction ensureTestsDirectory() {\n  if (!fs.existsSync(TESTS_DIR)) {\n    fs.mkdirSync(TESTS_DIR, { recursive: true });\n  }\n}\n\nfunction lock() {\n  ensureTestsDirectory();\n\n  console.log(\"============================================================\");\n  console.log(\"  Congelando Módulos Estáveis do Projeto (Freeze Lock)     \");\n  console.log(\"============================================================\");\n  console.log(\"Fonte: scripts/architecture/module-map.mjs\\n\");\n\n  const protectedFiles = collectProtectedFiles();\n  const manifest = {\n    version: \"20.0.0\",\n    moduleMapSchemaVersion: MODULE_MAP_SCHEMA_VERSION,\n    lockedAt: new Date().toISOString(),\n    files: {},\n  };\n\n  let missing = 0;\n\n  for (const relPath of protectedFiles) {\n    const hash = calculateHash(relPath);\n    if (hash) {\n      manifest.files[relPath] = hash;\n      console.log(`\\x1b[32m[CONGELADO]\\x1b[0m ${relPath} (SHA-256: ${hash.substring(0, 12)}...)`);\n    } else {\n      missing += 1;\n      console.log(`\\x1b[31m[ALERTA]\\x1b[0m Arquivo declarado no module-map não encontrado: ${relPath}`);\n    }\n  }\n\n  if (missing > 0) {\n    console.error(`\\n[ERRO] ${missing} arquivo(s) canônico(s) ausente(s). Lock não foi gravado.`);\n    process.exit(1);\n  }\n\n  fs.writeFileSync(LOCK_FILE, JSON.stringify(manifest, null, 2), \"utf8\");\n  console.log(`\\n\\x1b[32mSucesso:\\x1b[0m Trava de imutabilidade gerada em '${LOCK_FILE}'.`);\n}\n\nfunction verify() {\n  if (!fs.existsSync(LOCK_FILE)) {\n    console.log(\"\\x1b[33m[AVISO]\\x1b[0m Nenhum arquivo de trava '/.freeze-lock.json' encontrado. Execute '--lock' primeiro.\");\n    return true;\n  }\n\n  const manifest = JSON.parse(fs.readFileSync(LOCK_FILE, \"utf8\"));\n  const currentProtectedFiles = collectProtectedFiles();\n  const lockedFiles = Object.keys(manifest.files ?? {}).sort(comparePath);\n  let hasViolation = false;\n\n  console.log(\"============================================================\");\n  console.log(\"  Verificando Integridade de Módulos Congelados            \");\n  console.log(\"============================================================\");\n  console.log(\"Fonte: scripts/architecture/module-map.mjs\\n\");\n\n  if (manifest.moduleMapSchemaVersion !== MODULE_MAP_SCHEMA_VERSION) {\n    console.log(\n      `\\x1b[31m[VIOLAÇÃO DETECTADA]\\x1b[0m O lock usa moduleMapSchemaVersion=${String(manifest.moduleMapSchemaVersion)}, ` +\n      `mas o catálogo atual usa ${String(MODULE_MAP_SCHEMA_VERSION)}.`,\n    );\n    hasViolation = true;\n  }\n\n  const currentSet = new Set(currentProtectedFiles);\n  const lockedSet = new Set(lockedFiles);\n\n  const missingFromLock = currentProtectedFiles.filter((relPath) => !lockedSet.has(relPath));\n  const staleInLock = lockedFiles.filter((relPath) => !currentSet.has(relPath));\n\n  if (missingFromLock.length > 0) {\n    hasViolation = true;\n    for (const relPath of missingFromLock) {\n      console.log(`\\x1b[31m[ERRO DE CONGELAMENTO]\\x1b[0m Arquivo canônico não está no lock: ${relPath}`);\n    }\n  }\n\n  if (staleInLock.length > 0) {\n    hasViolation = true;\n    for (const relPath of staleInLock) {\n      console.log(`\\x1b[31m[ERRO DE CONGELAMENTO]\\x1b[0m Path obsoleto permanece no lock: ${relPath}`);\n    }\n  }\n\n  for (const [relPath, expectedHash] of Object.entries(manifest.files ?? {})) {\n    const currentHash = calculateHash(relPath);\n    if (!currentHash) {\n      console.log(`\\x1b[31m[ERRO DE CONGELAMENTO]\\x1b[0m Arquivo removido: ${relPath}`);\n      hasViolation = true;\n    } else if (currentHash !== expectedHash) {\n      console.log(`\\x1b[31m[VIOLAÇÃO DETECTADA]\\x1b[0m O arquivo congelado '${relPath}' foi alterado!`);\n      hasViolation = true;\n    } else {\n      console.log(`\\x1b[32m[ÍNTEGRO]\\x1b[0m ${relPath}`);\n    }\n  }\n\n  if (hasViolation) {\n    console.log(\"\\n\\x1b[31m[BLOQUEIO DE BUILD] Modificações não autorizadas ou drift do catálogo foram detectados!\\x1b[0m\");\n    console.log(\"Para atualizar legitimamente o código, desbloqueie antes da alteração e regenere o lock na etapa apropriada.\\n\");\n    process.exit(1);\n  }\n\n  console.log(\"\\n\\x1b[32mTodos os módulos congelados estão protegidos e íntegros.\\x1b[0m\\n\");\n  return true;\n}\n\nconst args = process.argv.slice(2);\nconst isLock = args.includes(\"--lock\");\nconst isUnlock = args.includes(\"--unlock\");\n\nif (isLock && isUnlock) {\n  console.error(\"[ERRO] --lock e --unlock são mutuamente exclusivos.\");\n  process.exit(1);\n}\n\nconst unknownArgs = args.filter((arg) => arg !== \"--lock\" && arg !== \"--unlock\");\nif (unknownArgs.length > 0) {\n  console.error(`[ERRO] Argumento(s) desconhecido(s): ${unknownArgs.join(\", \")}`);\n  process.exit(1);\n}\n\nmigrateLegacyLockIfNeeded();\n\nif (isLock) {\n  lock();\n} else if (isUnlock) {\n  if (fs.existsSync(LOCK_FILE)) {\n    fs.unlinkSync(LOCK_FILE);\n    console.log(\"\\x1b[33m[DESBLOQUEADO]\\x1b[0m Trava de imutabilidade removida temporariamente.\");\n  } else {\n    console.log(\"\\x1b[33m[DESBLOQUEADO]\\x1b[0m Nenhuma trava ativa em /.freeze-lock.json.\");\n  }\n} else {\n  verify();\n}\n"
};
const STAGE23 = {
  "agents.mjs": "#!/usr/bin/env node\nimport { execFileSync } from \"node:child_process\";\nimport { CANONICAL_MODULES } from \"./scripts/architecture/module-map.mjs\";\n\nconst args = process.argv.slice(2);\nconst isLock = args.includes(\"--lock\");\nconst isUnlock = args.includes(\"--unlock\");\n\nif (isLock && isUnlock) {\n  console.error(\"[ERRO] --lock e --unlock são mutuamente exclusivos.\");\n  process.exit(1);\n}\n\nconst unknownArgs = args.filter((arg) => arg !== \"--lock\" && arg !== \"--unlock\");\nif (unknownArgs.length > 0) {\n  console.error(`[ERRO] Argumento(s) desconhecido(s): ${unknownArgs.join(\", \")}`);\n  process.exit(1);\n}\n\nfunction runNode(script, scriptArgs = []) {\n  execFileSync(\n    process.execPath,\n    [script, ...scriptArgs],\n    { stdio: \"inherit\" },\n  );\n}\n\nconsole.log(\"============================================================\");\nconsole.log(\"  AGENTS GUARDRAIL ORCHESTRATOR - PROJETO 1                  \");\nconsole.log(\"============================================================\");\nconsole.log(`Fonte canônica: scripts/architecture/module-map.mjs (${CANONICAL_MODULES.length} módulos)\\n`);\n\nif (isLock) {\n  console.log(\"Congelando módulos a partir do catálogo canônico...\");\n  runNode(\"tests/freeze-lock.mjs\", [\"--lock\"]);\n} else if (isUnlock) {\n  console.log(\"Desbloqueando código congelado para alterações autorizadas...\");\n  runNode(\"tests/freeze-lock.mjs\", [\"--unlock\"]);\n} else {\n  try {\n    runNode(\"tests/freeze-invariants.mjs\");\n    runNode(\"tests/freeze-lock.mjs\");\n    console.log(\"\\x1b[32m[PRONTO PARA DESENVOLVIMENTO]\\x1b[0m Ambiente seguro para os Agentes de IA.\");\n  } catch {\n    console.error(\"\\x1b[31m[EXECUÇÃO BLOQUEADA]\\x1b[0m Corrija as violações antes de prosseguir.\");\n    process.exit(1);\n  }\n}\n",
  "tests/freeze-lock.mjs": "#!/usr/bin/env node\nimport fs from \"node:fs\";\nimport path from \"node:path\";\nimport crypto from \"node:crypto\";\nimport {\n  CANONICAL_MODULES,\n  MODULE_MAP_SCHEMA_VERSION,\n} from \"../scripts/architecture/module-map.mjs\";\n\nconst ROOT_DIR = process.cwd();\nconst TESTS_DIR = path.join(ROOT_DIR, \"tests\");\n\n// Etapa 23: manter o lock no path histórico.\n// A migração para /.freeze-lock.json pertence exclusivamente à Etapa 24.\nconst LOCK_FILE = path.join(TESTS_DIR, \".freeze-lock.json\");\n\nconst SHARED_HOST_FILES = Object.freeze([\n  \"src-tauri/src/lib.rs\",\n  \"src-tauri/Cargo.toml\",\n]);\n\nfunction toPosix(relativePath) {\n  return relativePath.split(path.sep).join(\"/\");\n}\n\nfunction comparePath(a, b) {\n  return a.localeCompare(b, \"en\");\n}\n\nfunction collectFilesRecursively(relativeRoot) {\n  const absoluteRoot = path.join(ROOT_DIR, relativeRoot);\n  if (!fs.existsSync(absoluteRoot)) {\n    return [];\n  }\n\n  const stat = fs.statSync(absoluteRoot);\n  if (!stat.isDirectory()) {\n    return [relativeRoot];\n  }\n\n  const files = [];\n  const stack = [absoluteRoot];\n\n  while (stack.length > 0) {\n    const current = stack.pop();\n    if (!current) continue;\n\n    const entries = fs.readdirSync(current, { withFileTypes: true });\n    entries.sort((a, b) => comparePath(a.name, b.name));\n\n    for (let index = entries.length - 1; index >= 0; index -= 1) {\n      const entry = entries[index];\n      const absolutePath = path.join(current, entry.name);\n\n      if (entry.isDirectory()) {\n        stack.push(absolutePath);\n        continue;\n      }\n\n      if (entry.isFile()) {\n        files.push(toPosix(path.relative(ROOT_DIR, absolutePath)));\n      }\n    }\n  }\n\n  return files.sort(comparePath);\n}\n\nfunction collectDeclaredModuleFiles(moduleRecord) {\n  return [\n    ...moduleRecord.contracts,\n    ...moduleRecord.tokens.map((tokenRecord) => tokenRecord.path),\n    moduleRecord.plugin,\n    ...moduleRecord.nativeFiles,\n    ...moduleRecord.tests,\n    ...moduleRecord.extraFiles,\n  ];\n}\n\nfunction collectProtectedFiles() {\n  const protectedFiles = new Set(SHARED_HOST_FILES);\n\n  for (const moduleRecord of CANONICAL_MODULES) {\n    for (const relPath of collectDeclaredModuleFiles(moduleRecord)) {\n      protectedFiles.add(relPath);\n    }\n\n    for (const relPath of collectFilesRecursively(moduleRecord.engine.root)) {\n      protectedFiles.add(relPath);\n    }\n  }\n\n  return [...protectedFiles].sort(comparePath);\n}\n\nfunction calculateHash(relativePath) {\n  const fullPath = path.join(ROOT_DIR, relativePath);\n  if (!fs.existsSync(fullPath)) return null;\n  const content = fs.readFileSync(fullPath);\n  return crypto.createHash(\"sha256\").update(content).digest(\"hex\");\n}\n\nfunction ensureTestsDirectory() {\n  if (!fs.existsSync(TESTS_DIR)) {\n    fs.mkdirSync(TESTS_DIR, { recursive: true });\n  }\n}\n\nfunction lock() {\n  ensureTestsDirectory();\n\n  console.log(\"============================================================\");\n  console.log(\"  Congelando Módulos Estáveis do Projeto (Freeze Lock)     \");\n  console.log(\"============================================================\");\n  console.log(\"Fonte: scripts/architecture/module-map.mjs\\n\");\n\n  const protectedFiles = collectProtectedFiles();\n  const manifest = {\n    version: \"20.0.0\",\n    moduleMapSchemaVersion: MODULE_MAP_SCHEMA_VERSION,\n    lockedAt: new Date().toISOString(),\n    files: {},\n  };\n\n  let missing = 0;\n\n  for (const relPath of protectedFiles) {\n    const hash = calculateHash(relPath);\n    if (hash) {\n      manifest.files[relPath] = hash;\n      console.log(`\\x1b[32m[CONGELADO]\\x1b[0m ${relPath} (SHA-256: ${hash.substring(0, 12)}...)`);\n    } else {\n      missing += 1;\n      console.log(`\\x1b[31m[ALERTA]\\x1b[0m Arquivo declarado no module-map não encontrado: ${relPath}`);\n    }\n  }\n\n  if (missing > 0) {\n    console.error(`\\n[ERRO] ${missing} arquivo(s) canônico(s) ausente(s). Lock não foi gravado.`);\n    process.exit(1);\n  }\n\n  fs.writeFileSync(LOCK_FILE, JSON.stringify(manifest, null, 2), \"utf8\");\n  console.log(`\\n\\x1b[32mSucesso:\\x1b[0m Trava de imutabilidade gerada em '${LOCK_FILE}'.`);\n}\n\nfunction verify() {\n  if (!fs.existsSync(LOCK_FILE)) {\n    console.log(\"\\x1b[33m[AVISO]\\x1b[0m Nenhum arquivo de trava 'tests/.freeze-lock.json' encontrado. Execute '--lock' primeiro.\");\n    return true;\n  }\n\n  const manifest = JSON.parse(fs.readFileSync(LOCK_FILE, \"utf8\"));\n  const currentProtectedFiles = collectProtectedFiles();\n  const lockedFiles = Object.keys(manifest.files ?? {}).sort(comparePath);\n  let hasViolation = false;\n\n  console.log(\"============================================================\");\n  console.log(\"  Verificando Integridade de Módulos Congelados            \");\n  console.log(\"============================================================\");\n  console.log(\"Fonte: scripts/architecture/module-map.mjs\\n\");\n\n  if (manifest.moduleMapSchemaVersion !== MODULE_MAP_SCHEMA_VERSION) {\n    console.log(\n      `\\x1b[31m[VIOLAÇÃO DETECTADA]\\x1b[0m O lock usa moduleMapSchemaVersion=${String(manifest.moduleMapSchemaVersion)}, ` +\n      `mas o catálogo atual usa ${String(MODULE_MAP_SCHEMA_VERSION)}.`,\n    );\n    hasViolation = true;\n  }\n\n  const currentSet = new Set(currentProtectedFiles);\n  const lockedSet = new Set(lockedFiles);\n\n  const missingFromLock = currentProtectedFiles.filter((relPath) => !lockedSet.has(relPath));\n  const staleInLock = lockedFiles.filter((relPath) => !currentSet.has(relPath));\n\n  if (missingFromLock.length > 0) {\n    hasViolation = true;\n    for (const relPath of missingFromLock) {\n      console.log(`\\x1b[31m[ERRO DE CONGELAMENTO]\\x1b[0m Arquivo canônico não está no lock: ${relPath}`);\n    }\n  }\n\n  if (staleInLock.length > 0) {\n    hasViolation = true;\n    for (const relPath of staleInLock) {\n      console.log(`\\x1b[31m[ERRO DE CONGELAMENTO]\\x1b[0m Path obsoleto permanece no lock: ${relPath}`);\n    }\n  }\n\n  for (const [relPath, expectedHash] of Object.entries(manifest.files ?? {})) {\n    const currentHash = calculateHash(relPath);\n    if (!currentHash) {\n      console.log(`\\x1b[31m[ERRO DE CONGELAMENTO]\\x1b[0m Arquivo removido: ${relPath}`);\n      hasViolation = true;\n    } else if (currentHash !== expectedHash) {\n      console.log(`\\x1b[31m[VIOLAÇÃO DETECTADA]\\x1b[0m O arquivo congelado '${relPath}' foi alterado!`);\n      hasViolation = true;\n    } else {\n      console.log(`\\x1b[32m[ÍNTEGRO]\\x1b[0m ${relPath}`);\n    }\n  }\n\n  if (hasViolation) {\n    console.log(\"\\n\\x1b[31m[BLOQUEIO DE BUILD] Modificações não autorizadas ou drift do catálogo foram detectados!\\x1b[0m\");\n    console.log(\"Para atualizar legitimamente o código, desbloqueie antes da alteração e regenere o lock na etapa apropriada.\\n\");\n    process.exit(1);\n  }\n\n  console.log(\"\\n\\x1b[32mTodos os módulos congelados estão protegidos e íntegros.\\x1b[0m\\n\");\n  return true;\n}\n\nconst args = process.argv.slice(2);\nconst isLock = args.includes(\"--lock\");\nconst isUnlock = args.includes(\"--unlock\");\n\nif (isLock && isUnlock) {\n  console.error(\"[ERRO] --lock e --unlock são mutuamente exclusivos.\");\n  process.exit(1);\n}\n\nconst unknownArgs = args.filter((arg) => arg !== \"--lock\" && arg !== \"--unlock\");\nif (unknownArgs.length > 0) {\n  console.error(`[ERRO] Argumento(s) desconhecido(s): ${unknownArgs.join(\", \")}`);\n  process.exit(1);\n}\n\nif (isLock) {\n  lock();\n} else if (isUnlock) {\n  if (fs.existsSync(LOCK_FILE)) {\n    fs.unlinkSync(LOCK_FILE);\n    console.log(\"\\x1b[33m[DESBLOQUEADO]\\x1b[0m Trava de imutabilidade removida temporariamente.\");\n  } else {\n    console.log(\"\\x1b[33m[DESBLOQUEADO]\\x1b[0m Nenhuma trava ativa em tests/.freeze-lock.json.\");\n  }\n} else {\n  verify();\n}\n"
};

function normalize(text) {
  return text.replace(/\r\n/g, "\n");
}

function fail(message) {
  console.error(`[${STAGE}] ERRO: ${message}`);
  process.exit(1);
}

function parseArgs(args) {
  if (args.length === 0 || (args.length === 1 && args[0] === "--check")) {
    return "check";
  }
  if (args.length === 1 && args[0] === "--apply") {
    return "apply";
  }
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    console.log(`
Projeto1 — Etapa 24: migração do .freeze-lock.json

Uso:
  node scripts/architecture/stage24-migrate-freeze-lock.mjs --check
  node scripts/architecture/stage24-migrate-freeze-lock.mjs --apply

Escopo exato:
  - agents.mjs
  - tests/freeze-lock.mjs
  - migração one-shot de tests/.freeze-lock.json para /.freeze-lock.json, se o legado existir

A Etapa 24:
  - torna /.freeze-lock.json o path canônico;
  - preserva o conteúdo/hashes de um lock legado existente ao movê-lo;
  - mantém compatibilidade temporária: freeze-lock converte o path antigo uma única vez;
  - bloqueia se os dois locks existirem simultaneamente;
  - não executa --lock automaticamente.

A Etapa 24 NÃO:
  - altera smoke tests (Etapa 25);
  - altera README/AGENTS operacionais (Etapa 26);
  - regenera o freeze (Etapa 39).
`);
    process.exit(0);
  }
  fail(`argumentos inválidos: ${args.join(" ")}`);
}

function assertProjectShape() {
  for (const rel of Object.keys(TARGETS)) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      fail(`arquivo obrigatório ausente: ${rel}`);
    }
  }
}

function currentText(rel) {
  return normalize(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

function classify(rel) {
  const current = currentText(rel);
  if (current === normalize(TARGETS[rel])) return "target";
  if (current === normalize(STAGE23[rel])) return "stage23";
  return "unexpected";
}

function inspectLockState() {
  const canonical = fs.existsSync(CANONICAL_LOCK);
  const legacy = fs.existsSync(LEGACY_LOCK);

  if (canonical && legacy) return "conflict";
  if (legacy) return "legacy";
  if (canonical) return "canonical";
  return "none";
}

function validateLegacyJson() {
  if (!fs.existsSync(LEGACY_LOCK)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(LEGACY_LOCK, "utf8"));
    if (!parsed || typeof parsed !== "object" || typeof parsed.files !== "object") {
      fail("tests/.freeze-lock.json legado não possui formato de manifest esperado.");
    }
  } catch (error) {
    fail(`tests/.freeze-lock.json legado é JSON inválido: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function pendingFiles() {
  return Object.keys(TARGETS).filter((rel) => classify(rel) !== "target");
}

function assertSourcesSupported() {
  for (const rel of Object.keys(TARGETS)) {
    const state = classify(rel);
    if (state === "unexpected") {
      fail(`estado inesperado em ${rel}; a Etapa 24 exige a saída da Etapa 23 ou a própria saída da Etapa 24.`);
    }
  }
}

function writeAtomically(changes) {
  const backups = new Map();
  const written = [];
  try {
    for (const rel of changes) {
      const full = path.join(ROOT, rel);
      backups.set(rel, fs.readFileSync(full));
      const temp = `${full}.stage24.tmp`;
      fs.writeFileSync(temp, TARGETS[rel], "utf8");
      fs.renameSync(temp, full);
      written.push(rel);
    }
  } catch (error) {
    for (const rel of written.reverse()) {
      const backup = backups.get(rel);
      if (backup) fs.writeFileSync(path.join(ROOT, rel), backup);
    }
    throw error;
  }
}

function migrateLegacyLock() {
  const state = inspectLockState();
  if (state === "conflict") {
    fail("existem simultaneamente /.freeze-lock.json e tests/.freeze-lock.json; migração ambígua.");
  }
  if (state !== "legacy") return false;

  validateLegacyJson();
  const before = fs.readFileSync(LEGACY_LOCK);
  fs.renameSync(LEGACY_LOCK, CANONICAL_LOCK);
  const after = fs.readFileSync(CANONICAL_LOCK);

  if (!before.equals(after)) {
    try {
      fs.renameSync(CANONICAL_LOCK, LEGACY_LOCK);
    } catch {
      // Não mascara a falha principal.
    }
    fail("conteúdo do freeze lock mudou durante a migração.");
  }

  return true;
}

const mode = parseArgs(process.argv.slice(2));
assertProjectShape();
assertSourcesSupported();

let lockState = inspectLockState();
if (lockState === "conflict") {
  fail("existem simultaneamente /.freeze-lock.json e tests/.freeze-lock.json; resolva a ambiguidade.");
}

let pending = pendingFiles();
const lockPending = lockState === "legacy";

console.log(`[${STAGE}] modo ${mode}${mode === "check" ? " (read-only)" : ""}`);
console.log(`Arquivos no escopo: ${Object.keys(TARGETS).length}`);
console.log(`Arquivos pendentes: ${pending.length}`);
for (const rel of pending) console.log(`  PENDENTE ${rel}`);
console.log(`Estado do freeze lock: ${lockState}`);
if (lockPending) {
  console.log("  PENDENTE tests/.freeze-lock.json -> /.freeze-lock.json");
}

if (mode === "check") {
  if (pending.length === 0 && !lockPending) {
    console.log("Etapa 24 já está instalada e idempotente.");
  } else {
    console.log("Etapa 24 ainda precisa ser aplicada.");
  }
  process.exit(0);
}

if (pending.length > 0) {
  try {
    writeAtomically(pending);
  } catch (error) {
    fail(error instanceof Error ? error.stack ?? error.message : String(error));
  }
}

const migrated = migrateLegacyLock();

pending = pendingFiles();
lockState = inspectLockState();

if (pending.length > 0) {
  fail(`aplicação não convergiu; arquivos pendentes: ${pending.join(", ")}`);
}
if (lockState === "legacy" || lockState === "conflict") {
  fail(`aplicação não convergiu; estado do lock: ${lockState}`);
}

const freezeLock = currentText("tests/freeze-lock.mjs");
if (!freezeLock.includes('const LOCK_FILE = path.join(ROOT_DIR, ".freeze-lock.json");')) {
  fail("freeze-lock.mjs não usa /.freeze-lock.json como path canônico.");
}
if (!freezeLock.includes('const LEGACY_LOCK_FILE = path.join(TESTS_DIR, ".freeze-lock.json");')) {
  fail("compatibilidade temporária com o path legado não foi instalada.");
}
if (!freezeLock.includes("migrateLegacyLockIfNeeded();")) {
  fail("conversão one-shot do lock legado não foi instalada.");
}

console.log(`[${STAGE}] aplicado com sucesso.`);
console.log(`Arquivos alterados/criados: ${Object.keys(TARGETS).length}`);
for (const rel of Object.keys(TARGETS)) console.log(`  OK ${rel}`);
if (migrated) {
  console.log("Lock legado migrado preservando os bytes do manifest.");
} else if (lockState === "canonical") {
  console.log("Lock canônico já existe em /.freeze-lock.json.");
} else {
  console.log("Nenhum lock existente para mover; /.freeze-lock.json passa a ser o path canônico.");
}
console.log("Etapa 24 não regenerou hashes e não executou --lock.");
