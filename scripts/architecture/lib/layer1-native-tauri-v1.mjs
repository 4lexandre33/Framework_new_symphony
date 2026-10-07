import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import {
  auditLayer1PublicApi,
} from "./layer1-public-api-v1.mjs";

import {
  auditLayer1CapabilityGraph,
} from "./layer1-capability-graph-v1.mjs";

import {
  auditLayer1Lifecycle,
} from "./layer1-lifecycle-v1.mjs";

import {
  auditLayer1Steamworks,
} from "./layer1-steamworks-v1.mjs";

export const LAYER1_NATIVE_TAURI_AUDIT_VERSION =
  "1.0.0";

export const LAYER1_NATIVE_TAURI_BASELINE_FILE =
  "LAYER1_NATIVE_TAURI_BASELINE_V1.json";

export const NATIVE_TAURI_RUNTIME_FILES =
  Object.freeze([
    "src-tauri/Cargo.toml",
    "src-tauri/tauri.conf.json",
    "src-tauri/capabilities/default.json",
    "src-tauri/src/lib.rs",
    "src-tauri/src/steam.rs",
    "src-tauri/src/security.rs",
    "src-tauri/src/overlay.rs",
    "src-tauri/src/modding.rs",
    "src-tauri/src/monetization.rs",
    "src/engine/steam/internal/SteamBridgeService.ts",
    "src/engine/security/internal/TauriSecurityDriver.ts",
    "src/engine/overlay/internal/TauriOverlayDriver.ts",
    "src/engine/modding/internal/TauriModdingDriver.ts",
    "src/engine/monetization/internal/TauriMonetizationDriver.ts",
  ]);

function abs(
  projectRoot,
  relativePath,
) {
  return path.join(
    projectRoot,
    ...relativePath.split("/"),
  );
}

function read(
  projectRoot,
  relativePath,
) {
  const target =
    abs(
      projectRoot,
      relativePath,
    );

  if (
    !fs.existsSync(
      target,
    ) ||
    !fs.statSync(
      target,
    ).isFile()
  ) {
    throw new Error(
      `arquivo ausente: ${relativePath}`,
    );
  }

  return fs.readFileSync(
    target,
    "utf8",
  );
}

function sha256(
  projectRoot,
  relativePath,
) {
  return crypto
    .createHash(
      "sha256",
    )
    .update(
      fs.readFileSync(
        abs(
          projectRoot,
          relativePath,
        ),
      ),
    )
    .digest(
      "hex",
    );
}

function violation(
  code,
  scope,
  message,
) {
  return Object.freeze({
    code,
    scope,
    message,
  });
}

function listFilesRecursive(
  directory,
  predicate,
) {
  if (
    !fs.existsSync(
      directory,
    )
  ) {
    return [];
  }

  const output =
    [];

  const stack = [
    directory,
  ];

  while (
    stack.length >
      0
  ) {
    const current =
      stack.pop();

    if (
      current ===
      undefined
    ) {
      continue;
    }

    for (
      const entry of
      fs.readdirSync(
        current,
        {
          withFileTypes:
            true,
        },
      )
    ) {
      const target =
        path.join(
          current,
          entry.name,
        );

      if (
        entry.isDirectory()
      ) {
        if (
          entry.name !==
            "node_modules" &&
          entry.name !==
            "dist" &&
          entry.name !==
            "target"
        ) {
          stack.push(
            target,
          );
        }

        continue;
      }

      if (
        entry.isFile() &&
        predicate(
          target,
        )
      ) {
        output.push(
          target,
        );
      }
    }
  }

  output.sort();

  return output;
}

