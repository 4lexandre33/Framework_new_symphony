#!/usr/bin/env node
// scripts/generate-plugin-barrel.mjs
//
// Varre `src/plugins/*/manifest.ts` e escreve `src/plugins.generated.ts`
// com o array `ALL_PLUGINS`. Roda no `prebuild` / `predev` para manter
// a lista sincronizada com o filesystem sem enumeração manual.
//
// Uso:
//   node scripts/generate-plugin-barrel.mjs [--root <dir>] [--out <file>]
//
// Regras:
//   - Só diretórios com `manifest.ts` e `index.ts` viram plugin.
//   - `__tests__` e nomes iniciando com `.` ou `_` são pulados.
//   - O array de saída é ordenado por id de pasta (estável).

import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PLUGINS_DIR = join(ROOT, "src/plugins");
const DEFAULT_OUT = join(ROOT, "src/plugins.generated.ts");

function parseArgs(argv) {
  let root = DEFAULT_PLUGINS_DIR;
  let out = DEFAULT_OUT;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--root") root = argv[++i];
    else if (arg === "--out") out = argv[++i];
  }
  return { root, out };
}

function isPluginDir(name) {
  if (name.startsWith(".") || name.startsWith("_")) return false;
  if (name === "__tests__" || name === "node_modules") return false;
  return true;
}

async function discoverPlugins(root) {
  const entries = await readdir(root);
  const plugins = [];
  for (const name of entries) {
    if (!isPluginDir(name)) continue;
    const dir = join(root, name);
    const manifest = join(dir, "manifest.ts");
    const index = join(dir, "index.ts");
    if (!existsSync(manifest)) continue;
    if (!existsSync(index)) continue;
    const manifestText = await readFile(manifest, "utf8");
    const idMatch = manifestText.match(/id:\s*["']([^"']+)["']/);
    plugins.push({
      dirName: name,
      id: idMatch?.[1] ?? `unknown-${name}`,
    });
  }
  plugins.sort((a, b) => a.dirName.localeCompare(b.dirName));
  return plugins;
}

function emit(plugins, outPath) {
  const importLines = plugins
    .map(
      (p) =>
        `import { plugin as ${sanitize(p.dirName)} } from "./plugins/${p.dirName}";`,
    )
    .join("\n");
  const arrayLines = plugins
    .map((p) => `  ${sanitize(p.dirName)},`)
    .join("\n");

  const body = `// src/plugins.generated.ts
//
// ─────────────────────────────────────────────────────────────────────
// GERADO POR scripts/generate-plugin-barrel.mjs — NÃO EDITE À MÃO.
// ─────────────────────────────────────────────────────────────────────
//
// Enumera todos os plugins first-party em \`src/plugins/*\`. Consumido
// pelo bootstrap como fallback quando auto-discovery não está ativo.
//
// Regenerar: \`node scripts/generate-plugin-barrel.mjs\` (ou via
// \`npm run predev\` / \`npm run prebuild\`).

import type { Plugin } from "@core";

${importLines || "// (nenhum plugin descoberto)"}

export const ALL_PLUGINS: readonly Plugin[] = [
${arrayLines || "  // (vazio)"}
];
`;

  return writeFile(outPath, body, "utf8");
}

function sanitize(name) {
  return name.replace(/[^a-zA-Z0-9_$]/g, "_").replace(/^[0-9]/, "_$&");
}

async function main() {
  const { root, out } = parseArgs(process.argv.slice(2));
  const plugins = await discoverPlugins(root);
  await emit(plugins, out);
  console.log(
    `[generate-plugin-barrel] ${plugins.length} plugin(s) → ${relative(ROOT, out)}`,
  );
}

main().catch((err) => {
  console.error("[generate-plugin-barrel] falhou:", err);
  process.exit(1);
});