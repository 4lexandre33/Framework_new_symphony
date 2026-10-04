#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const TAG = "stage-30-fix-smoke-regressions";
const ROOT = process.cwd();

const HUD = "src/debug/hud/HudRenderer.ts";
const TAURI_LIB = "src-tauri/src/lib.rs";

function fail(message) {
  console.error(`[${TAG}] ERRO: ${message}`);
  process.exit(1);
}

function parseMode(argv) {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === "--check")) return "check";
  if (argv.length === 1 && argv[0] === "--apply") return "apply";
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    console.log(`
Projeto1 — Etapa 30: correções encontradas pelos smoke tests

Uso:
  node scripts/architecture/stage30-fix-smoke-regressions.mjs --check
  node scripts/architecture/stage30-fix-smoke-regressions.mjs --apply

Escopo:
  - src/debug/hud/HudRenderer.ts
  - src-tauri/src/lib.rs

Correções:
  - mantém InputDiagnostics no caminho por-frame;
  - limita diagnósticos pesados do HUD a 500 ms;
  - deduplica logs de diagnóstico por subsistema;
  - registra overlay::overlay_dock_to_taskbar no invoke handler Tauri;
  - não altera smoke tests nem asserts.
`);
    process.exit(0);
  }
  fail("argumentos inválidos; use --check, --apply ou --help.");
}

function read(rel) {
  const full = path.join(ROOT, ...rel.split("/"));
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    fail(`arquivo obrigatório ausente: ${rel}`);
  }
  return fs.readFileSync(full, "utf8");
}

