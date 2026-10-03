import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const failures = [];
const successes = [];

const REQUIRED_OVERLAY_FILES = [
  "src/contracts/overlay/types.ts",
  "src/tokens/overlay.ts",
  "src/engine/overlay/RaycastHitTestPassthrough.ts",
  "src/engine/overlay/OverlayWindowManager.ts",
  "src/engine/overlay/TauriOverlayDriver.ts",
  "src-tauri/src/overlay.rs",
  "src-tauri/src/lib.rs",
  "src/plugins/overlay/plugin.ts",
  "tests/overlay-system.test.ts",
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
console.log("  Auditoria Estática de Integridade: Camada game.overlay   ");
console.log("============================================================\n");

for (const file of REQUIRED_OVERLAY_FILES) checkFile(file);

checkContains(
  "src/engine/overlay/TauriOverlayDriver.ts",
  'invoke<TaskbarBounds>("overlay_dock_to_taskbar"',
  "driver envia posição de dock ao backend Tauri",
);
checkContains(
  "src-tauri/src/overlay.rs",
  "pub async fn overlay_dock_to_taskbar",
  "backend implementa movimentação real da janela",
);
checkContains(
  "src-tauri/src/lib.rs",
  "overlay::overlay_dock_to_taskbar",
  "comando de dock está registrado no invoke handler",
);
checkContains(
  "src/plugins/overlay/plugin.ts",
  "DockToTaskbarCommand.type",
  "handler de dock usa contrato tipado",
);
checkContains(
  "src/plugins/overlay/plugin.ts",
  "payload.deltaSeconds",
  "tick preserva deltaSeconds real",
);

console.log("\n--- Resultados ---");
for (const success of successes) console.log(`\x1b[32m[OK]\x1b[0m ${success}`);

if (failures.length > 0) {
  console.log("\n--- Erros Encontrados ---");
  for (const failure of failures) console.log(`\x1b[31m[ERRO]\x1b[0m ${failure}`);
  console.log("\n\x1b[31m❌ A camada game.overlay precisa de ajustes.\x1b[0m\n");
  process.exitCode = 1;
} else {
  console.log("\n\x1b[32m✅ Camada game.overlay íntegra.\x1b[0m\n");
}
