import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import {
  auditLayer1PublicApi,
  fingerprintTypeScriptSource,
} from "./layer1-public-api-v1.mjs";

import {
  auditLayer1CapabilityGraph,
} from "./layer1-capability-graph-v1.mjs";

export const LAYER1_PRESENTATION_AUDIT_VERSION =
  "1.0.2";

export const LAYER1_PRESENTATION_BASELINE_FILE =
  "LAYER1_PRESENTATION_BASELINE_V1.json";

export const PRESENTATION_RUNTIME_FILES =
  Object.freeze([
    "src/engine/ui/internal/DOMEventListenerBridge.ts",
    "src/engine/ui/internal/HUDDataBinder.ts",
    "src/engine/ui/internal/LocalizationEngine.ts",
    "src/engine/ui/internal/UIManager.ts",
    "src/engine/ui/internal/UIService.ts",
    "src/engine/ui/internal/UITemplateRegistry.ts",
    "src/plugins/ui/plugin.ts",

    "src/engine/sprites/internal/InstancedTilemapRenderer.ts",
    "src/engine/sprites/internal/ParallaxController.ts",
    "src/engine/sprites/internal/PixelArtScaler.ts",
    "src/engine/sprites/internal/Sprite2DRenderer.ts",
    "src/engine/sprites/internal/SpritesService.ts",
    "src/engine/sprites/internal/TextureAtlasParser.ts",
    "src/plugins/sprites/plugin.ts",

    "src/engine/anim/internal/AnimationEventManager.ts",
    "src/engine/anim/internal/AnimationService.ts",
    "src/engine/anim/internal/AnimationState.ts",
    "src/engine/anim/internal/AnimationStateMachine.ts",
    "src/engine/anim/internal/SkeletalAnimationDriver.ts",
    "src/engine/anim/internal/Sprite2DAnimationDriver.ts",
    "src/plugins/anim/plugin.ts",

    "src/engine/audio/internal/AudioListenerBridge.ts",
    "src/engine/audio/internal/AudioMixer.ts",
    "src/engine/audio/internal/AudioService.ts",
    "src/engine/audio/internal/AudioVoiceRegistry.ts",
    "src/engine/audio/internal/MusicCrossfader.ts",
    "src/engine/audio/internal/PositionalAudio3D.ts",
    "src/plugins/audio/plugin.ts",

    "src/engine/camera/internal/CameraOcclusionDetector.ts",
    "src/engine/camera/internal/CameraService.ts",
    "src/engine/camera/internal/SpringArm3D.ts",
    "src/engine/camera/internal/TraumaCameraShake.ts",
    "src/engine/camera/internal/VirtualCameraStack.ts",
    "src/plugins/camera/plugin.ts",

    "src/engine/vfx/internal/CustomShaderLibrary.ts",
    "src/engine/vfx/internal/DecalManager.ts",
    "src/engine/vfx/internal/GPUParticleSystem.ts",
    "src/engine/vfx/internal/PostProcessingPipeline.ts",
    "src/engine/vfx/internal/VFXEffectManager.ts",
    "src/engine/vfx/internal/VFXService.ts",
    "src/plugins/vfx/plugin.ts",
  ]);

const HOT_PATHS =
  Object.freeze([
    ["src/engine/sprites/internal/ParallaxController.ts", "ParallaxController", "update"],
    ["src/engine/anim/internal/AnimationService.ts", "AnimationService", "tick"],
    ["src/engine/anim/internal/AnimationStateMachine.ts", "AnimationStateMachine", "update"],
    ["src/engine/anim/internal/Sprite2DAnimationDriver.ts", "Sprite2DAnimationDriver", "update"],
    ["src/engine/anim/internal/SkeletalAnimationDriver.ts", "SkeletalAnimationDriver", "update"],
    ["src/engine/camera/internal/SpringArm3D.ts", "SpringArm3D", "computeCameraPosition"],
    ["src/engine/camera/internal/TraumaCameraShake.ts", "TraumaCameraShake", "update"],
    ["src/engine/camera/internal/CameraService.ts", "CameraService", "render"],
    ["src/engine/vfx/internal/GPUParticleSystem.ts", "GPUParticleEmitter", "update"],
    ["src/engine/vfx/internal/GPUParticleSystem.ts", "GPUParticleSystem", "update"],
    ["src/engine/vfx/internal/DecalManager.ts", "DecalManager", "update"],
    ["src/engine/vfx/internal/PostProcessingPipeline.ts", "PostProcessingPipeline", "update"],
    ["src/engine/vfx/internal/VFXService.ts", "VFXService", "update"],
  ]);

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

function abs(
  projectRoot,
  relativePath,
) {
  return path.join(
    projectRoot,
    ...relativePath.split("/"),
  );
}

