import fs from "node:fs";
import path from "node:path";

const ROOT_DIR =
  process.cwd();

const REQUIRED_AI_FILES = [
  "src/contracts/ai/types.ts",
  "src/tokens/ai.ts",
  "src/engine/ai/NavMeshQuery.ts",
  "src/engine/ai/BehaviorTree.ts",
  "src/engine/ai/PerceptionSystem.ts",
  "src/engine/ai/SteeringBehaviors.ts",
  "src/engine/ai/AIAgentManager.ts",
  "src/plugins/ai/plugin.ts",
  "tests/ai-system.test.ts",
];

const failures =
  [];

const successes =
  [];

function resolveProjectPath(
  relativePath,
) {
  return path.join(
    ROOT_DIR,
    relativePath,
  );
}

function normalizeText(
  content,
) {
  return content
    .replace(
      /\r\n/g,
      "\n",
    )
    .replace(
      /\r/g,
      "\n",
    );
}

function readProjectFile(
  relativePath,
) {
  const fullPath =
    resolveProjectPath(
      relativePath,
    );

  if (
    !fs.existsSync(
      fullPath,
    )
  ) {
    return null;
  }

  return normalizeText(
    fs.readFileSync(
      fullPath,
      "utf8",
    ),
  );
}

function checkFileExists(
  relativePath,
) {
  const fullPath =
    resolveProjectPath(
      relativePath,
    );

  if (
    !fs.existsSync(
      fullPath,
    )
  ) {
    failures.push(
      `Arquivo obrigatório ausente: ${relativePath}`,
    );

    return false;
  }

  const stats =
    fs.statSync(
      fullPath,
    );

  if (
    !stats.isFile()
  ) {
    failures.push(
      `Caminho obrigatório não é um arquivo: ${relativePath}`,
    );

    return false;
  }

  if (
    stats.size ===
    0
  ) {
    failures.push(
      `Arquivo obrigatório está vazio: ${relativePath}`,
    );

    return false;
  }

  successes.push(
    `${relativePath} (${stats.size} bytes)`,
  );

  return true;
}

function checkFileContains(
  relativePath,
  snippet,
  description,
) {
  const content =
    readProjectFile(
      relativePath,
    );

  if (
    content ===
    null
  ) {
    failures.push(
      `Arquivo não encontrado: ${relativePath}`,
    );

    return;
  }

  if (
    !content.includes(
      snippet,
    )
  ) {
    failures.push(
      `${relativePath}: não contém ${description}.`,
    );

    return;
  }

  successes.push(
    `${relativePath}: ${description}`,
  );
}

function checkFileMatches(
  relativePath,
  pattern,
  description,
) {
  const content =
    readProjectFile(
      relativePath,
    );

  if (
    content ===
    null
  ) {
    failures.push(
      `Arquivo não encontrado: ${relativePath}`,
    );

    return;
  }

  if (
    !pattern.test(
      content,
    )
  ) {
    failures.push(
      `${relativePath}: não contém ${description}.`,
    );

    return;
  }

  successes.push(
    `${relativePath}: ${description}`,
  );
}

function checkAIContract() {
  checkFileContains(
    "src/contracts/ai/types.ts",
    '"game.ai.set-blackboard"',
    "comando Blackboard usa namespace game.ai",
  );

  checkFileContains(
    "src/contracts/ai/types.ts",
    '"game.ai.request-path"',
    "comando RequestPath usa namespace game.ai",
  );

  checkFileContains(
    "src/contracts/ai/types.ts",
    '"game.ai.set-agent-target"',
    "comando SetAgentTarget usa namespace game.ai",
  );
}

function checkAIToken() {
  checkFileMatches(
    "src/tokens/ai.ts",
    /defineCapability<AiApi>\s*\(\s*["']game\.ai["']\s*,\s*["']1\.0\.0["']\s*,?\s*\)/m,
    "AiToken expõe game.ai versão 1.0.0",
  );
}

function checkAIPlugin() {
  checkFileContains(
    "src/plugins/ai/plugin.ts",
    "RequestPathCommand.type",
    "handler de RequestPath usa o contrato como fonte de verdade",
  );

  checkFileContains(
    "src/plugins/ai/plugin.ts",
    "SetAgentTargetCommand.type",
    "handler de target usa o contrato como fonte de verdade",
  );

  checkFileContains(
    "src/plugins/ai/plugin.ts",
    "SetBlackboardValueCommand.type",
    "handler de Blackboard usa o contrato como fonte de verdade",
  );

  checkFileMatches(
    "src/plugins/ai/plugin.ts",
    /dependsOn\s*:\s*\[\s*\{\s*id\s*:\s*["']game\.loop["']\s*,?\s*range\s*:\s*["']\^1\.0\.0["']/m,
    "dependência explícita do game.loop ^1.0.0",
  );

  checkFileMatches(
    "src/plugins/ai/plugin.ts",
    /id\s*:\s*["']game\.ai["']/m,
    "manifesto identifica o plugin como game.ai",
  );

  checkFileContains(
    "src/plugins/ai/plugin.ts",
    "AiToken.id",
    "plugin publica AiToken",
  );

  checkFileContains(
    "src/plugins/ai/plugin.ts",
    "PhysicsToken.id",
    "plugin declara integração com game.physics",
  );

  checkFileContains(
    "src/plugins/ai/plugin.ts",
    "WorldToken.id",
    "plugin declara integração com game.world",
  );

  checkFileContains(
    "src/plugins/ai/plugin.ts",
    '"game.loop.tick"',
    "plugin escuta o tick determinístico do game.loop",
  );
}

function checkBootstrapIntegration() {
  checkFileContains(
    "src/app/bootstrap.ts",
    "AiToken",
    "AiToken registrado no bootstrap",
  );

  checkFileContains(
    "src/app/createEnginePlugins.ts",
    "createAIPlugin",
    "plugin de IA registrado no bootstrap",
  );
}

function printResults() {
  console.log(
    "\n--- Resultados ---",
  );

  for (
    const success of
    successes
  ) {
    console.log(
      `\x1b[32m[OK]\x1b[0m ${success}`,
    );
  }

  if (
    failures.length ===
    0
  ) {
    return;
  }

  console.log(
    "\n--- Erros Encontrados ---",
  );

  for (
    const failure of
    failures
  ) {
    console.log(
      `\x1b[31m[ERRO]\x1b[0m ${failure}`,
    );
  }
}

function runSmokeTest() {
  console.log(
    "============================================================",
  );

  console.log(
    "  Auditoria Estática de Integridade: Camada game.ai",
  );

  console.log(
    "============================================================\n",
  );

  for (
    const relativePath of
    REQUIRED_AI_FILES
  ) {
    checkFileExists(
      relativePath,
    );
  }

  checkAIContract();
  checkAIToken();
  checkAIPlugin();
  checkBootstrapIntegration();

  printResults();

  if (
    failures.length >
    0
  ) {
    console.log(
      "\n\x1b[31m❌ A camada game.ai precisa de ajustes antes do congelamento.\x1b[0m\n",
    );

    process.exitCode =
      1;

    return;
  }

  console.log(
    "\n\x1b[32m✅ Camada game.ai íntegra e conectada ao Microkernel.\x1b[0m\n",
  );
}

runSmokeTest();