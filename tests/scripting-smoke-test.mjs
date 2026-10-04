import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();

const REQUIRED_SCRIPTING_FILES = [
  "src/contracts/scripting/types.ts",
  "src/tokens/scripting.ts",
  "src/engine/scripting/internal/CutsceneTimeline.ts",
  "src/engine/scripting/internal/DialogueTreeParser.ts",
  "src/engine/scripting/internal/QuestManager.ts",
  "src/engine/scripting/internal/TriggerZoneManager.ts",
  "src/plugins/scripting/plugin.ts",
  "tests/scripting-system.test.ts",
];

const successes = [];
const failures = [];

function resolvePath(relativePath) {
  return path.join(ROOT_DIR, relativePath);
}

function readProjectFile(relativePath) {
  const fullPath = resolvePath(relativePath);
  if (!fs.existsSync(fullPath)) return null;

  return fs
    .readFileSync(fullPath, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function checkFileExists(relativePath) {
  const fullPath = resolvePath(relativePath);

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
  console.log("  Auditoria Estática de Integridade: Camada game.scripting");
  console.log("============================================================\n");

  for (const relativePath of REQUIRED_SCRIPTING_FILES) {
    checkFileExists(relativePath);
  }

  checkContains(
    "src/tokens/scripting.ts",
    '"game.scripting"',
    "ScriptingToken registrado como game.scripting",
  );

  checkContains(
    "src/engine/scripting/internal/CutsceneTimeline.ts",
    "scheduledKeyframes",
    "timeline usa fila ordenada de keyframes",
  );

  checkContains(
    "src/engine/scripting/internal/DialogueTreeParser.ts",
    ".choiceIndex === choiceIndex",
    "diálogo resolve escolhas pelo choiceIndex declarado",
  );

  checkContains(
    "src/engine/scripting/internal/QuestManager.ts",
    "let status: QuestStatus",
    "QuestManager tipa explicitamente o estado mutável da quest",
  );

  checkContains(
    "src/engine/scripting/internal/TriggerZoneManager.ts",
    'case "sphere"',
    "TriggerZoneManager implementa volume sphere",
  );

  checkContains(
    "src/engine/scripting/internal/TriggerZoneManager.ts",
    'case "cylinder"',
    "TriggerZoneManager implementa volume cylinder",
  );

  checkContains(
    "src/plugins/scripting/plugin.ts",
    "PlayCutsceneCommand.type",
    "handler de cutscene usa contrato tipado",
  );

  checkContains(
    "src/plugins/scripting/plugin.ts",
    "AdvanceDialogueCommand.type",
    "handler de diálogo usa contrato tipado",
  );

  checkContains(
    "src/plugins/scripting/plugin.ts",
    "StartQuestCommand.type",
    "handler de quest usa contrato tipado",
  );

  checkMatches(
    "src/plugins/scripting/plugin.ts",
    /dependsOn\s*:\s*\[[\s\S]*?id\s*:\s*["']game\.loop["'][\s\S]*?range\s*:\s*["']\^1\.0\.0["']/m,
    "dependência explícita de game.loop",
  );

  checkContains(
    "src/app/bootstrap.ts",
    "ScriptingToken",
    "ScriptingToken registrado no bootstrap",
  );

  checkContains(
    "src/app/createEnginePlugins.ts",
    "createScriptingPlugin",
    "game.scripting registrado na composição de plugins",
  );

  checkContains(
    "src/app/EngineServices.ts",
    "scripting: ScriptingApi | null",
    "EngineServices possui referência para game.scripting",
  );

  checkContains(
    "src/plugins/debug/plugin.ts",
    "ScriptingToken",
    "game.debug resolve ScriptingToken",
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
      "\n\x1b[31m❌ A camada game.scripting precisa de ajustes antes do congelamento.\x1b[0m\n",
    );

    process.exitCode = 1;
    return;
  }

  console.log(
    "\n\x1b[32m✅ Camada game.scripting íntegra e conectada ao Microkernel.\x1b[0m\n",
  );
}

runSmokeTest();
