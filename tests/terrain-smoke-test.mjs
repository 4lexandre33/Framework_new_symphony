import fs from "node:fs";
import path from "node:path";

const ROOT_DIR =
  process.cwd();

const REQUIRED_TERRAIN_FILES = [
  "src/contracts/terrain/types.ts",
  "src/tokens/terrain.ts",
  "src/engine/terrain/internal/PerlinNoiseService.ts",
  "src/engine/terrain/internal/BiomeEvaluator.ts",
  "src/engine/terrain/internal/GreedyMesher.ts",
  "src/engine/terrain/internal/VoxelChunkManager.ts",
  "src/engine/terrain/internal/ProceduralWorkerPool.ts",
  "src/engine/terrain/internal/terrain.worker.ts",
  "src/plugins/terrain/plugin.ts",
  "tests/terrain-system.test.ts",
];

const successes =
  [];

const failures =
  [];

function resolvePath(
  relativePath,
) {
  return path.join(
    ROOT_DIR,
    relativePath,
  );
}

function readFile(
  relativePath,
) {
  const fullPath =
    resolvePath(
      relativePath,
    );

  if (
    !fs.existsSync(
      fullPath,
    )
  ) {
    return null;
  }

  return fs
    .readFileSync(
      fullPath,
      "utf8",
    )
    .replace(
      /\r\n/g,
      "\n",
    )
    .replace(
      /\r/g,
      "\n",
    );
}

function checkFile(
  relativePath,
) {
  const fullPath =
    resolvePath(
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

    return;
  }

  const stats =
    fs.statSync(
      fullPath,
    );

  if (
    !stats.isFile() ||
    stats.size ===
      0
  ) {
    failures.push(
      `Arquivo inválido ou vazio: ${relativePath}`,
    );

    return;
  }

  successes.push(
    `${relativePath} (${stats.size} bytes)`,
  );
}

function checkContains(
  relativePath,
  fragment,
  description,
) {
  const content =
    readFile(
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
      fragment,
    )
  ) {
    failures.push(
      `${relativePath}: ${description}`,
    );

    return;
  }

  successes.push(
    `${relativePath}: ${description}`,
  );
}

function checkMatches(
  relativePath,
  expression,
  description,
) {
  const content =
    readFile(
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
    !expression.test(
      content,
    )
  ) {
    failures.push(
      `${relativePath}: ${description}`,
    );

    return;
  }

  successes.push(
    `${relativePath}: ${description}`,
  );
}

function runSmokeTest() {
  console.log(
    "============================================================",
  );

  console.log(
    "  Auditoria Estática de Integridade: Camada game.terrain",
  );

  console.log(
    "============================================================\n",
  );

  for (
    const relativePath of
    REQUIRED_TERRAIN_FILES
  ) {
    checkFile(
      relativePath,
    );
  }

  checkContains(
    "src/tokens/terrain.ts",
    '"game.terrain"',
    "TerrainToken registrado como game.terrain",
  );

  checkContains(
    "src/engine/terrain/internal/GreedyMesher.ts",
    "new Int32Array",
    "GreedyMesher possui máscara para fusão de faces",
  );

  checkContains(
    "src/engine/terrain/internal/BiomeEvaluator.ts",
    "reseed(",
    "BiomeEvaluator acompanha alterações de seed",
  );

  checkContains(
    "src/engine/terrain/internal/ProceduralWorkerPool.ts",
    "./terrain.worker.ts",
    "WorkerPool referencia o Worker real de terreno",
  );

  checkContains(
    "src/engine/terrain/internal/terrain.worker.ts",
    "PerlinNoiseService",
    "Worker utiliza geração procedural baseada em seed",
  );

  checkContains(
    "src/plugins/terrain/plugin.ts",
    "RequestChunkLoadCommand.type",
    "handler de chunk usa contrato tipado",
  );

  checkContains(
    "src/plugins/terrain/plugin.ts",
    "ModifyVoxelBlockCommand.type",
    "handler de voxel usa contrato tipado",
  );

  checkMatches(
    "src/plugins/terrain/plugin.ts",
    /dependsOn\s*:\s*\[[\s\S]*?id\s*:\s*["']game\.loop["'][\s\S]*?range\s*:\s*["']\^1\.0\.0["']/m,
    "plugin declara dependência explícita de game.loop",
  );

  checkMatches(
    "src/plugins/terrain/plugin.ts",
    /dependsOn\s*:\s*\[[\s\S]*?id\s*:\s*["']game\.render["'][\s\S]*?range\s*:\s*["']\^1\.0\.0["']/m,
    "plugin declara dependência explícita de game.render",
  );

  checkContains(
    "src/app/bootstrap.ts",
    "TerrainToken",
    "TerrainToken registrado no bootstrap",
  );

  checkContains(
    "src/app/createEnginePlugins.ts",
    "createTerrainPlugin",
    "game.terrain registrado na composição de plugins",
  );

  checkContains(
    "src/plugins/debug/plugin.ts",
    "TerrainToken",
    "game.debug resolve TerrainToken",
  );

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
    failures.length >
    0
  ) {
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

    console.log(
      "\n\x1b[31m❌ A camada game.terrain precisa de ajustes antes do congelamento.\x1b[0m\n",
    );

    process.exitCode =
      1;

    return;
  }

  console.log(
    "\n\x1b[32m✅ Camada game.terrain íntegra e conectada ao Microkernel.\x1b[0m\n",
  );
}

runSmokeTest();