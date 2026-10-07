#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  auditLayer1NativeTauri,
  formatLayer1NativeTauriAudit,
} from "./lib/layer1-native-tauri-v1.mjs";

const ROOT =
  process.cwd();

function fail(
  message,
) {
  throw new Error(
    message,
  );
}

function stripTerminalControlSequences(
  value,
) {
  return value
    .replace(
      /\u001B\][^\u0007]*(?:\u0007|\u001B\\)/gu,
      "",
    )
    .replace(
      /\u001B\[[0-?]*[ -/]*[@-~]/gu,
      "",
    )
    .replace(
      /\r/gu,
      "\n",
    );
}

function normalizeCargoTrailingNewlineDrift(
  baseline,
) {
  const relativePath =
    "src-tauri/Cargo.toml";

  const expectedHash =
    baseline
      .ownedFileSha256?.[
        relativePath
      ];

  if (
    typeof expectedHash !==
      "string"
  ) {
    return;
  }

  const target =
    path.join(
      ROOT,
      ...relativePath.split(
        "/",
      ),
    );

  if (
    !fs.existsSync(
      target,
    )
  ) {
    return;
  }

  const current =
    fs.readFileSync(
      target,
    );

  const currentHash =
    crypto
      .createHash(
        "sha256",
      )
      .update(
        current,
      )
      .digest(
        "hex",
      );

  if (
    currentHash ===
      expectedHash
  ) {
    return;
  }

  const normalized =
    Buffer.from(
      current
        .toString(
          "utf8",
        )
        .replace(
          /(?:\r?\n)+$/u,
          "",
        ),
      "utf8",
    );

  const normalizedHash =
    crypto
      .createHash(
        "sha256",
      )
      .update(
        normalized,
      )
      .digest(
        "hex",
      );

  if (
    normalizedHash !==
      expectedHash
  ) {
    return;
  }

  fs.writeFileSync(
    target,
    normalized,
  );

  console.log(
    "[Stage85] Cargo.toml: drift não-semântico de newline final normalizado.",
  );
}

function runtimeFingerprint(
  baseline,
) {
  const hash =
    crypto.createHash(
      "sha256",
    );

  for (
    const relativePath of
    Object.keys(
      baseline.ownedFileSha256 ??
      {},
    ).sort()
  ) {
    const target =
      path.join(
        ROOT,
        ...relativePath.split(
          "/",
        ),
      );

    if (
      !fs.existsSync(
        target,
      )
    ) {
      fail(
        `Runtime file ausente: ${relativePath}`,
      );
    }

    hash.update(
      relativePath,
    );

    hash.update(
      fs.readFileSync(
        target,
      ),
    );
  }

  return hash.digest(
    "hex",
  );
}

try {
  const markerPath =
    path.join(
      ROOT,
      "ETAPA85_AUTOMATED_PASS.json",
    );

  if (
    !fs.existsSync(
      markerPath,
    )
  ) {
    fail(
      "ETAPA85_AUTOMATED_PASS.json ausente. Execute npm run stage85:validate primeiro.",
    );
  }

  const marker =
    JSON.parse(
      fs.readFileSync(
        markerPath,
        "utf8",
      ),
    );

  if (
    marker.automatedGates !==
      "PASS"
  ) {
    fail(
      "Marker de gates automatizados não está em PASS.",
    );
  }

  const baseline =
    JSON.parse(
      fs.readFileSync(
        path.join(
          ROOT,
          "LAYER1_NATIVE_TAURI_BASELINE_V1.json",
        ),
        "utf8",
      ),
    );

  normalizeCargoTrailingNewlineDrift(
    baseline,
  );

  const currentFingerprint =
    runtimeFingerprint(
      baseline,
    );

  if (
    currentFingerprint !==
      marker.runtimeFingerprint
  ) {
    fail(
      "Runtime Stage85 mudou após os gates automatizados; execute stage85:validate novamente.",
    );
  }

  const logPath =
    path.join(
      ROOT,
      "tests",
      "debug-execution.log",
    );

  if (
    !fs.existsSync(
      logPath,
    )
  ) {
    fail(
      "tests/debug-execution.log ausente. Execute npm run stage85:smoke e feche a janela Tauri normalmente.",
    );
  }

  const log =
    stripTerminalControlSequences(
      fs.readFileSync(
        logPath,
        "utf8",
      ),
    );

  const started =
    /Running\s+[`'"]?target\/debug\/projeto1/u.test(
      log,
    ) ||
    log.includes(
      "Running `target/debug/projeto1`",
    );

  if (
    !started
  ) {
    fail(
      "O log não comprova execução do binário Tauri target/debug/projeto1.",
    );
  }

  const shutdown =
    log.includes(
      "[Steamworks] Runtime encerrado com shutdown idempotente.",
    );

  if (
    !shutdown
  ) {
    fail(
      "O log não comprova shutdown nativo do SteamState. Feche a janela normalmente antes de finalizar.",
    );
  }

  const steamStateObserved =
    log.includes(
      "[Steamworks] Inicializado com sucesso; callback pump ativo.",
    ) ||
    log.includes(
      "Aplicação seguirá em modo offline.",
    );

  if (
    !steamStateObserved
  ) {
    fail(
      "O log não contém estado Steam online nem fallback offline controlado.",
    );
  }

  if (
    /panicked at|thread ['"][^'"]+['"] panicked|fatal runtime error/iu.test(
      log,
    )
  ) {
    fail(
      "O native smoke contém panic/fatal runtime error.",
    );
  }

  const audit =
    await auditLayer1NativeTauri({
      projectRoot:
        ROOT,
    });

  process.stdout.write(
    formatLayer1NativeTauriAudit(
      audit,
    ),
  );

  if (
    !audit.ok
  ) {
    fail(
      "Stage85 audit deixou de passar depois do native smoke.",
    );
  }

  const evidence = {
    schemaVersion:
      1,

    stage:
      85,

    status:
      "PASS",

    finalizedAt:
      new Date()
        .toISOString(),

    nativeBinaryStarted:
      true,

    nativeShutdownObserved:
      true,

    steamStateObserved:
      log.includes(
        "[Steamworks] Inicializado com sucesso; callback pump ativo.",
      )
        ? "online"
        : "offline-fallback",

    runtimeFingerprint:
      currentFingerprint,
  };

  fs.writeFileSync(
    path.join(
      ROOT,
      "ETAPA85_NATIVE_SMOKE_EVIDENCE.json",
    ),
    `${JSON.stringify(
      evidence,
      null,
      2,
    )}\n`,
  );

  console.log(
    "============================================================",
  );
  console.log(
    " STAGE 85 PASS",
  );
  console.log(
    "============================================================",
  );
} catch (
  error
) {
  console.error(
    error instanceof Error
      ? error.stack ??
          error.message
      : String(
          error,
        ),
  );

  console.error(
    "STAGE 85: BLOCKED / FAIL",
  );

  process.exitCode =
    1;
}
