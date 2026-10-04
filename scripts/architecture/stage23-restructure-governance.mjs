#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const STAGE = "stage-23-governance-module-map";
const ROOT = process.cwd();

const TARGETS = {
  "AGENTS.md": "# Diretivas Arquiteturais e Invariantes do Projeto (AGENTS.md)\n\nEste documento define os limites de autoridade para agentes de IA, assistentes de código e scripts de automação que operam neste repositório.\n\n## Fonte canônica da arquitetura\n\nA árvore de módulos **não deve ser duplicada manualmente neste arquivo nem nos scripts de freeze**.\n\nA fonte única dos módulos first-party é:\n\n```text\nscripts/architecture/module-map.mjs\n```\n\nO catálogo canônico define os módulos funcionais e runtimes, seus contratos, tokens, plugin, arquivos nativos, testes, arquivos extras e os roots físicos de Engine:\n\n```text\nsrc/engine/<module>/public/\nsrc/engine/<module>/internal/\n```\n\nQualquer automação que precise conhecer a árvore modular deve importar o `module-map.mjs` em vez de manter listas próprias de paths.\n\n## Freeze de módulos\n\nO freeze é controlado por:\n\n```text\ntests/freeze-lock.mjs\ntests/freeze-invariants.mjs\n```\n\nNesta etapa, o lock permanece em:\n\n```text\ntests/.freeze-lock.json\n```\n\nA migração desse arquivo para a raiz pertence à Etapa 24 e não deve ser antecipada.\n\n`tests/freeze-lock.mjs` deriva do `module-map.mjs`:\n\n- contracts;\n- tokens;\n- plugin;\n- native files;\n- tests;\n- extra files;\n- arquivos reais existentes dentro de `engine.root`, incluindo `/public` e `/internal`.\n\nArquivos de host compartilhados que não pertencem a um único módulo podem permanecer como guardrails globais explícitos.\n\n## Regras para agentes e automações\n\n1. Não hard-code novamente a árvore completa `src/engine/<module>/...` em scripts de governança.\n2. Não trate paths históricos diretamente em `src/engine/<module>/*.ts` como arquitetura vigente.\n3. Use `module-map.mjs` para descobrir módulos, roots e ownership.\n4. Não mova `tests/.freeze-lock.json` nesta etapa.\n5. Não afrouxe invariantes para tornar uma checagem verde.\n6. Não reexporte implementações de `/internal` por fachadas `/public`.\n7. Testes white-box podem acessar `/internal` quando isso for deliberado.\n8. Mudanças em módulos congelados exigem desbloqueio explícito antes da alteração e novo lock apenas na etapa apropriada.\n\n## Comandos de governança\n\nVerificação normal:\n\n```bash\nnode agents.mjs\n```\n\nDesbloqueio controlado:\n\n```bash\nnode agents.mjs --unlock\n```\n\nCongelamento:\n\n```bash\nnode agents.mjs --lock\n```\n\nO orquestrador deve continuar delegando as regras concretas aos scripts de governança, que por sua vez usam o catálogo canônico em `module-map.mjs`.\n",
  "agents.mjs": "#!/usr/bin/env node\nimport { execFileSync } from \"node:child_process\";\nimport { CANONICAL_MODULES } from \"./scripts/architecture/module-map.mjs\";\n\nconst args = process.argv.slice(2);\nconst isLock = args.includes(\"--lock\");\nconst isUnlock = args.includes(\"--unlock\");\n\nif (isLock && isUnlock) {\n  console.error(\"[ERRO] --lock e --unlock são mutuamente exclusivos.\");\n  process.exit(1);\n}\n\nconst unknownArgs = args.filter((arg) => arg !== \"--lock\" && arg !== \"--unlock\");\nif (unknownArgs.length > 0) {\n  console.error(`[ERRO] Argumento(s) desconhecido(s): ${unknownArgs.join(\", \")}`);\n  process.exit(1);\n}\n\nfunction runNode(script, scriptArgs = []) {\n  execFileSync(\n    process.execPath,\n    [script, ...scriptArgs],\n    { stdio: \"inherit\" },\n  );\n}\n\nconsole.log(\"============================================================\");\nconsole.log(\"  AGENTS GUARDRAIL ORCHESTRATOR - PROJETO 1                  \");\nconsole.log(\"============================================================\");\nconsole.log(`Fonte canônica: scripts/architecture/module-map.mjs (${CANONICAL_MODULES.length} módulos)\\n`);\n\nif (isLock) {\n  console.log(\"Congelando módulos a partir do catálogo canônico...\");\n  runNode(\"tests/freeze-lock.mjs\", [\"--lock\"]);\n} else if (isUnlock) {\n  console.log(\"Desbloqueando código congelado para alterações autorizadas...\");\n  runNode(\"tests/freeze-lock.mjs\", [\"--unlock\"]);\n} else {\n  try {\n    runNode(\"tests/freeze-invariants.mjs\");\n    runNode(\"tests/freeze-lock.mjs\");\n    console.log(\"\\x1b[32m[PRONTO PARA DESENVOLVIMENTO]\\x1b[0m Ambiente seguro para os Agentes de IA.\");\n  } catch {\n    console.error(\"\\x1b[31m[EXECUÇÃO BLOQUEADA]\\x1b[0m Corrija as violações antes de prosseguir.\");\n    process.exit(1);\n  }\n}\n",
  "tests/freeze-lock.mjs": "#!/usr/bin/env node\nimport fs from \"node:fs\";\nimport path from \"node:path\";\nimport crypto from \"node:crypto\";\nimport {\n  CANONICAL_MODULES,\n  MODULE_MAP_SCHEMA_VERSION,\n} from \"../scripts/architecture/module-map.mjs\";\n\nconst ROOT_DIR = process.cwd();\nconst TESTS_DIR = path.join(ROOT_DIR, \"tests\");\n\n// Etapa 23: manter o lock no path histórico.\n// A migração para /.freeze-lock.json pertence exclusivamente à Etapa 24.\nconst LOCK_FILE = path.join(TESTS_DIR, \".freeze-lock.json\");\n\nconst SHARED_HOST_FILES = Object.freeze([\n  \"src-tauri/src/lib.rs\",\n  \"src-tauri/Cargo.toml\",\n]);\n\nfunction toPosix(relativePath) {\n  return relativePath.split(path.sep).join(\"/\");\n}\n\nfunction comparePath(a, b) {\n  return a.localeCompare(b, \"en\");\n}\n\nfunction collectFilesRecursively(relativeRoot) {\n  const absoluteRoot = path.join(ROOT_DIR, relativeRoot);\n  if (!fs.existsSync(absoluteRoot)) {\n    return [];\n  }\n\n  const stat = fs.statSync(absoluteRoot);\n  if (!stat.isDirectory()) {\n    return [relativeRoot];\n  }\n\n  const files = [];\n  const stack = [absoluteRoot];\n\n  while (stack.length > 0) {\n    const current = stack.pop();\n    if (!current) continue;\n\n    const entries = fs.readdirSync(current, { withFileTypes: true });\n    entries.sort((a, b) => comparePath(a.name, b.name));\n\n    for (let index = entries.length - 1; index >= 0; index -= 1) {\n      const entry = entries[index];\n      const absolutePath = path.join(current, entry.name);\n\n      if (entry.isDirectory()) {\n        stack.push(absolutePath);\n        continue;\n      }\n\n      if (entry.isFile()) {\n        files.push(toPosix(path.relative(ROOT_DIR, absolutePath)));\n      }\n    }\n  }\n\n  return files.sort(comparePath);\n}\n\nfunction collectDeclaredModuleFiles(moduleRecord) {\n  return [\n    ...moduleRecord.contracts,\n    ...moduleRecord.tokens.map((tokenRecord) => tokenRecord.path),\n    moduleRecord.plugin,\n    ...moduleRecord.nativeFiles,\n    ...moduleRecord.tests,\n    ...moduleRecord.extraFiles,\n  ];\n}\n\nfunction collectProtectedFiles() {\n  const protectedFiles = new Set(SHARED_HOST_FILES);\n\n  for (const moduleRecord of CANONICAL_MODULES) {\n    for (const relPath of collectDeclaredModuleFiles(moduleRecord)) {\n      protectedFiles.add(relPath);\n    }\n\n    for (const relPath of collectFilesRecursively(moduleRecord.engine.root)) {\n      protectedFiles.add(relPath);\n    }\n  }\n\n  return [...protectedFiles].sort(comparePath);\n}\n\nfunction calculateHash(relativePath) {\n  const fullPath = path.join(ROOT_DIR, relativePath);\n  if (!fs.existsSync(fullPath)) return null;\n  const content = fs.readFileSync(fullPath);\n  return crypto.createHash(\"sha256\").update(content).digest(\"hex\");\n}\n\nfunction ensureTestsDirectory() {\n  if (!fs.existsSync(TESTS_DIR)) {\n    fs.mkdirSync(TESTS_DIR, { recursive: true });\n  }\n}\n\nfunction lock() {\n  ensureTestsDirectory();\n\n  console.log(\"============================================================\");\n  console.log(\"  Congelando Módulos Estáveis do Projeto (Freeze Lock)     \");\n  console.log(\"============================================================\");\n  console.log(\"Fonte: scripts/architecture/module-map.mjs\\n\");\n\n  const protectedFiles = collectProtectedFiles();\n  const manifest = {\n    version: \"20.0.0\",\n    moduleMapSchemaVersion: MODULE_MAP_SCHEMA_VERSION,\n    lockedAt: new Date().toISOString(),\n    files: {},\n  };\n\n  let missing = 0;\n\n  for (const relPath of protectedFiles) {\n    const hash = calculateHash(relPath);\n    if (hash) {\n      manifest.files[relPath] = hash;\n      console.log(`\\x1b[32m[CONGELADO]\\x1b[0m ${relPath} (SHA-256: ${hash.substring(0, 12)}...)`);\n    } else {\n      missing += 1;\n      console.log(`\\x1b[31m[ALERTA]\\x1b[0m Arquivo declarado no module-map não encontrado: ${relPath}`);\n    }\n  }\n\n  if (missing > 0) {\n    console.error(`\\n[ERRO] ${missing} arquivo(s) canônico(s) ausente(s). Lock não foi gravado.`);\n    process.exit(1);\n  }\n\n  fs.writeFileSync(LOCK_FILE, JSON.stringify(manifest, null, 2), \"utf8\");\n  console.log(`\\n\\x1b[32mSucesso:\\x1b[0m Trava de imutabilidade gerada em '${LOCK_FILE}'.`);\n}\n\nfunction verify() {\n  if (!fs.existsSync(LOCK_FILE)) {\n    console.log(\"\\x1b[33m[AVISO]\\x1b[0m Nenhum arquivo de trava 'tests/.freeze-lock.json' encontrado. Execute '--lock' primeiro.\");\n    return true;\n  }\n\n  const manifest = JSON.parse(fs.readFileSync(LOCK_FILE, \"utf8\"));\n  const currentProtectedFiles = collectProtectedFiles();\n  const lockedFiles = Object.keys(manifest.files ?? {}).sort(comparePath);\n  let hasViolation = false;\n\n  console.log(\"============================================================\");\n  console.log(\"  Verificando Integridade de Módulos Congelados            \");\n  console.log(\"============================================================\");\n  console.log(\"Fonte: scripts/architecture/module-map.mjs\\n\");\n\n  if (manifest.moduleMapSchemaVersion !== MODULE_MAP_SCHEMA_VERSION) {\n    console.log(\n      `\\x1b[31m[VIOLAÇÃO DETECTADA]\\x1b[0m O lock usa moduleMapSchemaVersion=${String(manifest.moduleMapSchemaVersion)}, ` +\n      `mas o catálogo atual usa ${String(MODULE_MAP_SCHEMA_VERSION)}.`,\n    );\n    hasViolation = true;\n  }\n\n  const currentSet = new Set(currentProtectedFiles);\n  const lockedSet = new Set(lockedFiles);\n\n  const missingFromLock = currentProtectedFiles.filter((relPath) => !lockedSet.has(relPath));\n  const staleInLock = lockedFiles.filter((relPath) => !currentSet.has(relPath));\n\n  if (missingFromLock.length > 0) {\n    hasViolation = true;\n    for (const relPath of missingFromLock) {\n      console.log(`\\x1b[31m[ERRO DE CONGELAMENTO]\\x1b[0m Arquivo canônico não está no lock: ${relPath}`);\n    }\n  }\n\n  if (staleInLock.length > 0) {\n    hasViolation = true;\n    for (const relPath of staleInLock) {\n      console.log(`\\x1b[31m[ERRO DE CONGELAMENTO]\\x1b[0m Path obsoleto permanece no lock: ${relPath}`);\n    }\n  }\n\n  for (const [relPath, expectedHash] of Object.entries(manifest.files ?? {})) {\n    const currentHash = calculateHash(relPath);\n    if (!currentHash) {\n      console.log(`\\x1b[31m[ERRO DE CONGELAMENTO]\\x1b[0m Arquivo removido: ${relPath}`);\n      hasViolation = true;\n    } else if (currentHash !== expectedHash) {\n      console.log(`\\x1b[31m[VIOLAÇÃO DETECTADA]\\x1b[0m O arquivo congelado '${relPath}' foi alterado!`);\n      hasViolation = true;\n    } else {\n      console.log(`\\x1b[32m[ÍNTEGRO]\\x1b[0m ${relPath}`);\n    }\n  }\n\n  if (hasViolation) {\n    console.log(\"\\n\\x1b[31m[BLOQUEIO DE BUILD] Modificações não autorizadas ou drift do catálogo foram detectados!\\x1b[0m\");\n    console.log(\"Para atualizar legitimamente o código, desbloqueie antes da alteração e regenere o lock na etapa apropriada.\\n\");\n    process.exit(1);\n  }\n\n  console.log(\"\\n\\x1b[32mTodos os módulos congelados estão protegidos e íntegros.\\x1b[0m\\n\");\n  return true;\n}\n\nconst args = process.argv.slice(2);\nconst isLock = args.includes(\"--lock\");\nconst isUnlock = args.includes(\"--unlock\");\n\nif (isLock && isUnlock) {\n  console.error(\"[ERRO] --lock e --unlock são mutuamente exclusivos.\");\n  process.exit(1);\n}\n\nconst unknownArgs = args.filter((arg) => arg !== \"--lock\" && arg !== \"--unlock\");\nif (unknownArgs.length > 0) {\n  console.error(`[ERRO] Argumento(s) desconhecido(s): ${unknownArgs.join(\", \")}`);\n  process.exit(1);\n}\n\nif (isLock) {\n  lock();\n} else if (isUnlock) {\n  if (fs.existsSync(LOCK_FILE)) {\n    fs.unlinkSync(LOCK_FILE);\n    console.log(\"\\x1b[33m[DESBLOQUEADO]\\x1b[0m Trava de imutabilidade removida temporariamente.\");\n  } else {\n    console.log(\"\\x1b[33m[DESBLOQUEADO]\\x1b[0m Nenhuma trava ativa em tests/.freeze-lock.json.\");\n  }\n} else {\n  verify();\n}\n",
  "tests/freeze-invariants.mjs": "#!/usr/bin/env node\nimport fs from \"node:fs\";\nimport path from \"node:path\";\nimport {\n  CANONICAL_MODULES,\n  FUNCTIONAL_MODULES,\n  RUNTIME_MODULES,\n  getCanonicalModule,\n} from \"../scripts/architecture/module-map.mjs\";\n\nconst ROOT_DIR = process.cwd();\nconst violations = [];\n\nfunction exists(relativePath) {\n  return fs.existsSync(path.join(ROOT_DIR, relativePath));\n}\n\nfunction checkFile(relativePath, description) {\n  if (!exists(relativePath)) {\n    violations.push(`Arquivo essencial ausente (${description}): ${relativePath}`);\n  }\n}\n\nfunction checkDirectory(relativePath, description) {\n  const fullPath = path.join(ROOT_DIR, relativePath);\n  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {\n    violations.push(`Diretório essencial ausente (${description}): ${relativePath}`);\n  }\n}\n\nfunction checkSnippet(relativePath, snippet, description) {\n  const fullPath = path.join(ROOT_DIR, relativePath);\n  if (!fs.existsSync(fullPath)) {\n    violations.push(`Arquivo essencial ausente: ${relativePath}`);\n    return;\n  }\n\n  const content = fs.readFileSync(fullPath, \"utf8\");\n  if (!content.includes(snippet)) {\n    violations.push(`Invariante violada em ${relativePath}: ausência de '${description}'`);\n  }\n}\n\nconsole.log(\"============================================================\");\nconsole.log(\"  Auditoria de Invariantes Arquiteturais do Projeto          \");\nconsole.log(\"============================================================\");\nconsole.log(\"Fonte: scripts/architecture/module-map.mjs\\n\");\n\nif (FUNCTIONAL_MODULES.length !== 20) {\n  violations.push(`module-map deve declarar 20 módulos funcionais; encontrou ${FUNCTIONAL_MODULES.length}`);\n}\n\nif (RUNTIME_MODULES.length !== 3) {\n  violations.push(`module-map deve declarar 3 runtimes fundamentais; encontrou ${RUNTIME_MODULES.length}`);\n}\n\nif (CANONICAL_MODULES.length !== 23) {\n  violations.push(`module-map deve declarar 23 módulos canônicos; encontrou ${CANONICAL_MODULES.length}`);\n}\n\nconst keys = new Set();\nconst capabilities = new Set();\n\nfor (const moduleRecord of CANONICAL_MODULES) {\n  if (keys.has(moduleRecord.key)) {\n    violations.push(`Chave de módulo duplicada no module-map: ${moduleRecord.key}`);\n  }\n  keys.add(moduleRecord.key);\n\n  if (capabilities.has(moduleRecord.capabilityId)) {\n    violations.push(`Capability primária duplicada no module-map: ${moduleRecord.capabilityId}`);\n  }\n  capabilities.add(moduleRecord.capabilityId);\n\n  checkDirectory(moduleRecord.engine.root, `engine.root de ${moduleRecord.key}`);\n  checkDirectory(moduleRecord.engine.publicRoot, `publicRoot de ${moduleRecord.key}`);\n  checkDirectory(moduleRecord.engine.internalRoot, `internalRoot de ${moduleRecord.key}`);\n\n  for (const contractPath of moduleRecord.contracts) {\n    checkFile(contractPath, `contract de ${moduleRecord.key}`);\n  }\n\n  for (const tokenRecord of moduleRecord.tokens) {\n    checkFile(tokenRecord.path, `token de ${moduleRecord.key}`);\n  }\n\n  checkFile(moduleRecord.plugin, `plugin de ${moduleRecord.key}`);\n\n  for (const nativePath of moduleRecord.nativeFiles) {\n    checkFile(nativePath, `native file de ${moduleRecord.key}`);\n  }\n\n  for (const testPath of moduleRecord.tests) {\n    checkFile(testPath, `teste de ${moduleRecord.key}`);\n  }\n\n  for (const extraPath of moduleRecord.extraFiles) {\n    checkFile(extraPath, `extra file de ${moduleRecord.key}`);\n  }\n}\n\n// Invariantes semânticas históricas da Steam são preservadas,\n// mas os paths pertencentes ao módulo vêm do catálogo canônico.\nconst steam = getCanonicalModule(\"steam\");\nif (!steam) {\n  violations.push(\"Módulo canônico 'steam' ausente do module-map.\");\n} else {\n  const steamNative = steam.nativeFiles.find((filePath) => filePath.endsWith(\"/steam.rs\"));\n  if (!steamNative) {\n    violations.push(\"module-map do Steam não declara src-tauri/src/steam.rs.\");\n  } else {\n    checkSnippet(steamNative, 'serde(rename_all = \"camelCase\")', \"Serialização camelCase nos DTOs\");\n    checkSnippet(steamNative, \"client.user_stats()\", \"Uso do método oficial user_stats() do Rust\");\n  }\n\n  checkSnippet(steam.plugin, \"SteamToken\", \"Registro do Token de Capability da Steam\");\n  checkSnippet(steam.plugin, \"BossDefeatedEvent\", \"Definição do evento de chefe no Kernel\");\n}\n\ncheckSnippet(\"src-tauri/src/lib.rs\", \"steamworks::Client::init_app\", \"Inicialização via init_app(480)\");\ncheckSnippet(\"src-tauri/src/lib.rs\", \"thread::spawn\", \"Thread dedicada de callbacks da Steam\");\n\nif (violations.length > 0) {\n  console.log(\"\\x1b[31m[FALHA NAS INVARIANTES]\\x1b[0m Foram encontradas quebras de contrato no código:\");\n  for (const violation of violations) {\n    console.log(`  - \\x1b[31m${violation}\\x1b[0m`);\n  }\n  console.log();\n  process.exit(1);\n}\n\nconsole.log(\n  `\\x1b[32m[SUCESSO]\\x1b[0m ${CANONICAL_MODULES.length} módulos validados a partir do module-map; ` +\n  \"invariantes arquiteturais respeitadas.\\n\",\n);\n"
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
Projeto1 — Etapa 23: reestruturação dos arquivos de governança

Uso:
  node scripts/architecture/stage23-restructure-governance.mjs --check
  node scripts/architecture/stage23-restructure-governance.mjs --apply

Escopo exato:
  - AGENTS.md
  - agents.mjs
  - tests/freeze-lock.mjs
  - tests/freeze-invariants.mjs

A Etapa 23:
  - usa scripts/architecture/module-map.mjs como fonte única da árvore modular;
  - remove listas manuais de src/engine/<modulo> dos guardrails;
  - faz o freeze descobrir /public e /internal pelos roots canônicos;
  - preserva as invariantes semânticas Steam existentes;
  - mantém tests/.freeze-lock.json no path atual.

A Etapa 23 NÃO:
  - move .freeze-lock.json para a raiz (Etapa 24);
  - atualiza smoke tests gerais (Etapa 25);
  - integra boundary/dependency checker ao agents.mjs (etapas posteriores);
  - executa --lock automaticamente.
`);
    process.exit(0);
  }
  fail(`argumentos inválidos: ${args.join(" ")}`);
}

function assertProjectShape() {
  const required = [
    "scripts/architecture/module-map.mjs",
    "AGENTS.md",
    "agents.mjs",
    "tests/freeze-lock.mjs",
    "tests/freeze-invariants.mjs",
  ];

  for (const rel of required) {
    if (!fs.existsSync(path.join(ROOT, rel))) {
      fail(`arquivo obrigatório ausente: ${rel}`);
    }
  }

  const moduleMap = normalize(
    fs.readFileSync(path.join(ROOT, "scripts/architecture/module-map.mjs"), "utf8"),
  );

  for (const marker of [
    "export const CANONICAL_MODULES",
    "export const FUNCTIONAL_MODULES",
    "export const RUNTIME_MODULES",
    "export function getCanonicalModule",
  ]) {
    if (!moduleMap.includes(marker)) {
      fail(`module-map incompatível; marcador ausente: ${marker}`);
    }
  }
}

function currentText(rel) {
  const full = path.join(ROOT, rel);
  return fs.existsSync(full) ? normalize(fs.readFileSync(full, "utf8")) : null;
}

function pendingFiles() {
  return Object.entries(TARGETS)
    .filter(([rel, expected]) => currentText(rel) !== normalize(expected))
    .map(([rel]) => rel);
}

function writeAtomically(changes) {
  const backups = new Map();
  const written = [];

  try {
    for (const rel of changes) {
      const full = path.join(ROOT, rel);
      const existed = fs.existsSync(full);
      backups.set(rel, existed ? fs.readFileSync(full) : null);
      fs.mkdirSync(path.dirname(full), { recursive: true });

      const temp = `${full}.stage23.tmp`;
      fs.writeFileSync(temp, TARGETS[rel], "utf8");
      fs.renameSync(temp, full);
      written.push(rel);
    }
  } catch (error) {
    for (const rel of written.reverse()) {
      const full = path.join(ROOT, rel);
      const backup = backups.get(rel);
      try {
        if (backup === null) {
          fs.rmSync(full, { force: true });
        } else if (backup !== undefined) {
          fs.writeFileSync(full, backup);
        }
      } catch {
        // Não mascara o erro original.
      }
    }
    throw error;
  }
}

const mode = parseArgs(process.argv.slice(2));
assertProjectShape();

let pending = pendingFiles();

console.log(`[${STAGE}] modo ${mode}${mode === "check" ? " (read-only)" : ""}`);
console.log(`Arquivos no escopo: ${Object.keys(TARGETS).length}`);
console.log(`Arquivos pendentes: ${pending.length}`);
for (const rel of pending) {
  console.log(`  PENDENTE ${rel}`);
}

if (mode === "check") {
  if (pending.length === 0) {
    console.log("Etapa 23 já está instalada e idempotente.");
  } else {
    console.log("Etapa 23 ainda precisa ser aplicada.");
  }
  process.exit(0);
}

if (pending.length === 0) {
  console.log("Nenhuma alteração necessária.");
  process.exit(0);
}

try {
  writeAtomically(pending);
} catch (error) {
  fail(error instanceof Error ? error.stack ?? error.message : String(error));
}

pending = pendingFiles();
if (pending.length > 0) {
  fail(`aplicação não convergiu; pendentes: ${pending.join(", ")}`);
}

// Guardrails explícitos contra antecipar etapas futuras.
const freezeLock = normalize(fs.readFileSync(path.join(ROOT, "tests/freeze-lock.mjs"), "utf8"));
if (!freezeLock.includes('const LOCK_FILE = path.join(TESTS_DIR, ".freeze-lock.json");')) {
  fail("tests/.freeze-lock.json deixou de ser preservado; isso pertence à Etapa 24.");
}
if (freezeLock.includes('const PROTECTED_FILES = [')) {
  fail("lista manual PROTECTED_FILES ainda existe.");
}
if (!freezeLock.includes('from "../scripts/architecture/module-map.mjs"')) {
  fail("freeze-lock não importa a fonte canônica module-map.mjs.");
}

const invariants = normalize(fs.readFileSync(path.join(ROOT, "tests/freeze-invariants.mjs"), "utf8"));
if (!invariants.includes('from "../scripts/architecture/module-map.mjs"')) {
  fail("freeze-invariants não importa a fonte canônica module-map.mjs.");
}

console.log(`[${STAGE}] aplicado com sucesso.`);
console.log(`Arquivos alterados/criados: ${Object.keys(TARGETS).length - pending.length}`);
for (const rel of Object.keys(TARGETS)) {
  console.log(`  OK ${rel}`);
}
console.log("Árvore modular de governança agora deriva de scripts/architecture/module-map.mjs.");
console.log("tests/.freeze-lock.json preservado para a Etapa 24.");
