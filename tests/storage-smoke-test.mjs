import fs from "node:fs";
import path from "node:path";

const ROOT_DIR =
  process.cwd();

const REQUIRED_STORAGE_FILES =
  Object.freeze([
    "src/contracts/storage/types.ts",
    "src/tokens/storage.ts",
    "src/engine/storage/public/index.ts",
    "src/engine/storage/internal/StorageErrors.ts",
    "src/engine/storage/internal/KeyValueStorageBackend.ts",
    "src/engine/storage/internal/SaveRecordCodec.ts",
    "src/engine/storage/internal/KeyValueSaveDriver.ts",
    "src/engine/storage/internal/SteamCloudDriver.ts",
    "src/engine/storage/internal/LocalDatabaseDriver.ts",
    "src/engine/storage/internal/CloudDatabaseDriver.ts",
    "src/engine/storage/internal/StorageService.ts",
    "src/engine/storage/internal/DomainSaveGamePortAdapter.ts",
    "src/plugins/storage/plugin.ts",
    "tests/storage-system.test.ts",
  ]);

function runSmokeTest() {
  console.log(
    "============================================================",
  );

  console.log(
    "  Auditoria Estática de Integridade: Camada game.storage   ",
  );

  console.log(
    "============================================================\n",
  );

  let hasError =
    false;

  for (
    const relPath of
    REQUIRED_STORAGE_FILES
  ) {
    const fullPath =
      path.join(
        ROOT_DIR,
        relPath,
      );

    if (
      fs.existsSync(
        fullPath,
      )
    ) {
      const stats =
        fs.statSync(
          fullPath,
        );

      console.log(
        `\x1b[32m[OK]\x1b[0m ${relPath} (${String(stats.size)} bytes)`,
      );
    } else {
      console.log(
        `\x1b[31m[FALHA]\x1b[0m Arquivo obrigatório ausente: ${relPath}`,
      );

      hasError =
        true;
    }
  }

  if (
    hasError
  ) {
    console.log(
      "\n\x1b[31m❌ Auditoria estática falhou! Verifique os arquivos ausentes.\x1b[0m\n",
    );

    process.exit(
      1,
    );
  }

  console.log(
    `\n\x1b[32m✅ Todos os ${String(REQUIRED_STORAGE_FILES.length)} arquivos obrigatórios de game.storage estão presentes.\x1b[0m\n`,
  );
}

runSmokeTest();
