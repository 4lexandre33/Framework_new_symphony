// Verificação em navegador real (Chromium/Playwright) de G16/G113/G114
// (security) e G15 (overlay: cursor real + hit-test DOM). Uso:
//   node tests/browser/security-overlay-gaps.mjs
// Sem rede: setContent + harness injetado. Sem Tauri (nativo não verificado aqui).
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const requireFromRoot = createRequire(path.join(root, "package.json"));
function load(name) {
  try {
    return requireFromRoot(name);
  } catch {
    return createRequire("/opt/npm-tools/node_modules/")(name);
  }
}
process.env.PLAYWRIGHT_BROWSERS_PATH ??= "/opt/pw-browsers";
const esbuild = load("esbuild");
const { chromium } = load("playwright");

const built = await esbuild.build({
  entryPoints: [path.join(here, "security-overlay-harness.ts")],
  bundle: true,
  format: "iife",
  write: false,
  platform: "browser",
  alias: { "@core": path.join(root, "src/core/index.ts") },
  logLevel: "warning",
});

const failures = [];
function check(label, condition, detail) {
  if (!condition) failures.push(`${label}: ${JSON.stringify(detail)}`);
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${condition ? "" : `  ${JSON.stringify(detail)}`}`);
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.setContent("<!doctype html><html><head></head><body></body></html>");
  // Conta contextos WebGL criados (G115: o dump não pode criar nenhum).
  await page.evaluate(() => {
    window.__glCount = 0;
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (String(type).startsWith("webgl")) window.__glCount += 1;
      return orig.call(this, type, ...rest);
    };
  });
  await page.addScriptTag({ content: built.outputFiles[0].text });

  const sec = await page.evaluate(() => window.gaps.securityPhase());
  console.log("securityPhase", JSON.stringify(sec));
  check("G16 erro real de window capturado", sec.crashSources.includes("window.error"), sec);
  check("G16 unhandledrejection real capturado", sec.crashSources.includes("unhandledrejection"), sec);
  check("G115 sem Tauri: written=false (não finge gravar)", sec.crashWritten.every((w) => w === false), sec);
  check("G115 dump não cria contexto WebGL", sec.glContextsCreated === 0, sec);
  check("G113 fps do RAF real (não o tick rate fixo)", sec.fps > 10 && sec.fps < 250 && sec.windowFrames >= 30, sec);
  check("G114 validador honesto passa (relógio real)", sec.honestValid === true && sec.honestSource === "wall-clock", sec);
  check("G114 delta mentiroso reprovado no navegador", sec.liar === false, sec);
  check("G114 sem falso positivo de speedhack", sec.speedhack.detections === 0, sec);

  const ov = await page.evaluate(() => window.gaps.overlayPhase());
  console.log("overlayPhase", JSON.stringify(ov));
  check("G15 padrão manual sem passthrough", ov.manualBefore === false, ov);
  check("G15 hit-test DOM: botão é UI", ov.hitMenu.hit === true && ov.hitMenu.elementId === "menu", ov);
  check("G15 data-overlay-passthrough não bloqueia", ov.hitDeco.hit === false, ov);
  check("G15 fundo = sem hit", ov.hitBg.hit === false, ov);

  const states = [];
  for (const [x, y] of [[50, 25], [600, 400], [250, 25], [60, 30]]) {
    await page.mouse.move(x, y);
    await page.waitForTimeout(30);
    states.push((await page.evaluate(() => window.gaps.overlayState())).passthrough);
  }
  check("G15 cursor real alterna passthrough (UI/fundo/decor/UI)", JSON.stringify(states) === JSON.stringify([false, true, true, false]), states);
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} falha(s)`);
  process.exit(1);
}
console.log("\nOK");
