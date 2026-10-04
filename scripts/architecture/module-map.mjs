#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const MODULE_MAP_SCHEMA_VERSION = 1;
export const ARCHITECTURE_MIGRATION_VERSION = "v20";
export const STAGE_NAME = "stage-4-canonical-module-map";
export const STAGE4_OUTPUT_ROOT = ".migration/stage4";

function deepFreeze(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  Object.freeze(value);

  for (const nestedValue of Object.values(value)) {
    deepFreeze(nestedValue);
  }

  return value;
}

function functionalModule({
  layer,
  key,
  displayName,
  capabilityId,
  enginePresentInStage3 = true,
  contracts,
  tokens,
  plugin,
  nativeFiles = [],
  tests = [],
  extraFiles = [],
  implementationOrigin = "engine",
}) {
  return {
    layer,
    key,
    displayName,
    category: "functional",
    firstParty: true,
    bootstrapped: true,
    capabilityId,
    capabilityVersion: "1.0.0",
    engine: {
      directoryName: key,
      root: `src/engine/${key}`,
      publicRoot: `src/engine/${key}/public`,
      internalRoot: `src/engine/${key}/internal`,
      presentInStage3: enginePresentInStage3,
      implementationOrigin,
    },
    contracts,
    tokens,
    plugin,
    nativeFiles,
    tests,
    extraFiles,
  };
}

function runtimeModule({
  key,
  displayName,
  capabilityId,
  enginePresentInStage3,
  contracts,
  tokens,
  plugin,
  tests = [],
  extraFiles = [],
  implementationOrigin,
}) {
  return {
    layer: null,
    key,
    displayName,
    category: "runtime",
    firstParty: true,
    bootstrapped: true,
    capabilityId,
    capabilityVersion: "1.0.0",
    engine: {
      directoryName: key,
      root: `src/engine/${key}`,
      publicRoot: `src/engine/${key}/public`,
      internalRoot: `src/engine/${key}/internal`,
      presentInStage3: enginePresentInStage3,
      implementationOrigin,
    },
    contracts,
    tokens,
    plugin,
    nativeFiles: [],
    tests,
    extraFiles,
  };
}

/**
 * Catálogo canônico dos 20 módulos funcionais first-party.
 *
 * Esta ordem preserva as camadas congeladas 1..20 existentes no Projeto1.
 * Ela não representa necessariamente boot order; boot order continua sendo
 * responsabilidade do Kernel/manifests.
 */