function collectRustCommands(
  projectRoot,
) {
  const declared =
    new Map();

  const rustRoot =
    abs(
      projectRoot,
      "src-tauri/src",
    );

  const files =
    listFilesRecursive(
      rustRoot,
      (
        target,
      ) =>
        target.endsWith(
          ".rs",
        ),
    );

  const commandPattern =
    /#\[tauri::command\]\s*pub\s+(?:async\s+)?fn\s+([A-Za-z0-9_]+)/gu;

  for (
    const target of
    files
  ) {
    const source =
      fs.readFileSync(
        target,
        "utf8",
      );

    for (
      const match of
      source.matchAll(
        commandPattern,
      )
    ) {
      const name =
        match[1];

      if (
        name !==
        undefined
      ) {
        declared.set(
          name,
          path.relative(
            projectRoot,
            target,
          )
            .split(
              path.sep,
            )
            .join(
              "/",
            ),
        );
      }
    }
  }

  const host =
    read(
      projectRoot,
      "src-tauri/src/lib.rs",
    );

  const handlerMatch =
    /tauri::generate_handler!\[([\s\S]*?)\]\)/u
      .exec(
        host,
      );

  const registered =
    new Set();

  if (
    handlerMatch?.[1]
  ) {
    const registrationPattern =
      /[A-Za-z0-9_]+::([A-Za-z0-9_]+)/gu;

    for (
      const match of
      handlerMatch[1]
        .matchAll(
          registrationPattern,
        )
    ) {
      const name =
        match[1];

      if (
        name !==
        undefined
      ) {
        registered.add(
          name,
        );
      }
    }
  }

  return Object.freeze({
    declared,
    registered,
  });
}

function loadTypeScript(
  projectRoot,
) {
  const require =
    createRequire(
      path.join(
        projectRoot,
        "package.json",
      ),
    );

  return require(
    "typescript",
  );
}

function collectTypeScriptInvokes(
  projectRoot,
) {
  const ts =
    loadTypeScript(
      projectRoot,
    );

  const srcRoot =
    abs(
      projectRoot,
      "src",
    );

  const files =
    listFilesRecursive(
      srcRoot,
      (
        target,
      ) =>
        target.endsWith(
          ".ts",
        ) &&
        !target.endsWith(
          ".d.ts",
        ),
    );

  const commands =
    [];

  const dynamicCalls =
    [];

  const anyCalls =
    [];

  for (
    const target of
    files
  ) {
    const source =
      fs.readFileSync(
        target,
        "utf8",
      );

    const relativePath =
      path.relative(
        projectRoot,
        target,
      )
        .split(
          path.sep,
        )
        .join(
          "/",
        );

    const sourceFile =
      ts.createSourceFile(
        relativePath,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );

    function visit(
      node,
    ) {
      if (
        ts.isCallExpression(
          node,
        ) &&
        ts.isIdentifier(
          node.expression,
        ) &&
        node.expression.text ===
          "invoke"
      ) {
        const first =
          node.arguments[0];

        if (
          first ===
            undefined ||
          !ts.isStringLiteralLike(
            first,
          )
        ) {
          dynamicCalls.push(
            relativePath,
          );
        } else {
          commands.push(
            Object.freeze({
              command:
                first.text,

              file:
                relativePath,
            }),
          );
        }

        for (
          const argument of
          node.typeArguments ??
          []
        ) {
          if (
            argument.kind ===
            ts.SyntaxKind.AnyKeyword
          ) {
            anyCalls.push(
              relativePath,
            );
          }
        }
      }

      ts.forEachChild(
        node,
        visit,
      );
    }

    visit(
      sourceFile,
    );
  }

  return Object.freeze({
    commands,
    dynamicCalls,
    anyCalls,
  });
}

function hasAll(
  source,
  fragments,
) {
  return fragments.every(
    (
      fragment,
    ) =>
      source.includes(
        fragment,
      ),
  );
}

function addCompatibilityViolation(
  violations,
  code,
  scope,
  result,
  message,
) {
  if (
    !result.ok
  ) {
    violations.push(
      violation(
        code,
        scope,
        `${message} Violações: ${String(result.violations?.length ?? 0)}.`,
      ),
    );
  }
}