function writeAtomic(rel, content) {
  const full = path.join(ROOT, ...rel.split("/"));
  const tmp = `${full}.stage30.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, full);
}

function patchHud(source) {
  let next = source;
  let changed = false;

  if (!next.includes("const DIAGNOSTIC_REFRESH_INTERVAL_MS = 500;")) {
    const marker = 'import { InputDiagnostics } from "./InputDiagnostics";';
    if (!next.includes(marker)) {
      fail(`${HUD}: import de InputDiagnostics não encontrado.`);
    }
    next = next.replace(
      marker,
      `${marker}\n\nconst DIAGNOSTIC_REFRESH_INTERVAL_MS = 500;`,
    );
    changed = true;
  }

  if (!next.includes("private lastDiagnosticRefreshMs = 0;")) {
    const marker = "  private eventsBound = false;";
    if (!next.includes(marker)) {
      fail(`${HUD}: campo eventsBound não encontrado.`);
    }
    next = next.replace(
      marker,
      `${marker}\n  private lastDiagnosticRefreshMs = 0;\n  private readonly lastDiagnosticMessages = new Map<string, string>();`,
    );
    changed = true;
  }

  if (!next.includes("this.lastDiagnosticMessages.clear();")) {
    const marker = "    this.inputDiagnostics.reset();\n    this.fpsMonitor.reset(performance.now());";
    if (!next.includes(marker)) {
      fail(`${HUD}: bloco start/reset esperado não encontrado.`);
    }
    next = next.replace(
      marker,
      `    this.inputDiagnostics.reset();\n    this.lastDiagnosticMessages.clear();\n    this.lastDiagnosticRefreshMs = 0;\n    this.fpsMonitor.reset(performance.now());`,
    );
    changed = true;
  }

  const oldFrame = `    this.updateSteamHud();
    this.updateInputHud();
    this.updateAssetsHud();
    this.updatePhysicsHud();
    this.updateStorageHud();
    this.updateWorldHud();
    this.updateUIHud();
    this.updateAudioHud();
    this.updateCameraHud();
    this.updateAiHud();
    this.updateVfxHud();
    this.updateTerrainHud();
    this.updateScriptingHud();
    this.updateStreamingHud();
    this.updateOverlayHud();
    this.updateSecurityHud();
    this.updateModdingHud();
    this.updateMonetizationHud();

    this.animationFrameId = requestAnimationFrame(this.renderFrame);`;

  const newFrame = `    this.updateInputHud();

    if (now - this.lastDiagnosticRefreshMs >= DIAGNOSTIC_REFRESH_INTERVAL_MS) {
      this.lastDiagnosticRefreshMs = now;

      this.updateSteamHud();
      this.updateAssetsHud();
      this.updatePhysicsHud();
      this.updateStorageHud();
      this.updateWorldHud();
      this.updateUIHud();
      this.updateAudioHud();
      this.updateCameraHud();
      this.updateAiHud();
      this.updateVfxHud();
      this.updateTerrainHud();
      this.updateScriptingHud();
      this.updateStreamingHud();
      this.updateOverlayHud();
      this.updateSecurityHud();
      this.updateModdingHud();
      this.updateMonetizationHud();
    }

    this.animationFrameId = requestAnimationFrame(this.renderFrame);`;

  if (!next.includes(newFrame)) {
    if (!next.includes(oldFrame)) {
      fail(`${HUD}: bloco renderFrame está em estado inesperado.`);
    }
    next = next.replace(oldFrame, newFrame);
    changed = true;
  }

  const replacements = [
    [
      `      this.hud.appendLog(
        \`[HUD Physics] Rapier WASM | 60 Ticks/s | Corpos: \${stats.rigidBodyCount} | Colisores: \${stats.colliderCount}\`
      );`,
      `      this.logDiagnosticIfChanged(
        "physics",
        \`[HUD Physics] Rapier WASM | 60 Ticks/s | Corpos: \${stats.rigidBodyCount} | Colisores: \${stats.colliderCount}\`
      );`,
    ],
    [
      `    this.hud.appendLog(\`[HUD Storage] Driver Ativo: \${storage.activeDriver}\`);`,
      `    this.logDiagnosticIfChanged(
      "storage",
      \`[HUD Storage] Driver Ativo: \${storage.activeDriver}\`
    );`,
    ],
    [
      `    this.hud.appendLog(
      \`[HUD World] Cena: \${world.currentSceneId || "Nenhuma"} | Entidades ECS: \${world.activeEntityCount}\`
    );`,
      `    this.logDiagnosticIfChanged(
      "world",
      \`[HUD World] Cena: \${world.currentSceneId || "Nenhuma"} | Entidades ECS: \${world.activeEntityCount}\`
    );`,
    ],
    [
      `    this.hud.appendLog(
      \`[HUD UI] Tela: \${ui.currentScreen} | Modais: \${ui.activeModalCount} | Idioma: \${ui.currentLocale}\`
    );`,
      `    this.logDiagnosticIfChanged(
      "ui",
      \`[HUD UI] Tela: \${ui.currentScreen} | Modais: \${ui.activeModalCount} | Idioma: \${ui.currentLocale}\`
    );`,
    ],
    [
      '    this.hud.appendLog(`[HUD Audio] Master: ${(master * 100).toFixed(0)}%`);',
      `    this.logDiagnosticIfChanged(
      "audio",
      \`[HUD Audio] Master: \${(master * 100).toFixed(0)}%\`
    );`,
    ],
    [
      `      this.hud.appendLog(
        \`[HUD Camera] Ativa: \${camera.getActiveCameraId() || "Nenhuma"} | Haste: \${snapshot.currentArmLength.toFixed(2)}m\`
      );`,
      `      this.logDiagnosticIfChanged(
        "camera",
        \`[HUD Camera] Ativa: \${camera.getActiveCameraId() || "Nenhuma"} | Haste: \${snapshot.currentArmLength.toFixed(2)}m\`
      );`,
    ],
    [
      '      this.hud.appendLog(`[HUD AI] NavMesh & Behavior Trees | Status: Ativo`);',
      `      this.logDiagnosticIfChanged(
        "ai",
        "[HUD AI] NavMesh & Behavior Trees | Status: Ativo"
      );`,
    ],
    [
      `    this.hud.appendLog(
      \`[HUD VFX] Partículas: \${vfx.getActiveParticleCount()} | Decals: \${vfx.getActiveDecalCount()}\`
    );`,
      `    this.logDiagnosticIfChanged(
      "vfx",
      \`[HUD VFX] Partículas: \${vfx.getActiveParticleCount()} | Decals: \${vfx.getActiveDecalCount()}\`
    );`,
    ],
    [
      `    this.hud.appendLog(
      \`[HUD Terrain] Chunks Voxels: \${terrain.getActiveChunkCount()} | Seed: \${terrain.getSeed()}\`
    );`,
      `    this.logDiagnosticIfChanged(
      "terrain",
      \`[HUD Terrain] Chunks Voxels: \${terrain.getActiveChunkCount()} | Seed: \${terrain.getSeed()}\`
    );`,
    ],
    [
      `    this.hud.appendLog(
      \`[HUD Scripting] Cutscene: \${scripting.isCutscenePlaying() ? "EM EXECUÇÃO" : "Inativa"}\`
    );`,
      `    this.logDiagnosticIfChanged(
      "scripting",
      \`[HUD Scripting] Cutscene: \${scripting.isCutscenePlaying() ? "EM EXECUÇÃO" : "Inativa"}\`
    );`,
    ],
    [
      `    this.hud.appendLog(
      \`[HUD Streaming] Setores VRAM: \${active} | HLOD Saved Calls: \${hlod.drawCallsSaved}\`
    );`,
      `    this.logDiagnosticIfChanged(
      "streaming",
      \`[HUD Streaming] Setores VRAM: \${active} | HLOD Saved Calls: \${hlod.drawCallsSaved}\`
    );`,
    ],
    [
      `    this.hud.appendLog(
      \`[HUD Overlay] Modo: \${overlay.currentMode} | Passthrough: \${overlay.isPassthroughActive ? "SIM" : "NÃO"}\`
    );`,
      `    this.logDiagnosticIfChanged(
      "overlay",
      \`[HUD Overlay] Modo: \${overlay.currentMode} | Passthrough: \${overlay.isPassthroughActive ? "SIM" : "NÃO"}\`
    );`,
    ],
    [
      `    this.hud.appendLog(
      \`[HUD Security/Profiler] FPS Medido: \${metrics.fps} | Frame: \${metrics.totalFrameTimeMs.toFixed(2)}ms | Subsistemas: \${metrics.subsystems.length}\`
    );`,
      `    this.logDiagnosticIfChanged(
      "security",
      \`[HUD Security/Profiler] FPS Medido: \${metrics.fps} | Frame: \${metrics.totalFrameTimeMs.toFixed(2)}ms | Subsistemas: \${metrics.subsystems.length}\`
    );`,
    ],
    [
      `    this.hud.appendLog(
      \`[HUD Modding/Steam Workshop] Mods Ativos: \${loaded} | Override Engine Status: Pronta\`
    );`,
      `    this.logDiagnosticIfChanged(
      "modding",
      \`[HUD Modding/Steam Workshop] Mods Ativos: \${loaded} | Override Engine Status: Pronta\`
    );`,
    ],
    [
      `    this.hud.appendLog(
      \`[HUD Monetization/Steam MicroTxn] Ouro: \${gold} | Inventário Steam: \${invCount} item(ns)\`
    );`,
      `    this.logDiagnosticIfChanged(
      "monetization",
      \`[HUD Monetization/Steam MicroTxn] Ouro: \${gold} | Inventário Steam: \${invCount} item(ns)\`
    );`,
    ],
  ];

  for (const [oldText, newText] of replacements) {
    if (next.includes(newText)) continue;
    if (!next.includes(oldText)) {
      fail(`${HUD}: trecho de diagnóstico esperado não encontrado.`);
    }
    next = next.replace(oldText, newText);
    changed = true;
  }

  if (!next.includes("private logDiagnosticIfChanged(")) {
    const marker = "  private bindEvents(): void {";
    if (!next.includes(marker)) {
      fail(`${HUD}: bindEvents não encontrado.`);
    }

    const method = `  private logDiagnosticIfChanged(
    key: string,
    message: string
  ): void {
    if (this.lastDiagnosticMessages.get(key) === message) return;

    this.lastDiagnosticMessages.set(key, message);
    this.hud.appendLog(message);
  }

`;

    next = next.replace(marker, method + marker);
    changed = true;
  }

  return { content: next, changed };
}