export const FUNCTIONAL_MODULES = deepFreeze([
  functionalModule({
    layer: 1,
    key: "steam",
    displayName: "Steamworks & P2P",
    capabilityId: "game.steam",
    enginePresentInStage3: false,
    implementationOrigin: "plugin-native",
    contracts: [
      "src/contracts/steam/types.ts",
      "src/contracts/steam/net-types.ts",
    ],
    tokens: [
      {
        path: "src/tokens/steam.ts",
        capabilityId: "game.steam",
        version: "1.0.0",
        primary: true,
      },
      {
        path: "src/tokens/steam-net.ts",
        capabilityId: "game.steam.net",
        version: "1.0.0",
        primary: false,
      },
    ],
    plugin: "src/plugins/steam/plugin.ts",
    nativeFiles: [
      "src-tauri/src/steam.rs",
    ],
    tests: [
      "tests/steam-integration.test.ts",
      "tests/steam-p2p-smoke.mjs",
      "tests/steam-smoke-test.mjs",
    ],
    extraFiles: [
      "steam_appid.txt",
      "src-tauri/steam_appid.txt",
    ],
  }),

  functionalModule({
    layer: 2,
    key: "input",
    displayName: "Input Manager",
    capabilityId: "game.input",
    contracts: [
      "src/contracts/input/types.ts",
    ],
    tokens: [
      {
        path: "src/tokens/input.ts",
        capabilityId: "game.input",
        version: "1.0.0",
        primary: true,
      },
    ],
    plugin: "src/plugins/input/plugin.ts",
    tests: [
      "tests/input-system.test.ts",
      "tests/input-smoke-test.mjs",
    ],
  }),

  functionalModule({
    layer: 3,
    key: "assets",
    displayName: "Asset Pipeline & VRAM Cache",
    capabilityId: "game.assets",
    contracts: [
      "src/contracts/assets/types.ts",
    ],
    tokens: [
      {
        path: "src/tokens/assets.ts",
        capabilityId: "game.assets",
        version: "1.0.0",
        primary: true,
      },
    ],
    plugin: "src/plugins/assets/plugin.ts",
    tests: [
      "tests/assets-pipeline.test.ts",
      "tests/assets-smoke-test.mjs",
    ],
  }),

  functionalModule({
    layer: 4,
    key: "physics",
    displayName: "Motor de Física (Rapier WASM)",
    capabilityId: "game.physics",
    contracts: [
      "src/contracts/physics/types.ts",
    ],
    tokens: [
      {
        path: "src/tokens/physics.ts",
        capabilityId: "game.physics",
        version: "1.0.0",
        primary: true,
      },
    ],
    plugin: "src/plugins/physics/plugin.ts",
    tests: [
      "tests/physics-system.test.ts",
      "tests/physics-smoke-test.mjs",
    ],
  }),

  functionalModule({
    layer: 5,
    key: "storage",
    displayName: "Persistência & Banco de Dados",
    capabilityId: "game.storage",
    contracts: [
      "src/contracts/storage/types.ts",
    ],
    tokens: [
      {
        path: "src/tokens/storage.ts",
        capabilityId: "game.storage",
        version: "1.0.0",
        primary: true,
      },
    ],
    plugin: "src/plugins/storage/plugin.ts",
    tests: [
      "tests/storage-system.test.ts",
      "tests/storage-smoke-test.mjs",
      "tests/storage-cloud-db.test.ts",
      "tests/storage-persistence.test.ts",
    ],
  }),

  functionalModule({
    layer: 6,
    key: "world",
    displayName: "Gerenciador de Mundo, Cenas & ECS",
    capabilityId: "game.world",
    contracts: [
      "src/contracts/world/types.ts",
    ],
    tokens: [
      {
        path: "src/tokens/world.ts",
        capabilityId: "game.world",
        version: "1.0.0",
        primary: true,
      },
    ],
    plugin: "src/plugins/world/plugin.ts",
    tests: [
      "tests/world-system.test.ts",
      "tests/world-smoke-test.mjs",
    ],
  }),

  functionalModule({
    layer: 7,
    key: "ui",
    displayName: "Interface de Usuário & HUD",
    capabilityId: "game.ui",
    contracts: [
      "src/contracts/ui/types.ts",
    ],
    tokens: [
      {
        path: "src/tokens/ui.ts",
        capabilityId: "game.ui",
        version: "1.0.0",
        primary: true,
      },
    ],
    plugin: "src/plugins/ui/plugin.ts",
    tests: [
      "tests/ui-system.test.ts",
      "tests/ui-smoke-test.mjs",
    ],
    extraFiles: [
      "src/styles/ui.css",
    ],
  }),

  functionalModule({
    layer: 8,
    key: "anim",
    displayName: "Pipeline de Animações & State Machines",
    capabilityId: "game.anim",
    contracts: [
      "src/contracts/anim/types.ts",
    ],
    tokens: [
      {
        path: "src/tokens/anim.ts",
        capabilityId: "game.anim",
        version: "1.0.0",
        primary: true,
      },
    ],
    plugin: "src/plugins/anim/plugin.ts",
    tests: [
      "tests/anim-system.test.ts",
      "tests/anim-smoke-test.mjs",
    ],
  }),

  functionalModule({
    layer: 9,
    key: "sprites",
    displayName: "Motor 2D, Tilemaps & Pixel Art",
    capabilityId: "game.sprites",
    contracts: [
      "src/contracts/sprites/types.ts",
    ],
    tokens: [
      {
        path: "src/tokens/sprites.ts",
        capabilityId: "game.sprites",
        version: "1.0.0",
        primary: true,
      },
    ],
    plugin: "src/plugins/sprites/plugin.ts",
    tests: [
      "tests/sprites-system.test.ts",
      "tests/sprites-smoke-test.mjs",
    ],
  }),

  functionalModule({
    layer: 10,
    key: "audio",
    displayName: "Mixer de Áudio Espacial 3D",
    capabilityId: "game.audio",
    contracts: [
      "src/contracts/audio/types.ts",
    ],
    tokens: [
      {
        path: "src/tokens/audio.ts",
        capabilityId: "game.audio",
        version: "1.0.0",
        primary: true,
      },
    ],
    plugin: "src/plugins/audio/plugin.ts",
    tests: [
      "tests/audio-system.test.ts",
      "tests/audio-smoke-test.mjs",
    ],
  }),

  functionalModule({
    layer: 11,
    key: "camera",
    displayName: "Câmera Dinâmica & SpringArm",
    capabilityId: "game.camera",
    contracts: [
      "src/contracts/camera/types.ts",
    ],
    tokens: [
      {
        path: "src/tokens/camera.ts",
        capabilityId: "game.camera",
        version: "1.0.0",
        primary: true,
      },
    ],
    plugin: "src/plugins/camera/plugin.ts",
    tests: [
      "tests/camera-system.test.ts",
      "tests/camera-smoke-test.mjs",
    ],
  }),

  functionalModule({
    layer: 12,
    key: "ai",
    displayName: "Inteligência Artificial & NavMesh",
    capabilityId: "game.ai",
    contracts: [
      "src/contracts/ai/types.ts",
    ],
    tokens: [
      {
        path: "src/tokens/ai.ts",
        capabilityId: "game.ai",
        version: "1.0.0",
        primary: true,
      },
    ],
    plugin: "src/plugins/ai/plugin.ts",
    tests: [
      "tests/ai-system.test.ts",
      "tests/ai-smoke-test.mjs",
    ],
  }),

  functionalModule({
    layer: 13,
    key: "vfx",
    displayName: "Partículas GPU, Decals & Pós-Processamento",
    capabilityId: "game.vfx",
    contracts: [
      "src/contracts/vfx/types.ts",
    ],
    tokens: [
      {
        path: "src/tokens/vfx.ts",
        capabilityId: "game.vfx",
        version: "1.0.0",
        primary: true,
      },
    ],
    plugin: "src/plugins/vfx/plugin.ts",
    tests: [
      "tests/vfx-system.test.ts",
      "tests/vfx-smoke-test.mjs",
    ],
  }),

  functionalModule({
    layer: 14,
    key: "terrain",
    displayName: "Terreno Procedural, Biomas & Voxels",
    capabilityId: "game.terrain",
    contracts: [
      "src/contracts/terrain/types.ts",
    ],
    tokens: [
      {
        path: "src/tokens/terrain.ts",
        capabilityId: "game.terrain",
        version: "1.0.0",
        primary: true,
      },
    ],
    plugin: "src/plugins/terrain/plugin.ts",
    tests: [
      "tests/terrain-system.test.ts",
      "tests/terrain-smoke-test.mjs",
    ],
  }),

  functionalModule({
    layer: 15,
    key: "scripting",
    displayName: "Cutscenes, Diálogos & Quests",
    capabilityId: "game.scripting",
    contracts: [
      "src/contracts/scripting/types.ts",
    ],
    tokens: [
      {
        path: "src/tokens/scripting.ts",
        capabilityId: "game.scripting",
        version: "1.0.0",
        primary: true,
      },
    ],
    plugin: "src/plugins/scripting/plugin.ts",
    tests: [
      "tests/scripting-system.test.ts",
      "tests/scripting-smoke-test.mjs",
    ],
  }),

  functionalModule({
    layer: 16,
    key: "streaming",
    displayName: "Streaming Espacial, LOD & HLOD",
    capabilityId: "game.streaming",
    contracts: [
      "src/contracts/streaming/types.ts",
    ],
    tokens: [
      {
        path: "src/tokens/streaming.ts",
        capabilityId: "game.streaming",
        version: "1.0.0",
        primary: true,
      },
    ],
    plugin: "src/plugins/streaming/plugin.ts",
    tests: [
      "tests/streaming-system.test.ts",
      "tests/streaming-smoke-test.mjs",
    ],
  }),

  functionalModule({
    layer: 17,
    key: "overlay",
    displayName: "Desktop Overlay & Raycast Click Passthrough",
    capabilityId: "game.overlay",
    contracts: [
      "src/contracts/overlay/types.ts",
    ],
    tokens: [
      {
        path: "src/tokens/overlay.ts",
        capabilityId: "game.overlay",
        version: "1.0.0",
        primary: true,
      },
    ],
    plugin: "src/plugins/overlay/plugin.ts",
    nativeFiles: [
      "src-tauri/src/overlay.rs",
    ],
    tests: [
      "tests/overlay-system.test.ts",
      "tests/overlay-smoke-test.mjs",
    ],
  }),

  functionalModule({
    layer: 18,
    key: "security",
    displayName: "Profiler, Anti-cheat & Crash Dumper",
    capabilityId: "game.security",
    contracts: [
      "src/contracts/security/types.ts",
    ],
    tokens: [
      {
        path: "src/tokens/security.ts",
        capabilityId: "game.security",
        version: "1.0.0",
        primary: true,
      },
    ],
    plugin: "src/plugins/security/plugin.ts",
    nativeFiles: [
      "src-tauri/src/security.rs",
    ],
    tests: [
      "tests/security-system.test.ts",
      "tests/security-smoke-test.mjs",
    ],
  }),

  functionalModule({
    layer: 19,
    key: "modding",
    displayName: "Steam Workshop, Dynamic Loading & Asset Override",
    capabilityId: "game.modding",
    contracts: [
      "src/contracts/modding/types.ts",
    ],
    tokens: [
      {
        path: "src/tokens/modding.ts",
        capabilityId: "game.modding",
        version: "1.0.0",
        primary: true,
      },
    ],
    plugin: "src/plugins/modding/plugin.ts",
    nativeFiles: [
      "src-tauri/src/modding.rs",
    ],
    tests: [
      "tests/modding-system.test.ts",
      "tests/modding-smoke-test.mjs",
    ],
  }),

  functionalModule({
    layer: 20,
    key: "monetization",
    displayName: "Microtransações Steam & Steam Inventory Service",
    capabilityId: "game.monetization",
    contracts: [
      "src/contracts/monetization/types.ts",
    ],
    tokens: [
      {
        path: "src/tokens/monetization.ts",
        capabilityId: "game.monetization",
        version: "1.0.0",
        primary: true,
      },
    ],
    plugin: "src/plugins/monetization/plugin.ts",
    nativeFiles: [
      "src-tauri/src/monetization.rs",
    ],
    tests: [
      "tests/monetization-system.test.ts",
      "tests/monetization-smoke-test.mjs",
    ],
  }),
]);

