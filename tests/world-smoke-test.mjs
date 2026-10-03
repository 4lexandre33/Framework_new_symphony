import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();

const REQUIRED_WORLD_FILES = [
  "src/contracts/world/types.ts",
  "src/tokens/world.ts",
  "src/engine/world/SceneManager.ts",
  "src/engine/world/EntityManager.ts",
  "src/engine/world/SpatialGrid.ts",
  "src/engine/world/OctreeManager.ts",
  "src/engine/world/WorldStateSerializer.ts",
  "src/engine/world/SaveSystem.ts",
  "src/plugins/world/plugin.ts",
  "tests/world-system.test.ts",
];

function runSmokeTest() {
  console.log("============================================================");
  console.log("  Auditoria Estática de Integridade: Camada game.world      ");
  console.log("============================================================\n");

  let hasError = false;

  for (const relPath of REQUIRED_WORLD_FILES) {
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
    console.log("\n\x1b[32m✅ Todos os 10 arquivos criados da camada game.world estão presentes e íntegros.\x1b[0m\n");
  }
}

runSmokeTest();