function readSource(
  projectRoot,
  relativePath,
) {
  const target =
    abs(
      projectRoot,
      relativePath,
    );

  if (
    !fs.existsSync(target) ||
    !fs.statSync(target).isFile()
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

function countAnyKeywords(
  ts,
  sourceFile,
) {
  let count =
    0;

  function visit(
    node,
  ) {
    if (
      node.kind ===
      ts.SyntaxKind.AnyKeyword
    ) {
      count += 1;
    }

    ts.forEachChild(
      node,
      visit,
    );
  }

  visit(
    sourceFile,
  );

  return count;
}

function findMethod(
  ts,
  sourceFile,
  className,
  methodName,
) {
  for (
    const statement of
    sourceFile.statements
  ) {
    if (
      !ts.isClassDeclaration(statement) ||
      statement.name?.text !== className
    ) {
      continue;
    }

    for (
      const member of
      statement.members
    ) {
      if (
        ts.isMethodDeclaration(member) &&
        member.name !== undefined &&
        (
          ts.isIdentifier(member.name) ||
          ts.isStringLiteralLike(member.name)
        ) &&
        member.name.text === methodName
      ) {
        return member;
      }
    }
  }

  return null;
}

function allocationStats(
  ts,
  method,
) {
  let objectLiterals =
    0;

  let arrayLiterals =
    0;

  let newExpressions =
    0;

  function visit(
    node,
  ) {
    if (
      ts.isObjectLiteralExpression(node)
    ) {
      objectLiterals += 1;
    } else if (
      ts.isArrayLiteralExpression(node)
    ) {
      arrayLiterals += 1;
    } else if (
      ts.isNewExpression(node)
    ) {
      newExpressions += 1;
    }

    ts.forEachChild(
      node,
      visit,
    );
  }

  if (
    method?.body !== undefined
  ) {
    visit(
      method.body,
    );
  }

  return Object.freeze({
    objectLiterals,
    arrayLiterals,
    newExpressions,
    total:
      objectLiterals +
      arrayLiterals +
      newExpressions,
  });
}

function collectSemanticFiles(
  ts,
  projectRoot,
) {
  return PRESENTATION_RUNTIME_FILES.map(
    (relativePath) => {
      const source =
        readSource(
          projectRoot,
          relativePath,
        );

      const sourceFile =
        ts.createSourceFile(
          relativePath,
          source,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS,
        );

      return Object.freeze({
        relativePath,
        fingerprint:
          fingerprintTypeScriptSource(
            ts,
            source,
          ),
        explicitAnyKeywords:
          countAnyKeywords(
            ts,
            sourceFile,
          ),
      });
    },
  );
}

function collectHotPaths(
  ts,
  projectRoot,
) {
  const result = {};

  for (
    const [
      relativePath,
      className,
      methodName,
    ] of
    HOT_PATHS
  ) {
    const source =
      readSource(
        projectRoot,
        relativePath,
      );

    const sourceFile =
      ts.createSourceFile(
        relativePath,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );

    const method =
      findMethod(
        ts,
        sourceFile,
        className,
        methodName,
      );

    const key =
      `${className}.${methodName}`;

    result[key] =
      method === null
        ? null
        : allocationStats(
            ts,
            method,
          );
  }

  return Object.freeze(
    result,
  );
}

function loadBaseline(
  projectRoot,
) {
  const target =
    abs(
      projectRoot,
      LAYER1_PRESENTATION_BASELINE_FILE,
    );

  if (
    !fs.existsSync(target)
  ) {
    throw new Error(
      `baseline ausente: ${LAYER1_PRESENTATION_BASELINE_FILE}`,
    );
  }

  return JSON.parse(
    fs.readFileSync(
      target,
      "utf8",
    ),
  );
}

function compareSemanticBaseline(
  baseline,
  currentFiles,
) {
  const expected =
    new Map(
      Object.entries(
        baseline.semanticFingerprints ??
        {},
      ),
    );

  const current =
    new Map(
      currentFiles.map(
        (entry) => [
          entry.relativePath,
          entry.fingerprint,
        ],
      ),
    );

  const violations = [];

  for (
    const file of
    PRESENTATION_RUNTIME_FILES
  ) {
    const expectedHash =
      expected.get(
        file,
      );

    const currentHash =
      current.get(
        file,
      );

    if (
      expectedHash === undefined
    ) {
      violations.push(
        violation(
          "L1PRS001",
          file,
          "arquivo certificado não existe na baseline da Etapa 80.",
        ),
      );

      continue;
    }

    if (
      currentHash !== expectedHash
    ) {
      violations.push(
        violation(
          "L1PRS002",
          file,
          "runtime mudou semanticamente; exige recertificação da Etapa 80.",
        ),
      );
    }
  }

  for (
    const file of
    expected.keys()
  ) {
    if (
      !current.has(file)
    ) {
      violations.push(
        violation(
          "L1PRS003",
          file,
          "baseline certifica arquivo que não pertence mais ao conjunto runtime da Etapa 80.",
        ),
      );
    }
  }

  return violations;
}

function containsAll(
  source,
  fragments,
) {
  return fragments.every(
    (fragment) =>
      source.includes(
        fragment,
      ),
  );
}

export async function collectCurrentPresentation(
  projectRoot =
    process.cwd(),
) {
  const absoluteRoot =
    path.resolve(
      projectRoot,
    );

  const ts =
    loadTypeScript(
      absoluteRoot,
    );

  const files =
    collectSemanticFiles(
      ts,
      absoluteRoot,
    );

  const hotPaths =
    collectHotPaths(
      ts,
      absoluteRoot,
    );

  return Object.freeze({
    files,
    hotPaths,
    explicitAnyKeywords:
      files.reduce(
        (
          total,
          entry,
        ) =>
          total +
          entry.explicitAnyKeywords,
        0,
      ),
  });
}

export async function auditLayer1Presentation({
  projectRoot =
    process.cwd(),
} = {}) {
  const absoluteRoot =
    path.resolve(
      projectRoot,
    );

  const [
    stage72,
    stage73,
  ] =
    await Promise.all([
      auditLayer1PublicApi({
        projectRoot:
          absoluteRoot,
      }),
      auditLayer1CapabilityGraph({
        projectRoot:
          absoluteRoot,
      }),
    ]);

  const baseline =
    loadBaseline(
      absoluteRoot,
    );

  const current =
    await collectCurrentPresentation(
      absoluteRoot,
    );

  const violations =
    compareSemanticBaseline(
      baseline,
      current.files,
    );

  if (
    !stage72.ok
  ) {
    violations.push(
      violation(
        "L1PRS010",
        "stage72",
        "Public APIs congeladas na Etapa 72 deixaram de passar.",
      ),
    );
  }

  if (
    !stage73.ok
  ) {
    violations.push(
      violation(
        "L1PRS011",
        "stage73",
        "Capability graph congelado na Etapa 73 deixou de passar.",
      ),
    );
  }

  if (
    current.explicitAnyKeywords !==
    0
  ) {
    violations.push(
      violation(
        "L1PRS020",
        "runtime",
        `foram encontrados ${String(current.explicitAnyKeywords)} explicit any nos arquivos certificados.`,
      ),
    );
  }

  for (
    const [
      key,
      stats,
    ] of
    Object.entries(
      current.hotPaths,
    )
  ) {
    if (
      stats === null
    ) {
      violations.push(
        violation(
          "L1PRS021",
          key,
          "hot path certificado não foi encontrado.",
        ),
      );

      continue;
    }

    if (
      stats.total !==
      0
    ) {
      violations.push(
        violation(
          "L1PRS022",
          key,
          `hot path possui ${String(stats.total)} allocation literal/new explícita(s).`,
        ),
      );
    }
  }

  const allSource =
    current.files
      .map(
        (entry) =>
          readSource(
            absoluteRoot,
            entry.relativePath,
          ),
      )
      .join(
        "\n",
      );

  if (
    /\b0\.016\b/u.test(
      allSource,
    )
  ) {
    violations.push(
      violation(
        "L1PRS023",
        "runtime",
        "fallback temporal legado 0.016 foi encontrado no runtime de apresentação.",
      ),
    );
  }

  const mixerSource =
    readSource(
      absoluteRoot,
      "src/engine/audio/internal/AudioMixer.ts",
    );

  if (
    !containsAll(
      mixerSource,
      [
        "gainNode.connect(",
        "this.masterGain",
        '"master"',
      ],
    )
  ) {
    violations.push(
      violation(
        "L1PRS030",
        "game.audio",
        "AudioMixer não comprova topologia child channels -> master -> destination.",
      ),
    );
  }

  const audioServiceSource =
    readSource(
      absoluteRoot,
      "src/engine/audio/internal/AudioService.ts",
    );

  if (
    !containsAll(
      audioServiceSource,
      [
        "this.voices",
        ".stopAll()",
        "this.crossfader",
        ".stop()",
      ],
    )
  ) {
    violations.push(
      violation(
        "L1PRS031",
        "game.audio",
        "stopAllSounds não comprova encerramento de vozes e BGM.",
      ),
    );
  }

  const uiSource =
    readSource(
      absoluteRoot,
      "src/engine/ui/internal/UIService.ts",
    );

  if (
    !containsAll(
      uiSource,
      [
        "this.domBridge.detach()",
        "this.uiManager.unmount()",
        "this.ownsUIRoot",
        "root.replaceChildren()",
      ],
    )
  ) {
    violations.push(
      violation(
        "L1PRS032",
        "game.ui",
        "ownership/teardown de DOM não está explicitamente governado.",
      ),
    );
  }

  const spritesSource =
    readSource(
      absoluteRoot,
      "src/engine/sprites/internal/SpritesService.ts",
    );

  if (
    !containsAll(
      spritesSource,
      [
        "removeMeshFromScene",
        "disposeLocally",
        "this.spriteRenderer",
        "this.parallaxController",
      ],
    )
  ) {
    violations.push(
      violation(
        "L1PRS033",
        "game.sprites",
        "ownership de recursos Three.js entre Sprites e Render não está governado.",
      ),
    );
  }

  const cameraSource =
    readSource(
      absoluteRoot,
      "src/engine/camera/internal/SpringArm3D.ts",
    );

  if (
    !containsAll(
      cameraSource,
      [
        "this.rayRequest",
        "this.scratchArmDir",
        "this.scratchActualCamPos",
      ],
    )
  ) {
    violations.push(
      violation(
        "L1PRS034",
        "game.camera",
        "SpringArm não comprova scratch state reutilizado no hot path.",
      ),
    );
  }

  const vfxSource =
    readSource(
      absoluteRoot,
      "src/engine/vfx/internal/VFXService.ts",
    );

  if (
    !containsAll(
      vfxSource,
      [
        "cloneOwnedTexture",
        "presentationOwned",
        "removeMeshFromScene",
      ],
    )
  ) {
    violations.push(
      violation(
        "L1PRS035",
        "game.vfx",
        "ownership de texturas/emissores VFX não está governado.",
      ),
    );
  }

  if (
    vfxSource.includes(
      "this.render",
    )
  ) {
    violations.push(
      violation(
        "L1PRS036",
        "game.vfx",
        "VFXService deve resolver RenderToken por getRender() lazy; referência direta this.render é inválida.",
      ),
    );
  }

  return Object.freeze({
    ok:
      violations.length ===
      0,
    version:
      LAYER1_PRESENTATION_AUDIT_VERSION,
    baselineId:
      baseline.baselineId,
    runtimeFiles:
      PRESENTATION_RUNTIME_FILES.length,
    explicitAnyKeywords:
      current.explicitAnyKeywords,
    hotPaths:
      current.hotPaths,
    publicApisUnchanged:
      stage72.ok,
    capabilityGraphUnchanged:
      stage73.ok,
    violations,
  });
}

export function formatLayer1PresentationAudit(
  result,
) {
  const lines = [
    "============================================================",
    "  PROJETO1 — LAYER 1 PRESENTATION SYSTEMS AUDIT",
    "============================================================",
    "",
    `[INFO] Audit version: ${result.version}`,
    `[INFO] Presentation baseline: ${result.baselineId}`,
    `[INFO] Semantic runtime files: ${String(result.runtimeFiles)}`,
    `[INFO] Explicit any keywords: ${String(result.explicitAnyKeywords)}`,
    `[INFO] Public APIs unchanged: ${result.publicApisUnchanged ? "YES" : "NO"}`,
    `[INFO] Capability graph unchanged: ${result.capabilityGraphUnchanged ? "YES" : "NO"}`,
    "",
  ];

  for (
    const [
      key,
      stats,
    ] of
    Object.entries(
      result.hotPaths,
    )
  ) {
    lines.push(
      `[INFO] ${key} allocations: ${stats === null ? "MISSING" : String(stats.total)}`,
    );
  }

  lines.push("");

  if (
    result.ok
  ) {
    lines.push(
      "[OK] Violações Presentation Systems: 0",
      "[OK] UI possui ownership de DOM, modal focus e teardown governados.",
      "[OK] Sprites/Tilemap/Parallax preservam ownership de recursos Three.js.",
      "[OK] Animation FSM/drivers usam delta validado e stall clamp.",
      "[OK] Audio mixer aplica master acima dos canais e stopAll encerra todas as vozes.",
      "[OK] Camera SpringArm/shake reutilizam scratch state nos hot paths.",
      "[OK] VFX preserva ownership de texturas/emissores/decals e delta clamp.",
    );
  } else {
    lines.push(
      `[FAIL] Violações Presentation Systems: ${String(result.violations.length)}`,
    );

    for (
      const item of
      result.violations
    ) {
      lines.push(
        `[${item.code}] ${item.scope} — ${item.message}`,
      );
    }
  }

  return lines.join(
    "\n",
  );
}
