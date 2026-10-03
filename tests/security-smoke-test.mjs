import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();

const REQUIRED_SECURITY_FILES = [
  "src/contracts/security/types.ts",
  "src/tokens/security.ts",
  "src/engine/security/FrameProfiler.ts",
  "src/engine/security/MemoryIntegrityGuard.ts",
  "src/engine/security/CrashReportDumper.ts",
  "src/engine/security/TauriSecurityDriver.ts",
  "src-tauri/src/security.rs",
  "src/plugins/security/plugin.ts",
  "tests/security-system.test.ts",
];

const successes = [];
const failures = [];

function resolveProjectPath(relativePath) {
  return path.join(ROOT_DIR, relativePath);
}

function normalizeText(content) {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function readProjectFile(relativePath) {
  const fullPath = resolveProjectPath(relativePath);
  if (!fs.existsSync(fullPath)) return null;
  return normalizeText(fs.readFileSync(fullPath, "utf8"));
}

function checkFileExists(relativePath) {
  const fullPath = resolveProjectPath(relativePath);

  if (!fs.existsSync(fullPath)) {
    failures.push(`Arquivo obrigatório ausente: ${relativePath}`);
    return;
  }

  const stats = fs.statSync(fullPath);

  if (!stats.isFile() || stats.size === 0) {
    failures.push(`Arquivo inválido ou vazio: ${relativePath}`);
    return;
  }

  successes.push(`${relativePath} (${stats.size} bytes)`);
}

function checkContains(relativePath, fragment, description) {
  const content = readProjectFile(relativePath);

  if (content === null) {
    failures.push(`Arquivo não encontrado: ${relativePath}`);
    return;
  }

  if (!content.includes(fragment)) {
    failures.push(`${relativePath}: não contém ${description}.`);
    return;
  }

  successes.push(`${relativePath}: ${description}`);
}

function checkDoesNotContain(relativePath, fragment, description) {
  const content = readProjectFile(relativePath);

  if (content === null) {
    failures.push(`Arquivo não encontrado: ${relativePath}`);
    return;
  }

  if (content.includes(fragment)) {
    failures.push(`${relativePath}: ainda contém ${description}.`);
    return;
  }

  successes.push(`${relativePath}: sem ${description}`);
}

function checkMatches(relativePath, expression, description) {
  const content = readProjectFile(relativePath);

  if (content === null) {
    failures.push(`Arquivo não encontrado: ${relativePath}`);
    return;
  }

  if (!expression.test(content)) {
    failures.push(`${relativePath}: não contém ${description}.`);
    return;
  }

  successes.push(`${relativePath}: ${description}`);
}

function runSmokeTest() {
  console.log("============================================================");
  console.log("  Auditoria Estática de Integridade: Camada game.security");
  console.log("============================================================\n");

  for (const relativePath of REQUIRED_SECURITY_FILES) {
    checkFileExists(relativePath);
  }

  checkContains(
    "src/tokens/security.ts",
    '"game.security"',
    "SecurityToken registrado como game.security",
  );

  checkContains(
    "src/engine/security/FrameProfiler.ts",
    "totalDurationMs",
    "FrameProfiler mantém acumulador real de duração",
  );

  checkContains(
    "src/engine/security/FrameProfiler.ts",
    "existing.maxDurationMs = Math.max",
    "FrameProfiler calcula máximo real",
  );

  checkDoesNotContain(
    "src/engine/security/MemoryIntegrityGuard.ts",
    "f64 = val",
    "atribuição inválida à referência Float64Array",
  );

  checkContains(
    "src/engine/security/MemoryIntegrityGuard.ts",
    "this.scratchFloat64[0] = value",
    "MemoryIntegrityGuard escreve no elemento tipado corretamente",
  );

  checkMatches(
    "src/plugins/security/plugin.ts",
    /dependsOn\s*:\s*\[\s*\{\s*id\s*:\s*["']game\.loop["']\s*,\s*range\s*:\s*["']\^1\.0\.0["']/m,
    "dependência explícita de game.loop",
  );

  checkContains(
    "src/plugins/security/plugin.ts",
    "CaptureFrameMetricsCommand.type",
    "handler de profiling usa o contrato como fonte de verdade",
  );

  checkContains(
    "src/plugins/security/plugin.ts",
    "ValidateMemoryIntegrityCommand.type",
    "handler de validação de memória está implementado",
  );

  checkContains(
    "src/plugins/security/plugin.ts",
    "DumpCrashReportCommand.type",
    "handler de crash dump usa o contrato como fonte de verdade",
  );

  checkDoesNotContain(
    "src/plugins/security/plugin.ts",
    "deltaSeconds || 0.016",
    "fallback que transforma delta zero em 16ms",
  );

  checkDoesNotContain(
    "src-tauri/src/security.rs",
    "static mut LAST_CHECK_INSTANT",
    "estado global mutável inseguro no Rust",
  );

  checkContains(
    "src-tauri/src/security.rs",
    "OnceLock<Mutex<Option<Instant>>>",
    "relógio nativo sincronizado sem static mut",
  );

  checkContains(
    "src-tauri/src/security.rs",
    "validate_crash_id",
    "validação contra path traversal no crash_id",
  );

  checkContains(
    "src/app/bootstrap.ts",
    "SecurityToken",
    "SecurityToken registrado no bootstrap",
  );

  checkContains(
    "src/app/createEnginePlugins.ts",
    "createSecurityPlugin",
    "game.security registrado na composição de plugins",
  );

  checkContains(
    "src/app/EngineServices.ts",
    "security: SecurityApi | null",
    "EngineServices expõe game.security",
  );

  checkContains(
    "src/plugins/debug/plugin.ts",
    "SecurityToken",
    "game.debug resolve SecurityToken",
  );

  checkContains(
    "src/plugins/debug/plugin.ts",
    "StreamingToken",
    "game.debug resolve StreamingToken",
  );

  checkContains(
    "src/plugins/debug/plugin.ts",
    "OverlayToken",
    "game.debug resolve OverlayToken",
  );

  console.log("\n--- Resultados ---");

  for (const success of successes) {
    console.log(`\x1b[32m[OK]\x1b[0m ${success}`);
  }

  if (failures.length > 0) {
    console.log("\n--- Erros Encontrados ---");

    for (const failure of failures) {
      console.log(`\x1b[31m[ERRO]\x1b[0m ${failure}`);
    }

    console.log(
      "\n\x1b[31m❌ A camada game.security precisa de ajustes antes do congelamento.\x1b[0m\n",
    );

    process.exitCode = 1;
    return;
  }

  console.log(
    "\n\x1b[32m✅ Camada game.security íntegra e conectada ao Microkernel.\x1b[0m\n",
  );
}

runSmokeTest();