export function createNativeTauriBaseline({
  projectRoot =
    process.cwd(),
} = {}) {
  const root =
    path.resolve(
      projectRoot,
    );

  const ownedFileSha256 =
    {};

  for (
    const relativePath of
    NATIVE_TAURI_RUNTIME_FILES
  ) {
    ownedFileSha256[
      relativePath
    ] =
      sha256(
        root,
        relativePath,
      );
  }

  const rust =
    collectRustCommands(
      root,
    );

  const tsInvokes =
    collectTypeScriptInvokes(
      root,
    );

  return Object.freeze({
    schemaVersion:
      1,

    version:
      "1.0.0",

    baselineId:
      "layer1-native-tauri-v1-stage85",

    stage:
      85,

    layer:
      1,

    auditVersion:
      LAYER1_NATIVE_TAURI_AUDIT_VERSION,

    referenceSnapshot:
      "post-stage84-native-hardening",

    ownedFileSha256:
      Object.freeze(
        ownedFileSha256,
      ),

    nativeCommands:
      Object.freeze(
        [
          ...rust.registered,
        ].sort(),
      ),

    invokedCommands:
      Object.freeze(
        [
          ...new Set(
            tsInvokes.commands
              .map(
                (
                  entry,
                ) =>
                  entry.command,
              ),
          ),
        ].sort(),
      ),

    baselinePolicy:
      Object.freeze({
        bridgeParity:
          true,

        literalInvokeCommands:
          true,

        explicitAnyInvoke:
          false,

        inputValidation:
          "defense-in-depth-ts-and-rust",

        permissions:
          "main-window-capability-no-global-tauri-production-csp",

        errorMapping:
          "fail-closed",

        nativeShutdown:
          "steam-callback-pump-stop-join-drop",
      }),
  });
}

export function loadNativeTauriBaseline(
  projectRoot =
    process.cwd(),
) {
  const target =
    abs(
      path.resolve(
        projectRoot,
      ),
      LAYER1_NATIVE_TAURI_BASELINE_FILE,
    );

  if (
    !fs.existsSync(
      target,
    )
  ) {
    throw new Error(
      `baseline ausente: ${LAYER1_NATIVE_TAURI_BASELINE_FILE}`,
    );
  }

  return JSON.parse(
    fs.readFileSync(
      target,
      "utf8",
    ),
  );
}