/**
 * Capacidades fundamentais do runtime.
 *
 * São first-party e participam do bootstrap, mas não são numeradas como uma
 * das 20 camadas funcionais congeladas.
 */
export const RUNTIME_MODULES = deepFreeze([
  runtimeModule({
    key: "game-loop",
    displayName: "Deterministic Game Loop",
    capabilityId: "game.loop",
    enginePresentInStage3: false,
    implementationOrigin: "plugin",
    contracts: [
      "src/contracts/game-loop/types.ts",
    ],
    tokens: [
      {
        path: "src/tokens/game-loop.ts",
        capabilityId: "game.loop",
        version: "1.0.0",
        primary: true,
      },
    ],
    plugin: "src/plugins/game-loop/plugin.ts",
  }),

  runtimeModule({
    key: "render",
    displayName: "Render Runtime",
    capabilityId: "game.render",
    enginePresentInStage3: true,
    implementationOrigin: "engine",
    contracts: [
      "src/contracts/render/types.ts",
    ],
    tokens: [
      {
        path: "src/tokens/render.ts",
        capabilityId: "game.render",
        version: "1.0.0",
        primary: true,
      },
    ],
    plugin: "src/plugins/render/plugin.ts",
  }),

  runtimeModule({
    key: "net",
    displayName: "Multiplayer Network & State Replication",
    capabilityId: "game.net",
    enginePresentInStage3: true,
    implementationOrigin: "engine",
    contracts: [
      "src/contracts/net/types.ts",
    ],
    tokens: [
      {
        path: "src/tokens/net.ts",
        capabilityId: "game.net",
        version: "1.0.0",
        primary: true,
      },
    ],
    plugin: "src/plugins/net/plugin.ts",
  }),
]);

export const CANONICAL_MODULES = deepFreeze([
  ...FUNCTIONAL_MODULES,
  ...RUNTIME_MODULES,
]);

export const TOOLING_PLUGINS = deepFreeze([
  {
    key: "debug",
    pluginId: "game.debug",
    plugin: "src/plugins/debug/plugin.ts",
    category: "tooling",
    bootstrapped: true,
    canonicalEngineModule: false,
  },
]);

export const EXPERIMENTAL_PLUGINS = deepFreeze([
  {
    key: "player",
    pluginId: "game.player",
    plugin: "src/plugins/player/plugin.ts",
    category: "experimental",
    bootstrapped: false,
    canonicalEngineModule: false,
    status: "orphaned-not-in-createEnginePlugins",
  },
]);

export const EXPECTED_STAGE3_ENGINE_MODULES = deepFreeze(
  CANONICAL_MODULES
    .filter((moduleRecord) => moduleRecord.engine.presentInStage3)
    .map((moduleRecord) => moduleRecord.engine.directoryName)
    .sort((a, b) => a.localeCompare(b, "en")),
);

export const EXPECTED_STAGE3_PLUGINS = deepFreeze(
  [
    ...CANONICAL_MODULES.map((moduleRecord) => moduleRecord.key),
    ...TOOLING_PLUGINS.map((record) => record.key),
    ...EXPERIMENTAL_PLUGINS.map((record) => record.key),
  ].sort((a, b) => a.localeCompare(b, "en")),
);

export const EXPECTED_STAGE3_TOKENS = deepFreeze(
  CANONICAL_MODULES
    .flatMap((moduleRecord) => moduleRecord.tokens)
    .map((tokenRecord) =>
      path.posix.basename(
        tokenRecord.path,
        path.posix.extname(tokenRecord.path),
      ),
    )
    .sort((a, b) => a.localeCompare(b, "en")),
);

export const EXPECTED_STAGE3_CONTRACT_AREAS = deepFreeze(
  [
    ...new Set(
      CANONICAL_MODULES.flatMap((moduleRecord) =>
        moduleRecord.contracts.map((contractPath) => {
          const rest = contractPath.slice("src/contracts/".length);
          return rest.split("/")[0];
        }),
      ),
    ),
  ].sort((a, b) => a.localeCompare(b, "en")),
);

const MODULE_BY_KEY = new Map(
  CANONICAL_MODULES.map((moduleRecord) => [
    moduleRecord.key,
    moduleRecord,
  ]),
);

const MODULE_BY_PRIMARY_CAPABILITY = new Map(
  CANONICAL_MODULES.map((moduleRecord) => [
    moduleRecord.capabilityId,
    moduleRecord,
  ]),
);

const MODULE_BY_OWNED_CAPABILITY = new Map();

for (const moduleRecord of CANONICAL_MODULES) {
  for (const tokenRecord of moduleRecord.tokens) {
    MODULE_BY_OWNED_CAPABILITY.set(
      tokenRecord.capabilityId,
      moduleRecord,
    );
  }
}

export function getCanonicalModule(key) {
  return MODULE_BY_KEY.get(key) ?? null;
}

export function getModuleByPrimaryCapability(capabilityId) {
  return MODULE_BY_PRIMARY_CAPABILITY.get(capabilityId) ?? null;
}

export function getModuleByOwnedCapability(capabilityId) {
  return MODULE_BY_OWNED_CAPABILITY.get(capabilityId) ?? null;
}