function patchTauriLib(source) {
  const expected = "            overlay::overlay_dock_to_taskbar,";
  if (source.includes(expected)) {
    return { content: source, changed: false };
  }

  const marker = "            overlay::overlay_get_taskbar_bounds,";
  if (!source.includes(marker)) {
    fail(`${TAURI_LIB}: overlay_get_taskbar_bounds não encontrado no invoke handler.`);
  }

  return {
    content: source.replace(marker, `${marker}\n${expected}`),
    changed: true,
  };
}

function validateHud(source) {
  const required = [
    "const DIAGNOSTIC_REFRESH_INTERVAL_MS = 500;",
    "private lastDiagnosticRefreshMs = 0;",
    "private readonly lastDiagnosticMessages = new Map<string, string>();",
    "this.updateInputHud();",
    "now - this.lastDiagnosticRefreshMs >= DIAGNOSTIC_REFRESH_INTERVAL_MS",
    "private logDiagnosticIfChanged(",
  ];

  for (const fragment of required) {
    if (!source.includes(fragment)) {
      fail(`${HUD}: validação falhou para ${fragment}`);
    }
  }

  const renderFrameStart = source.indexOf("private readonly renderFrame");
  const inputUpdate = source.indexOf("this.updateInputHud();", renderFrameStart);
  const gate = source.indexOf(
    "now - this.lastDiagnosticRefreshMs >= DIAGNOSTIC_REFRESH_INTERVAL_MS",
    renderFrameStart,
  );

  if (!(renderFrameStart >= 0 && inputUpdate > renderFrameStart && gate > inputUpdate)) {
    fail(`${HUD}: InputDiagnostics não permaneceu antes do throttle.`);
  }
}

