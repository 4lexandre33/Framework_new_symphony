import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();

const REQUIRED_SPRITES_FILES = [
  "src/contracts/sprites/types.ts",
  "src/tokens/sprites.ts",
  "src/engine/sprites/internal/TextureAtlasParser.ts",
  "src/engine/sprites/internal/InstancedTilemapRenderer.ts",
  "src/engine/sprites/internal/ParallaxController.ts",
  "src/engine/sprites/internal/PixelArtScaler.ts",
  "src/engine/sprites/internal/Sprite2DRenderer.ts",
  "src/plugins/sprites/plugin.ts",
  "tests/sprites-system.test.ts",
];

function runSmokeTest() {
  console.log("============================================================");
  console.log("  Auditoria Estática de Integridade: Camada game.sprites    ");
  console.log("============================================================\n");

  let hasError = false;

  for (const relPath of REQUIRED_SPRITES_FILES) {
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
    console.log("\n\x1b[32m✅ Todos os 9 arquivos criados da camada game.sprites estão presentes e íntegros.\x1b[0m\n");
  }
}

runSmokeTest();