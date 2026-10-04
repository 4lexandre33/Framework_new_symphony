import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const failures = [];
const successes = [];

const REQUIRED_MODDING_FILES = [
  "src/contracts/modding/types.ts",
  "src/tokens/modding.ts",
  "src/engine/modding/internal/AssetOverrideRegistry.ts",
  "src/engine/modding/internal/DynamicPluginLoader.ts",
  "src/engine/modding/internal/ScriptSandbox.ts",
  "src/engine/modding/internal/SteamWorkshopDriver.ts",
  "src/engine/modding/internal/TauriModdingDriver.ts",
  "src-tauri/src/modding.rs",
  "src-tauri/src/lib.rs",
  "src/plugins/modding/plugin.ts",
  "src/plugins/debug/plugin.ts",
  "src/app/bootstrap.ts",
  "src/app/createEnginePlugins.ts",
  "src/app/EngineServices.ts",
  "tests/modding-system.test.ts",
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

function checkDoesNotContain(relativePath, fragment, description) {
  const content = read(relativePath);
  if (!content || content.includes(fragment)) {
    failures.push(`${relativePath}: ${description}`);
    return;
  }
  successes.push(`${relativePath}: ${description}`);
}

console.log("============================================================");
console.log("  Auditoria Estática de Integridade: Camada game.modding    ");
console.log("============================================================\n");

for (const file of REQUIRED_MODDING_FILES) checkFile(file);

checkContains(
  "src/engine/modding/internal/AssetOverrideRegistry.ts",
  "list?.[0]?.realPath ?? null",
  "resolve o primeiro override da lista ordenada",
);
checkContains(
  "src/engine/modding/internal/DynamicPluginLoader.ts",
  "Dependência cíclica entre mods",
  "detecta ciclos de dependência",
);
checkContains(
  "src/engine/modding/internal/DynamicPluginLoader.ts",
  "Dependência ausente",
  "detecta dependências ausentes",
);
checkContains(
  "src/engine/modding/internal/DynamicPluginLoader.ts",
  "satisfies(",
  "valida versões semanticamente",
);
checkContains(
  "src/engine/modding/internal/ScriptSandbox.ts",
  "this.executionTimer = setTimeout",
  "aplica limite real de execução do sandbox",
);
checkContains(
  "src/engine/modding/internal/ScriptSandbox.ts",
  "URL.revokeObjectURL",
  "libera Blob URL do worker",
);
checkDoesNotContain(
  "src/engine/modding/internal/TauriModdingDriver.ts",
  "published_sim_",
  "não mascara falha do backend com publicação simulada",
);
checkContains(
  "src-tauri/src/modding.rs",
  '#[serde(rename_all = "camelCase")]',
  "DTO Rust usa camelCase compatível com TypeScript e mod.json",
);
checkContains(
  "src/plugins/modding/plugin.ts",
  "PublishModToWorkshopCommand.type",
  "handler de publicação usa contrato tipado",
);
checkContains(
  "src/plugins/modding/plugin.ts",
  "DownloadWorkshopModCommand.type",
  "handler de download usa contrato tipado",
);
checkContains(
  "src/plugins/debug/plugin.ts",
  "ModdingToken",
  "game.debug resolve ModdingToken",
);
checkContains(
  "src-tauri/src/lib.rs",
  "modding::modding_scan_local_mods",
  "scan de mods registrado no invoke handler",
);
checkContains(
  "src-tauri/src/lib.rs",
  "overlay::overlay_dock_to_taskbar",
  "registro do dock de overlay preservado",
);
checkContains(
  "src/app/bootstrap.ts",
  "ModdingToken",
  "ModdingToken registrado no bootstrap",
);
checkContains(
  "src/app/createEnginePlugins.ts",
  "createModdingPlugin",
  "game.modding presente na composição de plugins",
);
checkContains(
  "src/app/EngineServices.ts",
  "modding: ModdingApi | null",
  "EngineServices expõe game.modding",
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
  console.log("\n\x1b[31m❌ A camada game.modding precisa de ajustes.\x1b[0m\n");
  process.exitCode = 1;
} else {
  console.log("\n\x1b[32m✅ Camada game.modding íntegra e conectada ao Microkernel.\x1b[0m\n");
}
