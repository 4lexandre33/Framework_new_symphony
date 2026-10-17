#!/usr/bin/env node
/**
 * G32 — identidade e janela POR JOGO, em build time.
 *
 * `src-tauri/tauri.conf.json` é o host genérico (identidade `projeto1` /
 * `com.projeto1.game`, janela desktop comum: com bordas, não sempre-no-topo,
 * opaca). Cada jogo ganha a sua identidade (pasta de dados/saves/mods/crash
 * dumps separada, nome do executável/instalador) com um merge-config do
 * Tauri gerado a partir de `src/projects/<id>/desktop.json` (opcional):
 *
 *   {
 *     "productName": "Meu Jogo",                // default: <id>
 *     "identifier": "com.minhaempresa.meujogo", // default: com.projeto1.<id>
 *     "window": {                                // só chaves permitidas
 *       "title": "Meu Jogo", "width": 1280, "height": 720,
 *       "resizable": true, "fullscreen": false,
 *       "decorations": true, "alwaysOnTop": false, "transparent": false
 *     }
 *   }
 *
 * Janela de overlay (transparente/sem bordas/sempre-no-topo) é OPT-IN do
 * projeto aqui (transparência só pode ser definida na criação da janela).
 *
 * Uso:
 *   node scripts/tauri-project-config.mjs <id>            # gera e imprime o caminho
 *   node scripts/tauri-project-config.mjs <id> --build    # + VITE_PROJECT=<id> tauri build --config <arquivo>
 *   node scripts/tauri-project-config.mjs <id> --dev      # + VITE_PROJECT=<id> tauri dev --config <arquivo>
 *
 * Saída: `src-tauri/gen/tauri.project.<id>.conf.json` (gerado; não versionar).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/u;
// Reverse-DNS do Tauri: segmentos alfanuméricos/hífen, >= 2 segmentos.
const IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z0-9][A-Za-z0-9-]*)+$/u;
const WINDOW_KEYS = Object.freeze({
  title: "string",
  width: "number",
  height: "number",
  resizable: "boolean",
  fullscreen: "boolean",
  decorations: "boolean",
  alwaysOnTop: "boolean",
  transparent: "boolean",
});

/** Defaults seguros da janela de jogo (iguais ao tauri.conf.json do host). */
export const SAFE_WINDOW_DEFAULTS = Object.freeze({
  decorations: true,
  alwaysOnTop: false,
  transparent: false,
});

/**
 * Monta o merge-config do Tauri para um projeto. Pura (testável).
 * @param {string} projectId
 * @param {Record<string, unknown> | undefined} desktop conteúdo de desktop.json
 * @param {Record<string, unknown>} baseWindow janela 0 do tauri.conf.json base
 */
export function buildProjectTauriConfig(projectId, desktop = {}, baseWindow = {}) {
  if (typeof projectId !== "string" || !PROJECT_ID_RE.test(projectId)) {
    throw new Error(`id de projeto inválido: "${String(projectId)}" (use [a-z0-9-])`);
  }
  if (desktop === null || typeof desktop !== "object" || Array.isArray(desktop)) {
    throw new Error("desktop.json deve ser um objeto");
  }
  for (const key of Object.keys(desktop)) {
    if (!["productName", "identifier", "window"].includes(key)) {
      throw new Error(`desktop.json: chave desconhecida "${key}"`);
    }
  }
  const productName = desktop.productName ?? projectId;
  if (typeof productName !== "string" || productName.trim() === "" || productName.length > 64 || /[\\/:*?"<>|\u0000-\u001f]/u.test(productName)) {
    throw new Error(`desktop.json: productName inválido "${String(productName)}"`);
  }
  const identifier = desktop.identifier ?? `com.projeto1.${projectId.replace(/-/gu, "")}`;
  if (typeof identifier !== "string" || !IDENTIFIER_RE.test(identifier) || identifier.length > 128) {
    throw new Error(`desktop.json: identifier inválido "${String(identifier)}" (reverse-DNS, ex.: com.empresa.jogo)`);
  }
  if (identifier === "com.projeto1.game") {
    throw new Error("desktop.json: identifier do host (com.projeto1.game) não pode ser usado por um jogo");
  }
  const windowOverrides = desktop.window ?? {};
  if (windowOverrides === null || typeof windowOverrides !== "object" || Array.isArray(windowOverrides)) {
    throw new Error("desktop.json: window deve ser um objeto");
  }
  for (const [key, value] of Object.entries(windowOverrides)) {
    const expected = WINDOW_KEYS[key];
    if (expected === undefined) throw new Error(`desktop.json: window.${key} não é permitido`);
    if (typeof value !== expected) throw new Error(`desktop.json: window.${key} deve ser ${expected}`);
    if (expected === "number" && (!Number.isFinite(value) || value < 200 || value > 16384)) {
      throw new Error(`desktop.json: window.${key} fora de 200..16384`);
    }
  }
  const window0 = {
    ...baseWindow,
    ...SAFE_WINDOW_DEFAULTS,
    title: productName,
    ...windowOverrides,
  };
  return {
    $schema: "https://schema.tauri.app/config/2",
    productName,
    identifier,
    app: { windows: [window0] },
  };
}

function main(argv) {
  const root = process.cwd();
  const [projectId, ...flags] = argv;
  if (!projectId) {
    console.error("uso: node scripts/tauri-project-config.mjs <id> [--build|--dev]");
    process.exit(2);
  }
  const projectDir = path.join(root, "src", "projects", projectId);
  if (!fs.existsSync(path.join(projectDir, "index.ts"))) {
    throw new Error(`projeto "${projectId}" não encontrado em src/projects/${projectId}/index.ts`);
  }
  const desktopPath = path.join(projectDir, "desktop.json");
  const desktop = fs.existsSync(desktopPath) ? JSON.parse(fs.readFileSync(desktopPath, "utf8")) : {};
  const base = JSON.parse(fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"));
  const config = buildProjectTauriConfig(projectId, desktop, base.app?.windows?.[0] ?? {});
  const outDir = path.join(root, "src-tauri", "gen");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `tauri.project.${projectId}.conf.json`);
  fs.writeFileSync(outFile, `${JSON.stringify(config, null, 2)}\n`);
  const rel = path.relative(root, outFile);
  console.log(rel);

  const mode = flags.includes("--build") ? "build" : flags.includes("--dev") ? "dev" : null;
  if (mode === null) return;
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(npx, ["tauri", mode, "--config", rel], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, VITE_PROJECT: projectId },
    shell: false,
  });
  process.exit(result.status ?? 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`[tauri-project-config] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