export async function auditLayer1NativeTauri({
  projectRoot =
    process.cwd(),
} = {}) {
  const root =
    path.resolve(
      projectRoot,
    );

  const baseline =
    loadNativeTauriBaseline(
      root,
    );

  const violations =
    [];

  for (
    const relativePath of
    NATIVE_TAURI_RUNTIME_FILES
  ) {
    const target =
      abs(
        root,
        relativePath,
      );

    if (
      !fs.existsSync(
        target,
      ) ||
      !fs.statSync(
        target,
      ).isFile()
    ) {
      violations.push(
        violation(
          "L1NAT001",
          relativePath,
          "arquivo nativo/Tauri obrigatório ausente.",
        ),
      );

      continue;
    }

    const expected =
      baseline
        .ownedFileSha256?.[
          relativePath
        ];

    if (
      typeof expected !==
        "string"
    ) {
      violations.push(
        violation(
          "L1NAT002",
          relativePath,
          "arquivo não está coberto pela baseline Stage85.",
        ),
      );

      continue;
    }

    if (
      sha256(
        root,
        relativePath,
      ) !== expected
    ) {
      violations.push(
        violation(
          "L1NAT003",
          relativePath,
          "runtime Stage85 divergiu da baseline certificada.",
        ),
      );
    }
  }

  const rust =
    collectRustCommands(
      root,
    );

  for (
    const [
      command,
      sourceFile,
    ] of
    rust.declared
  ) {
    if (
      !rust.registered.has(
        command,
      )
    ) {
      violations.push(
        violation(
          "L1NAT010",
          sourceFile,
          `#[tauri::command] ${command} não está registrado no invoke_handler.`,
        ),
      );
    }
  }

  for (
    const command of
    rust.registered
  ) {
    if (
      !rust.declared.has(
        command,
      )
    ) {
      violations.push(
        violation(
          "L1NAT011",
          "src-tauri/src/lib.rs",
          `invoke_handler registra ${command}, mas nenhuma função #[tauri::command] foi encontrada.`,
        ),
      );
    }
  }

  const invokes =
    collectTypeScriptInvokes(
      root,
    );

  for (
    const entry of
    invokes.commands
  ) {
    if (
      !rust.registered.has(
        entry.command,
      )
    ) {
      violations.push(
        violation(
          "L1NAT012",
          entry.file,
          `invoke("${entry.command}") não possui comando nativo registrado.`,
        ),
      );
    }
  }

  if (
    invokes.dynamicCalls.length >
      0
  ) {
    for (
      const file of
      invokes.dynamicCalls
    ) {
      violations.push(
        violation(
          "L1NAT013",
          file,
          "invoke dinâmico impede auditoria estática do schema IPC.",
        ),
      );
    }
  }

  if (
    invokes.anyCalls.length >
      0
  ) {
    for (
      const file of
      invokes.anyCalls
    ) {
      violations.push(
        violation(
          "L1NAT014",
          file,
          "invoke<any> é proibido no boundary nativo.",
        ),
      );
    }
  }

  const steam =
    read(
      root,
      "src-tauri/src/steam.rs",
    );

  if (
    !hasAll(
      steam,
      [
        "validate_identifier",
        "parse_steam_id",
        "validate_channel",
        "validate_packet_size",
        "validate_cloud_file_name",
      ],
    )
  ) {
    violations.push(
      violation(
        "L1NAT020",
        "src-tauri/src/steam.rs",
        "Steam IPC não comprova validação nativa de identifiers/channel/packet/cloud path.",
      ),
    );
  }

  const modding =
    read(
      root,
      "src-tauri/src/modding.rs",
    );

  if (
    !hasAll(
      modding,
      [
        "MAX_MOD_MANIFEST_BYTES",
        "validate_manifest",
        "validate_relative_mod_path",
        "validate_workshop_item_id",
        "canonicalize()",
      ],
    )
  ) {
    violations.push(
      violation(
        "L1NAT021",
        "src-tauri/src/modding.rs",
        "Modding IPC não comprova limites, path traversal defense e canonicalização.",
      ),
    );
  }

  const monetization =
    read(
      root,
      "src-tauri/src/monetization.rs",
    );

  if (
    !hasAll(
      monetization,
      [
        "validate_sku",
        "validate_identifier",
        "validate_amount_cents",
        "validate_quantity",
        "fail-closed",
      ],
    )
  ) {
    violations.push(
      violation(
        "L1NAT022",
        "src-tauri/src/monetization.rs",
        "Monetization IPC não comprova validação e fail-closed.",
      ),
    );
  }

  if (
    /STEAM_SECRET|SECRET_SALT|76561198000000000/u.test(
      monetization,
    )
  ) {
    violations.push(
      violation(
        "L1NAT023",
        "src-tauri/src/monetization.rs",
        "segredo/SteamID sintético hardcoded encontrado em boundary monetário.",
      ),
    );
  }

  const security =
    read(
      root,
      "src-tauri/src/security.rs",
    );

  if (
    !hasAll(
      security,
      [
        "MAX_CRASH_DUMP_BYTES",
        "validate_crash_id",
        ".app_log_dir()",
      ],
    )
  ) {
    violations.push(
      violation(
        "L1NAT024",
        "src-tauri/src/security.rs",
        "Crash dump IPC não comprova tamanho máximo, ID sanitizado e diretório gerenciado pelo Tauri.",
      ),
    );
  }

  const overlay =
    read(
      root,
      "src-tauri/src/overlay.rs",
    );

  if (
    !overlay.includes(
      "normalize_dock_position",
    )
  ) {
    violations.push(
      violation(
        "L1NAT025",
        "src-tauri/src/overlay.rs",
        "Overlay IPC não valida dock position.",
      ),
    );
  }

  const moddingDriver =
    read(
      root,
      "src/engine/modding/internal/TauriModdingDriver.ts",
    );

  if (
    !hasAll(
      moddingDriver,
      [
        "WORKSHOP_ITEM_ID_PATTERN",
        "MAX_LOCAL_PATH_LENGTH",
        "isTauriRuntime",
        "steam_workshop_download_item",
        "wrapInvokeError",
      ],
    )
  ) {
    violations.push(
      violation(
        "L1NAT030",
        "TauriModdingDriver",
        "driver não comprova validação TS + Steamworks real + error mapping.",
      ),
    );
  }

  const monetizationDriver =
    read(
      root,
      "src/engine/monetization/internal/TauriMonetizationDriver.ts",
    );

  if (
    !hasAll(
      monetizationDriver,
      [
        "SKU_PATTERN",
        "IDENTIFIER_PATTERN",
        "isValidAmount",
        "isValidQuantity",
        "isTauriRuntime",
      ],
    )
  ) {
    violations.push(
      violation(
        "L1NAT031",
        "TauriMonetizationDriver",
        "driver monetário não comprova validação TS e runtime gating.",
      ),
    );
  }

  if (
    /catch\s*(?:\([^)]*\))?\s*\{[\s\S]{0,500}?return\s+true\s*;/u.test(
      monetizationDriver,
    )
  ) {
    violations.push(
      violation(
        "L1NAT032",
        "TauriMonetizationDriver",
        "erro IPC monetário ainda possui fallback fail-open retornando true.",
      ),
    );
  }

  const tauriConfig =
    JSON.parse(
      read(
        root,
        "src-tauri/tauri.conf.json",
      ),
    );

  if (
    tauriConfig?.app
      ?.withGlobalTauri !==
      false
  ) {
    violations.push(
      violation(
        "L1NAT040",
        "src-tauri/tauri.conf.json",
        "withGlobalTauri precisa estar desabilitado; imports ESM são o boundary oficial.",
      ),
    );
  }

  const csp =
    tauriConfig?.app
      ?.security
      ?.csp;

  if (
    typeof csp !==
      "string" ||
    csp.trim().length ===
      0
  ) {
    violations.push(
      violation(
        "L1NAT041",
        "src-tauri/tauri.conf.json",
        "CSP de produção não pode ser null/vazio.",
      ),
    );
  }

  const capabilities =
    JSON.parse(
      read(
        root,
        "src-tauri/capabilities/default.json",
      ),
    );

  if (
    !Array.isArray(
      capabilities.windows,
    ) ||
    capabilities.windows.length !==
      1 ||
    capabilities.windows[0] !==
      "main"
  ) {
    violations.push(
      violation(
        "L1NAT042",
        "src-tauri/capabilities/default.json",
        "capability padrão deve ficar limitada à janela main.",
      ),
    );
  }

  for (
    const permission of
    capabilities.permissions ??
    []
  ) {
    if (
      typeof permission !==
        "string"
    ) {
      continue;
    }

    if (
      permission.includes(
        "*",
      ) ||
      permission.startsWith(
        "shell:",
      ) ||
      permission.startsWith(
        "fs:",
      )
    ) {
      violations.push(
        violation(
          "L1NAT043",
          "src-tauri/capabilities/default.json",
          `permissão ampla/privilegiada não permitida na capability default: ${permission}`,
        ),
      );
    }
  }

  const host =
    read(
      root,
      "src-tauri/src/lib.rs",
    );

  if (
    !host.includes(
      "app_handle.state::<SteamState>().shutdown()",
    )
  ) {
    violations.push(
      violation(
        "L1NAT050",
        "src-tauri/src/lib.rs",
        "host nativo não comprova shutdown explícito do SteamState.",
      ),
    );
  }

  if (
    !hasAll(
      steam,
      [
        "callback_stop.store",
        "handle.join()",
        "impl Drop for SteamState",
      ],
    )
  ) {
    violations.push(
      violation(
        "L1NAT051",
        "src-tauri/src/steam.rs",
        "callback pump nativo não comprova stop + join + Drop.",
      ),
    );
  }

  if (
    host.includes(
      'std::env::set_var("SteamAppId"',
    ) ||
    host.includes(
      'std::env::set_var("SteamGameId"',
    )
  ) {
    violations.push(
      violation(
        "L1NAT052",
        "src-tauri/src/lib.rs",
        "AppID Steam de desenvolvimento não pode ser hardcoded no host.",
      ),
    );
  }

  const [
    publicApi,
    capabilityGraph,
    lifecycle,
    steamworks,
  ] =
    await Promise.all([
      auditLayer1PublicApi({
        projectRoot:
          root,
      }),

      auditLayer1CapabilityGraph({
        projectRoot:
          root,
      }),

      auditLayer1Lifecycle({
        projectRoot:
          root,
      }),

      auditLayer1Steamworks({
        projectRoot:
          root,
      }),
    ]);

  addCompatibilityViolation(
    violations,
    "L1NAT060",
    "stage72",
    publicApi,
    "Stage72 public API deixou de passar.",
  );

  addCompatibilityViolation(
    violations,
    "L1NAT061",
    "stage73",
    capabilityGraph,
    "Stage73 capability graph deixou de passar.",
  );

  addCompatibilityViolation(
    violations,
    "L1NAT062",
    "stage74",
    lifecycle,
    "Stage74 lifecycle deixou de passar.",
  );

  addCompatibilityViolation(
    violations,
    "L1NAT063",
    "stage84",
    steamworks,
    "Stage84 Steamworks deixou de passar.",
  );

  violations.sort(
    (
      first,
      second,
    ) =>
      `${first.code}|${first.scope}|${first.message}`
        .localeCompare(
          `${second.code}|${second.scope}|${second.message}`,
        ),
  );

  return Object.freeze({
    version:
      LAYER1_NATIVE_TAURI_AUDIT_VERSION,

    baselineId:
      baseline.baselineId,

    nativeCommandCount:
      rust.registered.size,

    invokedCommandCount:
      new Set(
        invokes.commands
          .map(
            (
              entry,
            ) =>
              entry.command,
          ),
      ).size,

    compatibility:
      Object.freeze({
        stage72:
          publicApi.ok,

        stage73:
          capabilityGraph.ok,

        stage74:
          lifecycle.ok,

        stage84:
          steamworks.ok,
      }),

    violations:
      Object.freeze(
        violations,
      ),

    ok:
      violations.length ===
      0,
  });
}

