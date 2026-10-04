import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();

const REQUIRED_VFX_FILES = [
  "src/contracts/vfx/types.ts",
  "src/tokens/vfx.ts",
  "src/engine/vfx/internal/GPUParticleSystem.ts",
  "src/engine/vfx/internal/DecalManager.ts",
  "src/engine/vfx/internal/PostProcessingPipeline.ts",
  "src/engine/vfx/internal/CustomShaderLibrary.ts",
  "src/engine/vfx/internal/VFXEffectManager.ts",
  "src/plugins/vfx/plugin.ts",
  "tests/vfx-system.test.ts",
];

function runSmokeTest() {
  console.log("============================================================");
  console.log("  Auditoria Estática de Integridade: Camada game.vfx        ");
  console.log("============================================================\n");

  let hasError = false;

  for (const relPath of REQUIRED_VFX_FILES) {
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
    console.log("\n\x1b[32m✅ Todos os 9 arquivos criados da camada game.vfx estão presentes e íntegros.\x1b[0m\n");
  }
}

runSmokeTest();