export function getFunctionalModule(layerOrKey) {
  if (typeof layerOrKey === "number") {
    return (
      FUNCTIONAL_MODULES.find(
        (moduleRecord) => moduleRecord.layer === layerOrKey,
      ) ?? null
    );
  }

  return (
    FUNCTIONAL_MODULES.find(
      (moduleRecord) => moduleRecord.key === layerOrKey,
    ) ?? null
  );
}

export function getRuntimeModule(key) {
  return (
    RUNTIME_MODULES.find(
      (moduleRecord) => moduleRecord.key === key,
    ) ?? null
  );
}

export function getCanonicalModuleKeys() {
  return CANONICAL_MODULES.map((moduleRecord) => moduleRecord.key);
}

export function getTargetEngineRoots() {
  return CANONICAL_MODULES.map((moduleRecord) => moduleRecord.engine.root);
}

export function getTargetPublicRoots() {
  return CANONICAL_MODULES.map((moduleRecord) => moduleRecord.engine.publicRoot);
}

export function getTargetInternalRoots() {
  return CANONICAL_MODULES.map((moduleRecord) => moduleRecord.engine.internalRoot);
}

export function getAllCanonicalTokenRecords() {
  return CANONICAL_MODULES.flatMap((moduleRecord) =>
    moduleRecord.tokens.map((tokenRecord) => ({
      moduleKey: moduleRecord.key,
      ...tokenRecord,
    })),
  );
}

export function getAllCanonicalContractPaths() {
  return CANONICAL_MODULES.flatMap(
    (moduleRecord) => moduleRecord.contracts,
  );
}

export function getAllCanonicalPluginPaths() {
  return CANONICAL_MODULES.map(
    (moduleRecord) => moduleRecord.plugin,
  );
}

export function getAllKnownPluginPaths() {
  return [
    ...getAllCanonicalPluginPaths(),
    ...TOOLING_PLUGINS.map((record) => record.plugin),
    ...EXPERIMENTAL_PLUGINS.map((record) => record.plugin),
  ];
}

function fail(message) {
  throw new Error(message);
}

function normalizeAbsolute(inputPath) {
  const resolved = path.resolve(inputPath);
  const normalized = path.normalize(resolved);

  return process.platform === "win32"
    ? normalized.toLowerCase()
    : normalized;
}

function toPosixRelative(rootDir, absolutePath) {
  return path.relative(rootDir, absolutePath).split(path.sep).join("/");
}

function runCommand(executable, args, cwd, allowFailure = false) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    if (allowFailure) {
      return null;
    }

    throw result.error;
  }

  if (result.status !== 0) {
    if (allowFailure) {
      return null;
    }

    const stderr = String(result.stderr ?? "").trim();

    fail(
      stderr.length > 0
        ? `${executable} ${args.join(" ")} falhou: ${stderr}`
        : `${executable} ${args.join(" ")} falhou com código ${String(result.status)}.`,
    );
  }

  return String(result.stdout ?? "").trimEnd();
}

function runGit(args, cwd, allowFailure = false) {
  return runCommand("git", args, cwd, allowFailure);
}

function assertRepositoryRoot(cwd) {
  const inside = runGit(
    ["rev-parse", "--is-inside-work-tree"],
    cwd,
  );

  if (inside !== "true") {
    fail(
      "O diretório atual não pertence a um repositório Git.",
    );
  }

  const gitRootRaw = runGit(
    ["rev-parse", "--show-toplevel"],
    cwd,
  );

  if (
    normalizeAbsolute(cwd) !==
    normalizeAbsolute(gitRootRaw)
  ) {
    fail(
      [
        "Este script deve ser executado exatamente na raiz do repositório.",
        `Diretório atual: ${cwd}`,
        `Raiz detectada: ${gitRootRaw}`,
      ].join("\n"),
    );
  }

  return path.resolve(gitRootRaw);
}

function readJson(filePath, displayPath) {
  try {
    return JSON.parse(
      fs.readFileSync(filePath, "utf8"),
    );
  } catch (error) {
    fail(
      `JSON inválido em ${displayPath}: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`,
    );
  }
}

function loadStage3Inventory(rootDir) {
  const stage3Root = path.join(
    rootDir,
    ".migration",
    "stage3",
  );
  const latestPath = path.join(
    stage3Root,
    "LATEST",
  );

  if (!fs.existsSync(latestPath)) {
    fail(
      "Pré-condição ausente: .migration/stage3/LATEST",
    );
  }

  const runId = fs.readFileSync(latestPath, "utf8").trim();

  if (runId.length === 0) {
    fail(
      ".migration/stage3/LATEST está vazio.",
    );
  }

  const reportPath = path.join(
    stage3Root,
    runId,
    "architecture-inventory.json",
  );

  if (!fs.existsSync(reportPath)) {
    fail(
      `Inventário da Etapa 3 ausente: ${toPosixRelative(rootDir, reportPath)}`,
    );
  }

  const inventory = readJson(
    reportPath,
    toPosixRelative(rootDir, reportPath),
  );

  if (
    inventory.stage !== "stage-3-architecture-inventory"
  ) {
    fail(
      `Stage inesperado no inventário: ${String(inventory.stage)}`,
    );
  }

  if (
    inventory.preconditions?.freezeUnlocked !== true
  ) {
    fail(
      "O inventário da Etapa 3 não registra freeze desbloqueado.",
    );
  }

  if (
    inventory.parseErrorCount !== 0
  ) {
    fail(
      `A Etapa 3 registrou ${String(inventory.parseErrorCount)} erro(s) de parsing. O module map não será consolidado sobre um inventário sintaticamente inconsistente.`,
    );
  }

  return {
    runId,
    reportPath: toPosixRelative(rootDir, reportPath),
    inventory,
  };
}

function assertFreezeStillUnlocked(rootDir) {
  const lockPath = path.join(
    rootDir,
    "tests",
    ".freeze-lock.json",
  );

  if (fs.existsSync(lockPath)) {
    fail(
      [
        "O freeze foi reativado antes da Etapa 4.",
        "tests/.freeze-lock.json existe novamente.",
        "A Etapa 4 exige o estado desbloqueado deixado pela Etapa 2.",
      ].join("\n"),
    );
  }
}

function compareSets(actualValues, expectedValues, label) {
  const actual = [...new Set(actualValues)].sort(
    (a, b) => a.localeCompare(b, "en"),
  );
  const expected = [...new Set(expectedValues)].sort(
    (a, b) => a.localeCompare(b, "en"),
  );

  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);

  const missing = expected.filter(
    (value) => !actualSet.has(value),
  );
  const unexpected = actual.filter(
    (value) => !expectedSet.has(value),
  );

  if (
    missing.length > 0 ||
    unexpected.length > 0
  ) {
    fail(
      [
        `Divergência entre module-map e Etapa 3 em ${label}.`,
        `Ausentes no inventário: ${missing.length > 0 ? missing.join(", ") : "(nenhum)"}`,
        `Inesperados no inventário: ${unexpected.length > 0 ? unexpected.join(", ") : "(nenhum)"}`,
      ].join("\n"),
    );
  }

  return {
    label,
    count: expected.length,
    missing,
    unexpected,
    matches: true,
  };
}

