import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();

const REQUIRED_CAMERA_FILES = [
  "src/contracts/camera/types.ts",
  "src/tokens/camera.ts",
  "src/engine/camera/internal/SpringArm3D.ts",
  "src/engine/camera/internal/TraumaCameraShake.ts",
  "src/engine/camera/internal/VirtualCameraStack.ts",
  "src/engine/camera/internal/CameraOcclusionDetector.ts",
  "src/plugins/camera/plugin.ts",
  "tests/camera-system.test.ts",
];

function runSmokeTest() {
  console.log("============================================================");
  console.log("  Auditoria Estática de Integridade: Camada game.camera     ");
  console.log("============================================================\n");

  let hasError = false;

  for (const relPath of REQUIRED_CAMERA_FILES) {
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
    console.log("\n\x1b[32m✅ Todos os 8 arquivos criados da camada game.camera estão presentes e íntegros.\x1b[0m\n");
  }
}

runSmokeTest();