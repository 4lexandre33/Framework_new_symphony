import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const failures = [];
const successes = [];

const REQUIRED_STREAMING_FILES = [
  "src/contracts/streaming/types.ts",
  "src/tokens/streaming.ts",
  "src/engine/streaming/DistanceLODManager.ts",
  "src/engine/streaming/WorldStreamingSectorManager.ts",
  "src/engine/streaming/HLODBuilder.ts",
  "src/engine/streaming/StreamingWorkerPool.ts",
  "src/engine/streaming/streaming.worker.ts",
  "src/plugins/streaming/plugin.ts",
  "tests/streaming-system.test.ts",
];

function read(relativePath) {
  const fullPath = path.join(ROOT_DIR, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, "utf8").replace(/\r\n/g, "\n");
}

function checkFile(relativePath) {
  const fullPath = path.join(ROOT_DIR, relativePath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    failures.push(`Arquivo obrigatório ausente: ${relativePath}`);
    return;
  }
  successes.push(`${relativePath} (${fs.statSync(fullPath).size} bytes)`);
}

function checkContains(relativePath, fragment, description) {
  const content = read(relativePath);
  if (!content || !content.includes(fragment)) {
    failures.push(`${relativePath}: ${description}`);
    return;
  }
  successes.push(`${relativePath}: ${description}`);
}

console.log("============================================================");
console.log("  Auditoria Estática de Integridade: Camada game.streaming ");
console.log("============================================================\n");

for (const file of REQUIRED_STREAMING_FILES) checkFile(file);

checkContains(
  "src/engine/streaming/StreamingWorkerPool.ts",
  "this.workerLimit = this.normalizeWorkerLimit(maxWorkers)",
  "maxWorkers controla efetivamente o pool",
);
checkContains(
  "src/plugins/streaming/plugin.ts",
  "SetStreamingRadiusCommand.type",
  "handler do comando de raio usa contrato tipado",
);
checkContains(
  "src/plugins/streaming/plugin.ts",
  "ctx.caps.require(CameraToken)",
  "camera é resolvida somente em lifecycle.onBoot",
);
checkContains(
  "src/plugins/streaming/plugin.ts",
  "payload.deltaSeconds",
  "tick preserva deltaSeconds real",
);

console.log("\n--- Resultados ---");
for (const success of successes) console.log(`\x1b[32m[OK]\x1b[0m ${success}`);

if (failures.length > 0) {
  console.log("\n--- Erros Encontrados ---");
  for (const failure of failures) console.log(`\x1b[31m[ERRO]\x1b[0m ${failure}`);
  console.log("\n\x1b[31m❌ A camada game.streaming precisa de ajustes.\x1b[0m\n");
  process.exitCode = 1;
} else {
  console.log("\n\x1b[32m✅ Camada game.streaming íntegra.\x1b[0m\n");
}