function assertUnique(values, label) {
  const seen = new Set();
  const duplicates = new Set();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }

    seen.add(value);
  }

  if (duplicates.size > 0) {
    fail(
      `${label} contém duplicatas: ${[...duplicates].join(", ")}`,
    );
  }
}

function validateCanonicalShape() {
  if (FUNCTIONAL_MODULES.length !== 20) {
    fail(
      `FUNCTIONAL_MODULES deve conter exatamente 20 módulos; encontrou ${String(FUNCTIONAL_MODULES.length)}.`,
    );
  }

  if (RUNTIME_MODULES.length !== 3) {
    fail(
      `RUNTIME_MODULES deve conter exatamente 3 módulos; encontrou ${String(RUNTIME_MODULES.length)}.`,
    );
  }

  if (CANONICAL_MODULES.length !== 23) {
    fail(
      `CANONICAL_MODULES deve conter exatamente 23 módulos; encontrou ${String(CANONICAL_MODULES.length)}.`,
    );
  }

  const expectedLayers = Array.from(
    { length: 20 },
    (_, index) => index + 1,
  );

  const actualLayers = FUNCTIONAL_MODULES.map(
    (moduleRecord) => moduleRecord.layer,
  );

  if (
    JSON.stringify(actualLayers) !==
    JSON.stringify(expectedLayers)
  ) {
    fail(
      `As camadas funcionais devem ser exatamente 1..20 em ordem. Encontrado: ${actualLayers.join(", ")}`,
    );
  }

  assertUnique(
    CANONICAL_MODULES.map((moduleRecord) => moduleRecord.key),
    "module keys",
  );
  assertUnique(
    CANONICAL_MODULES.map((moduleRecord) => moduleRecord.capabilityId),
    "primary capability IDs",
  );
  assertUnique(
    getAllCanonicalTokenRecords().map(
      (tokenRecord) => tokenRecord.capabilityId,
    ),
    "owned capability IDs",
  );
  assertUnique(
    getAllCanonicalPluginPaths(),
    "canonical plugin paths",
  );

  for (const moduleRecord of CANONICAL_MODULES) {
    if (
      moduleRecord.engine.root !==
      `src/engine/${moduleRecord.key}`
    ) {
      fail(
        `engine.root inconsistente para ${moduleRecord.key}.`,
      );
    }

    if (
      moduleRecord.engine.publicRoot !==
      `${moduleRecord.engine.root}/public`
    ) {
      fail(
        `engine.publicRoot inconsistente para ${moduleRecord.key}.`,
      );
    }

    if (
      moduleRecord.engine.internalRoot !==
      `${moduleRecord.engine.root}/internal`
    ) {
      fail(
        `engine.internalRoot inconsistente para ${moduleRecord.key}.`,
      );
    }

    const primaryTokens = moduleRecord.tokens.filter(
      (tokenRecord) => tokenRecord.primary,
    );

    if (primaryTokens.length !== 1) {
      fail(
        `${moduleRecord.key} deve possuir exatamente um token primário.`,
      );
    }

    if (
      primaryTokens[0].capabilityId !==
      moduleRecord.capabilityId
    ) {
      fail(
        `Token primário de ${moduleRecord.key} não corresponde à capability primária.`,
      );
    }
  }

  const steam = getCanonicalModule("steam");

  if (!steam) {
    fail(
      "Módulo canônico steam não encontrado.",
    );
  }

  if (
    !steam.tokens.some(
      (tokenRecord) =>
        tokenRecord.capabilityId === "game.steam.net" &&
        tokenRecord.primary === false,
    )
  ) {
    fail(
      "game.steam.net deve permanecer capability secundária pertencente ao módulo steam.",
    );
  }

  const debug = TOOLING_PLUGINS.find(
    (record) => record.key === "debug",
  );
  const player = EXPERIMENTAL_PLUGINS.find(
    (record) => record.key === "player",
  );

  if (
    !debug ||
    debug.bootstrapped !== true
  ) {
    fail(
      "game.debug deve permanecer tooling bootstrapped.",
    );
  }

  if (
    !player ||
    player.bootstrapped !== false
  ) {
    fail(
      "game.player deve permanecer experimental e fora do bootstrap canônico.",
    );
  }

  return {
    functionalModuleCount: FUNCTIONAL_MODULES.length,
    runtimeModuleCount: RUNTIME_MODULES.length,
    canonicalModuleCount: CANONICAL_MODULES.length,
    toolingPluginCount: TOOLING_PLUGINS.length,
    experimentalPluginCount: EXPERIMENTAL_PLUGINS.length,
    ownedCapabilityCount: getAllCanonicalTokenRecords().length,
  };
}

function validateAgainstStage3(stage3) {
  const inventory = stage3.inventory;

  const engineCheck = compareSets(
    (inventory.engineModules ?? []).map(
      (record) => record.name,
    ),
    EXPECTED_STAGE3_ENGINE_MODULES,
    "engineModules",
  );

  const pluginCheck = compareSets(
    inventory.plugins ?? [],
    EXPECTED_STAGE3_PLUGINS,
    "plugins",
  );

  const tokenCheck = compareSets(
    inventory.tokens ?? [],
    EXPECTED_STAGE3_TOKENS,
    "tokens",
  );

  const contractCheck = compareSets(
    inventory.contractAreas ?? [],
    EXPECTED_STAGE3_CONTRACT_AREAS,
    "contractAreas",
  );

  const stage3EngineByName = new Map(
    (inventory.engineModules ?? []).map(
      (record) => [record.name, record],
    ),
  );

  const engineMetadataChecks = [];

  for (const moduleRecord of CANONICAL_MODULES) {
    const stage3Record = stage3EngineByName.get(
      moduleRecord.engine.directoryName,
    );

    if (moduleRecord.engine.presentInStage3) {
      if (!stage3Record) {
        fail(
          `Módulo ${moduleRecord.key} deveria existir em src/engine no inventário da Etapa 3.`,
        );
      }

      if (
        stage3Record.publicDirectoryPresent !== false ||
        stage3Record.internalDirectoryPresent !== false
      ) {
        fail(
          `Módulo ${moduleRecord.key} já possui public/internal no inventário da Etapa 3; isso contradiz o baseline pré-reestruturação.`,
        );
      }

      engineMetadataChecks.push({
        key: moduleRecord.key,
        stage3FileCount: stage3Record.fileCount,
        stage3SourceFileCount: stage3Record.sourceFileCount,
        workers: stage3Record.workerFiles ?? [],
      });
    } else if (stage3Record) {
      fail(
        `Módulo ${moduleRecord.key} foi marcado como ausente em src/engine na Etapa 3, mas o inventário contém esse diretório.`,
      );
    }
  }

  return {
    stage3RunId: stage3.runId,
    stage3ReportPath: stage3.reportPath,
    stage3TreeSha256:
      inventory.summary?.treeSha256 ?? null,
    engineCheck,
    pluginCheck,
    tokenCheck,
    contractCheck,
    engineMetadataChecks,
  };
}