export function formatLayer1NativeTauriAudit(
  result,
) {
  const lines = [
    "============================================================",
    " STAGE 85 — NATIVE / TAURI INFRASTRUCTURE AUDIT",
    "============================================================",
    `[INFO] Audit version: ${result.version}`,
    `[INFO] Baseline: ${result.baselineId}`,
    `[INFO] Native commands registered: ${String(result.nativeCommandCount)}`,
    `[INFO] TS invoke commands: ${String(result.invokedCommandCount)}`,
    `[INFO] Stage72 public API: ${result.compatibility.stage72 ? "PASS" : "FAIL"}`,
    `[INFO] Stage73 capability graph: ${result.compatibility.stage73 ? "PASS" : "FAIL"}`,
    `[INFO] Stage74 lifecycle: ${result.compatibility.stage74 ? "PASS" : "FAIL"}`,
    `[INFO] Stage84 Steamworks: ${result.compatibility.stage84 ? "PASS" : "FAIL"}`,
  ];

  if (
    result.ok
  ) {
    lines.push(
      "[OK] Native bridges e invoke_handler possuem paridade.",
      "[OK] IPC usa comandos literais e não contém invoke<any>.",
      "[OK] Input validation existe em TS e Rust para boundaries sensíveis.",
      "[OK] Monetização/Workshop incompletos falham fechados; nenhum sucesso sintético nativo.",
      "[OK] Capability Tauri está limitada à main e global Tauri está desabilitado.",
      "[OK] CSP de produção está explícita.",
      "[OK] Steam native callback pump possui stop/join/Drop.",
      "STAGE 85 AUDIT: PASS",
    );
  } else {
    for (
      const item of
      result.violations
    ) {
      lines.push(
        `[FAIL] ${item.code} ${item.scope}: ${item.message}`,
      );
    }

    lines.push(
      "STAGE 85 AUDIT: FAIL",
    );
  }

  return `${lines.join("\n")}\n`;
}
