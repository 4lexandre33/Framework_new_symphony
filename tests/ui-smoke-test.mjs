import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();

const REQUIRED_UI_FILES = [
  "src/contracts/ui/types.ts",
  "src/tokens/ui.ts",
  "src/styles/ui.css",
  "src/engine/ui/UIManager.ts",
  "src/engine/ui/HUDDataBinder.ts",
  "src/engine/ui/LocalizationEngine.ts",
  "src/engine/ui/UITemplateRegistry.ts",
  "src/engine/ui/DOMEventListenerBridge.ts",
  "src/plugins/ui/plugin.ts",
  "tests/ui-system.test.ts",
];

function runSmokeTest() {
  console.log("============================================================");
  console.log("  Auditoria Estática de Integridade: Camada game.ui         ");
  console.log("============================================================\n");

  let hasError = false;

  for (const relPath of REQUIRED_UI_FILES) {
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
    console.log("\n\x1b[32m✅ Todos os 10 arquivos criados da camada game.ui estão presentes e íntegros.\x1b[0m\n");
  }
}

runSmokeTest();