function assertFile(rootDir, relativePath) {
  const absolutePath = path.join(
    rootDir,
    ...relativePath.split("/"),
  );

  if (!fs.existsSync(absolutePath)) {
    fail(
      `Arquivo obrigatório do module-map não encontrado: ${relativePath}`,
    );
  }

  if (!fs.statSync(absolutePath).isFile()) {
    fail(
      `Path deveria ser arquivo regular: ${relativePath}`,
    );
  }
}

function readProjectText(rootDir, relativePath) {
  assertFile(rootDir, relativePath);

  return fs.readFileSync(
    path.join(
      rootDir,
      ...relativePath.split("/"),
    ),
    "utf8",
  );
}

function validateFilesAndIdentifiers(rootDir) {
  const checkedPaths = new Set();
  const capabilityChecks = [];
  const pluginChecks = [];

  const checkFileOnce = (relativePath) => {
    if (checkedPaths.has(relativePath)) {
      return;
    }

    assertFile(rootDir, relativePath);
    checkedPaths.add(relativePath);
  };

  for (const moduleRecord of CANONICAL_MODULES) {
    for (const contractPath of moduleRecord.contracts) {
      checkFileOnce(contractPath);
    }

    for (const nativePath of moduleRecord.nativeFiles) {
      checkFileOnce(nativePath);
    }

    for (const testPath of moduleRecord.tests) {
      checkFileOnce(testPath);
    }

    for (const extraPath of moduleRecord.extraFiles) {
      checkFileOnce(extraPath);
    }

    checkFileOnce(moduleRecord.plugin);

    const pluginSource = readProjectText(
      rootDir,
      moduleRecord.plugin,
    );

    const pluginIdPattern = new RegExp(
      `\\bid\\s*:\\s*["']${escapeRegExp(moduleRecord.capabilityId)}["']`,
      "m",
    );

    if (!pluginIdPattern.test(pluginSource)) {
      fail(
        `${moduleRecord.plugin} não declara id "${moduleRecord.capabilityId}" conforme o module-map.`,
      );
    }

    pluginChecks.push({
      moduleKey: moduleRecord.key,
      path: moduleRecord.plugin,
      pluginId: moduleRecord.capabilityId,
      matches: true,
    });

    for (const tokenRecord of moduleRecord.tokens) {
      checkFileOnce(tokenRecord.path);

      const tokenSource = readProjectText(
        rootDir,
        tokenRecord.path,
      );

      const capabilityPattern = new RegExp(
        `defineCapability(?:<[^;]*?>)?\\s*\\(\\s*["']${escapeRegExp(tokenRecord.capabilityId)}["']\\s*,\\s*["']${escapeRegExp(tokenRecord.version)}["']`,
        "ms",
      );

      if (!capabilityPattern.test(tokenSource)) {
        fail(
          `${tokenRecord.path} não define capability "${tokenRecord.capabilityId}" versão "${tokenRecord.version}" conforme o module-map.`,
        );
      }

      capabilityChecks.push({
        moduleKey: moduleRecord.key,
        path: tokenRecord.path,
        capabilityId: tokenRecord.capabilityId,
        version: tokenRecord.version,
        primary: tokenRecord.primary,
        matches: true,
      });
    }
  }

  for (const toolingPlugin of TOOLING_PLUGINS) {
    checkFileOnce(toolingPlugin.plugin);

    const source = readProjectText(
      rootDir,
      toolingPlugin.plugin,
    );

    const idPattern = new RegExp(
      `\\bid\\s*:\\s*["']${escapeRegExp(toolingPlugin.pluginId)}["']`,
      "m",
    );

    if (!idPattern.test(source)) {
      fail(
        `${toolingPlugin.plugin} não declara id "${toolingPlugin.pluginId}".`,
      );
    }
  }

  for (const experimentalPlugin of EXPERIMENTAL_PLUGINS) {
    checkFileOnce(experimentalPlugin.plugin);

    const source = readProjectText(
      rootDir,
      experimentalPlugin.plugin,
    );

    const idPattern = new RegExp(
      `\\bid\\s*:\\s*["']${escapeRegExp(experimentalPlugin.pluginId)}["']`,
      "m",
    );

    if (!idPattern.test(source)) {
      fail(
        `${experimentalPlugin.plugin} não declara id "${experimentalPlugin.pluginId}".`,
      );
    }
  }

  return {
    checkedFileCount: checkedPaths.size,
    capabilityChecks,
    pluginChecks,
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function validateBootstrap(rootDir) {
  const relativePath = "src/app/createEnginePlugins.ts";
  const source = readProjectText(
    rootDir,
    relativePath,
  );

  const expectedBootstrappedPluginKeys = [
    ...CANONICAL_MODULES.map(
      (moduleRecord) => moduleRecord.key,
    ),
    ...TOOLING_PLUGINS
      .filter((record) => record.bootstrapped)
      .map((record) => record.key),
  ];

  const expectedPaths = expectedBootstrappedPluginKeys.map(
    (key) => `../plugins/${key}/plugin`,
  );

  const missingImports = expectedPaths.filter(
    (importPath) =>
      !source.includes(
        `"${importPath}"`,
      ) &&
      !source.includes(
        `'${importPath}'`,
      ),
  );

  if (missingImports.length > 0) {
    fail(
      `createEnginePlugins.ts não importa todos os plugins canônicos/tooling esperados: ${missingImports.join(", ")}`,
    );
  }

  const playerImportPath = "../plugins/player/plugin";

  if (
    source.includes(`"${playerImportPath}"`) ||
    source.includes(`'${playerImportPath}'`)
  ) {
    fail(
      "game.player está marcado como experimental/orphaned, mas createEnginePlugins.ts o importa.",
    );
  }

  return {
    path: relativePath,
    expectedBootstrappedPluginCount:
      expectedBootstrappedPluginKeys.length,
    expectedBootstrappedPluginKeys,
    playerExcluded: true,
    matches: true,
  };
}

function getRepositoryMetadata(rootDir) {
  const head = runGit(
    ["rev-parse", "--verify", "HEAD"],
    rootDir,
    true,
  );

  const branch =
    runGit(
      ["symbolic-ref", "--quiet", "--short", "HEAD"],
      rootDir,
      true,
    ) ??
    runGit(
      ["branch", "--show-current"],
      rootDir,
      true,
    ) ??
    "";

  return {
    branch:
      branch.length > 0
        ? branch
        : null,
    head,
    hasCommits: head !== null,
    gitVersion: runGit(
      ["--version"],
      rootDir,
    ),
    status: runGit(
      [
        "status",
        "--short",
        "--branch",
        "--untracked-files=all",
      ],
      rootDir,
    ),
  };
}

function makeRunId(date) {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/u, "Z")
    .replaceAll(":", "-");
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(
    dirPath,
    {
      recursive: true,
    },
  );
}

function writeText(filePath, content) {
  fs.writeFileSync(
    filePath,
    content,
    {
      encoding: "utf8",
    },
  );
}

function writeJson(filePath, value) {
  writeText(
    filePath,
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

function sha256File(filePath) {
  return crypto
    .createHash("sha256")
    .update(
      fs.readFileSync(filePath),
    )
    .digest("hex");
}

function buildSerializableModuleMap() {
  return {
    schemaVersion:
      MODULE_MAP_SCHEMA_VERSION,
    architectureMigrationVersion:
      ARCHITECTURE_MIGRATION_VERSION,
    functionalModules:
      FUNCTIONAL_MODULES,
    runtimeModules:
      RUNTIME_MODULES,
    canonicalModules:
      CANONICAL_MODULES,
    toolingPlugins:
      TOOLING_PLUGINS,
    experimentalPlugins:
      EXPERIMENTAL_PLUGINS,
    expectedStage3: {
      engineModules:
        EXPECTED_STAGE3_ENGINE_MODULES,
      plugins:
        EXPECTED_STAGE3_PLUGINS,
      tokens:
        EXPECTED_STAGE3_TOKENS,
      contractAreas:
        EXPECTED_STAGE3_CONTRACT_AREAS,
    },
  };
}

function buildSummary(report) {
  const lines = [
    "============================================================",
    "  PROJETO1 — ETAPA 4: MODULE MAP CANÔNICO",
    "============================================================",
    "",
    `Run ID: ${report.runId}`,
    `Module Map Schema: ${String(report.schemaVersion)}`,
    `Migração arquitetural: ${report.architectureMigrationVersion}`,
    `Etapa 3 usada: ${report.stage3.runId}`,
    `Tree SHA-256 da Etapa 3: ${report.stage3.treeSha256}`,
    "",
    `Módulos funcionais: ${report.counts.functionalModules}`,
    `Runtimes fundamentais: ${report.counts.runtimeModules}`,
    `Módulos canônicos first-party: ${report.counts.canonicalModules}`,
    `Tooling plugins: ${report.counts.toolingPlugins}`,
    `Plugins experimentais/orphaned: ${report.counts.experimentalPlugins}`,
    `Capabilities pertencentes ao mapa: ${report.counts.ownedCapabilities}`,
    "",
    "Camadas funcionais:",
  ];

  for (const moduleRecord of FUNCTIONAL_MODULES) {
    lines.push(
      `  ${String(moduleRecord.layer).padStart(2, "0")} — ${moduleRecord.key} (${moduleRecord.capabilityId})`,
    );
  }

  lines.push("");
  lines.push("Runtimes fundamentais:");

  for (const moduleRecord of RUNTIME_MODULES) {
    lines.push(
      `  - ${moduleRecord.key} (${moduleRecord.capabilityId})`,
    );
  }

  lines.push("");
  lines.push(
    "Steam ownership adicional: game.steam.net pertence ao módulo steam.",
  );
  lines.push(
    "game.debug permanece tooling e participa do bootstrap.",
  );
  lines.push(
    "game.player permanece experimental/orphaned e fora do bootstrap canônico.",
  );
  lines.push("");
  lines.push(
    `Engine modules presentes na Etapa 3: ${report.stage3Validation.engineCheck.count}`,
  );
  lines.push(
    `Plugins presentes na Etapa 3: ${report.stage3Validation.pluginCheck.count}`,
  );
  lines.push(
    `Tokens presentes na Etapa 3: ${report.stage3Validation.tokenCheck.count}`,
  );
  lines.push(
    `Áreas de contracts presentes na Etapa 3: ${report.stage3Validation.contractCheck.count}`,
  );
  lines.push("");
  lines.push(
    "scripts/architecture/module-map.mjs é a fonte única canônica.",
  );
  lines.push(
    "module-map.snapshot.json é apenas cópia de auditoria da execução da Etapa 4.",
  );
  lines.push(
    "Esta etapa não move implementações e não cria ainda public/internal.",
  );
  lines.push("");

  return lines.join("\n");
}

function writeArtifactChecksums(auditDir) {
  const files = fs
    .readdirSync(
      auditDir,
      {
        withFileTypes: true,
      },
    )
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name !==
          "artifact-checksums.sha256",
    )
    .map(
      (entry) => entry.name,
    )
    .sort(
      (a, b) =>
        a.localeCompare(
          b,
          "en",
        ),
    );

  const lines = files.map(
    (fileName) =>
      `${sha256File(path.join(auditDir, fileName))}  ${fileName}`,
  );

  writeText(
    path.join(
      auditDir,
      "artifact-checksums.sha256",
    ),
    `${lines.join("\n")}\n`,
  );
}

function runStage4() {
  let auditDir = null;

  try {
    const rootDir =
      assertRepositoryRoot(
        process.cwd(),
      );

    assertFreezeStillUnlocked(
      rootDir,
    );

    const stage3 =
      loadStage3Inventory(
        rootDir,
      );

    const repository =
      getRepositoryMetadata(
        rootDir,
      );

    console.log("============================================================");
    console.log("  PROJETO1 — ETAPA 4: MODULE MAP CANÔNICO                  ");
    console.log("============================================================\n");

    console.log(
      `[OK] Raiz Git: ${rootDir}`,
    );
    console.log(
      `[OK] Etapa 3: ${stage3.runId}`,
    );
    console.log(
      `[OK] Tree Etapa 3: ${String(stage3.inventory.summary?.treeSha256 ?? "(ausente)")}`,
    );
    console.log(
      "[OK] Freeze continua desbloqueado.",
    );

    console.log("");
    console.log(
      "[1/4] Validando a estrutura interna do catálogo canônico...",
    );

    const shapeValidation =
      validateCanonicalShape();

    console.log(
      `[OK] 20 módulos funcionais + 3 runtimes = ${shapeValidation.canonicalModuleCount} módulos first-party.`,
    );
    console.log(
      `[OK] ${shapeValidation.ownedCapabilityCount} capabilities pertencentes ao catálogo.`,
    );

    console.log("");
    console.log(
      "[2/4] Comparando module-map com o inventário real da Etapa 3...",
    );

    const stage3Validation =
      validateAgainstStage3(
        stage3,
      );

    console.log(
      `[OK] Engine modules: ${stage3Validation.engineCheck.count}`,
    );
    console.log(
      `[OK] Plugins: ${stage3Validation.pluginCheck.count}`,
    );
    console.log(
      `[OK] Tokens: ${stage3Validation.tokenCheck.count}`,
    );
    console.log(
      `[OK] Contract areas: ${stage3Validation.contractCheck.count}`,
    );

    console.log("");
    console.log(
      "[3/4] Validando paths, capability IDs, plugin IDs e bootstrap...",
    );

    const fileValidation =
      validateFilesAndIdentifiers(
        rootDir,
      );

    const bootstrapValidation =
      validateBootstrap(
        rootDir,
      );

    console.log(
      `[OK] ${fileValidation.checkedFileCount} arquivos canônicos verificados.`,
    );
    console.log(
      `[OK] ${fileValidation.capabilityChecks.length} tokens/capabilities conferidos.`,
    );
    console.log(
      `[OK] ${fileValidation.pluginChecks.length} plugin IDs canônicos conferidos.`,
    );
    console.log(
      `[OK] Bootstrap: ${bootstrapValidation.expectedBootstrappedPluginCount} plugins esperados; game.player permanece fora.`,
    );

    console.log("");
    console.log(
      "[4/4] Gravando snapshot de auditoria da fonte canônica...",
    );

    const startedAt =
      new Date();
    const runId =
      makeRunId(
        startedAt,
      );

    auditDir = path.join(
      rootDir,
      STAGE4_OUTPUT_ROOT,
      runId,
    );

    ensureDirectory(
      auditDir,
    );

    const report = {
      schemaVersion:
        MODULE_MAP_SCHEMA_VERSION,
      stage:
        STAGE_NAME,
      status:
        "passed",
      architectureMigrationVersion:
        ARCHITECTURE_MIGRATION_VERSION,
      runId,
      generatedAtUtc:
        startedAt.toISOString(),
      projectRoot:
        rootDir,
      sourceOfTruth:
        "scripts/architecture/module-map.mjs",
      repository: {
        branch:
          repository.branch,
        head:
          repository.head,
        hasCommits:
          repository.hasCommits,
        gitVersion:
          repository.gitVersion,
      },
      stage3: {
        runId:
          stage3.runId,
        reportPath:
          stage3.reportPath,
        treeSha256:
          stage3.inventory.summary
            ?.treeSha256 ?? null,
      },
      counts: {
        functionalModules:
          FUNCTIONAL_MODULES.length,
        runtimeModules:
          RUNTIME_MODULES.length,
        canonicalModules:
          CANONICAL_MODULES.length,
        toolingPlugins:
          TOOLING_PLUGINS.length,
        experimentalPlugins:
          EXPERIMENTAL_PLUGINS.length,
        ownedCapabilities:
          getAllCanonicalTokenRecords().length,
      },
      shapeValidation,
      stage3Validation,
      fileValidation: {
        checkedFileCount:
          fileValidation.checkedFileCount,
        capabilityChecks:
          fileValidation.capabilityChecks,
        pluginChecks:
          fileValidation.pluginChecks,
      },
      bootstrapValidation,
      notes: [
        "scripts/architecture/module-map.mjs é a fonte única canônica para as próximas etapas.",
        "Os 20 módulos funcionais preservam a numeração das camadas congeladas existentes.",
        "game.loop, game.render e game.net são runtimes fundamentais first-party fora da numeração 1..20.",
        "game.debug é tooling bootstrapped, não módulo de engine canônico.",
        "game.player é experimental/orphaned e não participa de createEnginePlugins.",
        "game.steam.net é capability secundária pertencente ao módulo steam, não um módulo separado.",
        "Steam e game-loop não possuíam diretórios src/engine próprios no inventário da Etapa 3; seus diretórios-alvo continuam reservados no catálogo.",
        "Esta etapa não cria public/internal e não move implementação alguma.",
      ],
    };

    writeJson(
      path.join(
        auditDir,
        "module-map.snapshot.json",
      ),
      buildSerializableModuleMap(),
    );

    writeJson(
      path.join(
        auditDir,
        "module-map-report.json",
      ),
      report,
    );

    writeText(
      path.join(
        auditDir,
        "module-map-summary.txt",
      ),
      `${buildSummary(report)}\n`,
    );

    writeText(
      path.join(
        auditDir,
        "git-status.txt",
      ),
      `${repository.status}\n`,
    );

    writeArtifactChecksums(
      auditDir,
    );

    const outputRoot =
      path.join(
        rootDir,
        STAGE4_OUTPUT_ROOT,
      );

    writeText(
      path.join(
        outputRoot,
        "LATEST",
      ),
      `${runId}\n`,
    );

    console.log(
      `[OK] ${toPosixRelative(rootDir, path.join(auditDir, "module-map.snapshot.json"))}`,
    );
    console.log(
      `[OK] ${toPosixRelative(rootDir, path.join(auditDir, "module-map-report.json"))}`,
    );
    console.log(
      `[OK] ${toPosixRelative(rootDir, path.join(auditDir, "module-map-summary.txt"))}`,
    );

    console.log("");
    console.log("============================================================");
    console.log("  ETAPA 4 CONCLUÍDA COM SUCESSO                            ");
    console.log("============================================================");
    console.log(
      "Fonte canônica: scripts/architecture/module-map.mjs",
    );
    console.log(
      "20 módulos funcionais + 3 runtimes fundamentais.",
    );
    console.log(
      "game.debug = tooling | game.player = experimental/orphaned.",
    );
    console.log(
      "Nenhuma implementação foi movida nesta etapa.",
    );

    process.exitCode = 0;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.stack || error.message
        : String(error);

    console.error("");
    console.error(
      "[ERRO] Etapa 4 não concluída.",
    );
    console.error(
      message,
    );

    if (
      auditDir !== null &&
      fs.existsSync(
        auditDir,
      )
    ) {
      try {
        writeText(
          path.join(
            auditDir,
            "STAGE4_ERROR.txt",
          ),
          `${message}\n`,
        );
      } catch {
        // Não mascara o erro original.
      }
    }

    process.exitCode = 1;
  }
}

const executedAsMain =
  process.argv[1] !== undefined &&
  normalizeAbsolute(
    fileURLToPath(import.meta.url),
  ) ===
    normalizeAbsolute(
      process.argv[1],
    );

if (executedAsMain) {
  runStage4();
}
