#!/usr/bin/env node
/**
 * Verificação em WebGL REAL dos gaps de render/câmera/vfx/sprites.
 *
 *   node tests/browser/render-vfx-sprites.mjs
 *
 * Requer Playwright + Chromium (procura `playwright` no projeto e em
 * /opt/npm-tools/node_modules; navegadores em PLAYWRIGHT_BROWSERS_PATH ou
 * /opt/pw-browsers). Usa SwiftShader (sem GPU). A página é montada com
 * `setContent` e o harness é injetado inline (sem rede).
 * Não faz parte do vitest. Sai com código 1 se alguma verificação falhar.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const projectRequire = createRequire(path.join(root, "package.json"));

function loadPlaywright() {
  const candidates = [root, "/opt/npm-tools"];
  for (const base of candidates) {
    try {
      return createRequire(path.join(base, "package.json"))("playwright");
    } catch {
      // tenta o próximo
    }
  }
  throw new Error("playwright não encontrado (instale ou ajuste /opt/npm-tools).");
}

if (process.env.PLAYWRIGHT_BROWSERS_PATH === undefined && fs.existsSync("/opt/pw-browsers")) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = "/opt/pw-browsers";
}

const esbuild = projectRequire("esbuild");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-webgl-"));
const outfile = path.join(outDir, "bundle.js");

await esbuild.build({
  entryPoints: [path.join(here, "harness.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  outfile,
  alias: { "@core": path.join(root, "src/core/index.ts") },
  logLevel: "error",
});

const { chromium } = loadPlaywright();
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

let failed = 0;
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 300)));
  await page.setContent("<!doctype html><html><body><div id=\"app\"></div></body></html>");
  await page.addScriptTag({ content: fs.readFileSync(outfile, "utf8") });
  const results = await page.evaluate(() => window.runChecks());

  for (const result of results) {
    const { name, ok, ...details } = result;
    if (!ok) failed += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok || process.env.VERBOSE === "1") {
      console.log(`      ${JSON.stringify(details)}`);
    }
  }

  if (pageErrors.length > 0) {
    failed += 1;
    console.log(`FAIL  page errors: ${JSON.stringify(pageErrors)}`);
  }

  console.log(`\n${String(results.length - failed)}/${String(results.length)} verificações WebGL passaram.`);
} finally {
  await browser.close();
  fs.rmSync(outDir, { recursive: true, force: true });
}

process.exit(failed === 0 ? 0 : 1);