function validateTauriLib(source) {
  if (!source.includes("overlay::overlay_dock_to_taskbar,")) {
    fail(`${TAURI_LIB}: overlay_dock_to_taskbar não foi registrado.`);
  }
}

const selected = parseMode(process.argv.slice(2));
const hudBefore = read(HUD);
const tauriBefore = read(TAURI_LIB);
const hudPlan = patchHud(hudBefore);
const tauriPlan = patchTauriLib(tauriBefore);

const pending = [
  ...(hudPlan.changed ? [HUD] : []),
  ...(tauriPlan.changed ? [TAURI_LIB] : []),
];

console.log(`[${TAG}] modo ${selected}${selected === "check" ? " (read-only)" : ""}`);
console.log("Arquivos no escopo: 2");
console.log(`Pendências: ${pending.length}`);
for (const rel of pending) console.log(`  PENDENTE ${rel}`);

if (selected === "check") {
  if (pending.length === 0) {
    validateHud(hudBefore);
    validateTauriLib(tauriBefore);
    console.log("Correções da Etapa 30 já instaladas e idempotentes.");
  } else {
    console.log("Correções da Etapa 30 ainda precisam ser aplicadas.");
  }
  process.exit(0);
}

const written = [];
try {
  if (hudPlan.changed) {
    writeAtomic(HUD, hudPlan.content);
    written.push([HUD, hudBefore]);
  }
  if (tauriPlan.changed) {
    writeAtomic(TAURI_LIB, tauriPlan.content);
    written.push([TAURI_LIB, tauriBefore]);
  }
} catch (error) {
  for (const [rel, before] of written.reverse()) {
    try {
      writeAtomic(rel, before);
    } catch {}
  }
  fail(error instanceof Error ? error.stack ?? error.message : String(error));
}

const hudAfter = read(HUD);
const tauriAfter = read(TAURI_LIB);
validateHud(hudAfter);
validateTauriLib(tauriAfter);

if (patchHud(hudAfter).changed || patchTauriLib(tauriAfter).changed) {
  fail("aplicação não convergiu.");
}

console.log(`[${TAG}] aplicado com sucesso.`);
console.log(`  OK ${HUD}`);
console.log(`  OK ${TAURI_LIB}`);
console.log("Smoke tests não foram alterados.");
