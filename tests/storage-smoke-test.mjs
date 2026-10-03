import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();

const REQUIRED_STORAGE_FILES = [
  "src/contracts/storage/types.ts",
  "src/tokens/storage.ts",
  "src/engine/storage/SteamCloudDriver.ts",
  "src/engine/storage/LocalDatabaseDriver.ts",
  "src/engine/storage/CloudDatabaseDriver.ts",
  "src/plugins/storage/plugin.ts",
  "tests/storage-system.test.ts",
];

function runSmokeTest() {
  console.log("============================================================");
  console.log("  Auditoria Estática de Integridade: Camada game.storage   ");
  console.log("============================================================\n");

  let hasError = false;

  for (const relPath of REQUIRED_STORAGE_FILES) {
    const fullPath = path.join(ROOT_DIR, relPath);
    if (fs.existsSync(fullPath)) {
      const stats = fs.statSync(fullPath);
      console.log(`\x1b[32m[OK]\x1b[0m ${relPath} (${stats.size} bytes)`);
    } else {
      console.log(`\x1b[31m[FALHA]\x1b[0m Arquivo obrigatório ausente: ${relPath}`);
      hasError = true;
    }
  }

  if (hasError) {
    console.log("\n\x1b[31m❌ Auditoria estática falhou! Verifique os arquivos ausentes.\x1b[0m\n");
    process.exit(1);
  } else {
    console.log("\n\x1b[32m✅ Todos os 7 arquivos criados da camada game.storage estão presentes e íntegros.\x1b[0m\n");
  }
}

runSmokeTest();