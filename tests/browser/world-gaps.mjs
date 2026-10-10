// Verificação em navegador real (Chromium/Playwright + WebGL swiftshader) dos
// GAPS de terrain/streaming que dependem do navegador: Worker REAL de terreno,
// recuperação de Worker quebrado/travado, render WebGL dos chunks e HLOD.
//   node tests/browser/world-gaps.mjs
// Sem rede: página via setContent; bundles injetados (Worker via Blob URL).
import fs from "node:fs";
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

async function bundle(entry) {
  const built = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    write: false,
    platform: "browser",
    alias: { "@core": path.join(root, "src/core/index.ts") },
    logLevel: "error",
  });
  return built.outputFiles[0].text;
}

const workerCode = await bundle(path.join(root, "src/engine/terrain/internal/terrain.worker.ts"));
const harness = await bundle(path.join(here, "world-gaps-harness.ts"));

const failures = [];
function check(label, condition, detail) {
  if (!condition) failures.push(`${label}: ${JSON.stringify(detail)}`);
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${condition ? "" : `  ${JSON.stringify(detail)}`}`);
}

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const logs = [];
page.on("pageerror", (error) => logs.push(`[pageerror] ${String(error)}`));
page.on("console", (message) => {
  if (message.type() === "error") logs.push(`[console.error] ${message.text()}`);
});
await page.setContent("<!doctype html><html><head></head><body></body></html>");
await page.evaluate((code) => {
  window.__terrainWorkerUrl = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
}, workerCode);
await page.addScriptTag({ content: harness });

const worker = await page.evaluate(() => window.worldGaps.realWorker());
console.log("realWorker", JSON.stringify(worker));
check("G58/G59 Worker real gera chunk 16x256x16", worker.sizeY === 256 && worker.length === 16 * 256 * 16, worker);
check("G58 Worker real == gerador do main thread (sem fallback)", worker.equalToMainThread === true && worker.fallbacks === 0 && worker.workers === 2, worker);

const broken = await page.evaluate(() => window.worldGaps.brokenWorkers());
console.log("brokenWorkers", JSON.stringify(broken));
check("G58 Worker que falha ao carregar não trava: fallback local + slot descartado", broken.broken.length === 65536 && broken.broken.secondLength === 65536 && broken.broken.fallbacks >= 2 && broken.broken.workers === 0, broken.broken);
check("G58 Worker travado: timeout -> fallback local e reinício", broken.hanging.length === 65536 && broken.hanging.timeouts === 1 && broken.hanging.restarts === 1 && broken.hanging.ms < 5000, broken.hanging);

const terrain = await page.evaluate(() => window.worldGaps.terrainRender());
console.log("terrainRender", JSON.stringify(terrain));
check("G3 streaming carrega 13 chunks (raio 2) via Worker real", terrain.ready === true && terrain.stats.renderedChunks >= 13 && terrain.fallbacks === 0, terrain);
check("G3 cores por vértice (paleta) e G59 água transparente", terrain.coloredMeshes >= 13 && terrain.transparentMeshes >= 1, terrain);
check("render WebGL real mostra o terreno com várias cores", terrain.colors.nonBlack > 500 && terrain.colors.distinct >= 6 && terrain.glError === 0, terrain);

const hlod = await page.evaluate(() => window.worldGaps.hlod());
console.log("hlod", JSON.stringify(hlod));
check("G61 HLOD funde 40 malhas em 1 draw call", hlod.result?.sourceMeshCount === 40 && hlod.result?.mergedDrawCalls === 1, hlod);
check("G61 longe: proxy ativo reduz draw calls no WebGL", hlod.active === true && hlod.nearCalls >= 40 && hlod.farCalls === 1 && hlod.farPixels > 0, hlod);

// Worker gerado pelo `vite build` (module worker), se houver dist/.
const distAssets = path.join(root, "dist/assets");
const builtWorker = fs.existsSync(distAssets)
  ? fs.readdirSync(distAssets).find((name) => name.startsWith("terrain.worker-") && name.endsWith(".js"))
  : undefined;

if (builtWorker) {
  const code = fs.readFileSync(path.join(distAssets, builtWorker), "utf8");
  const built = await page.evaluate(async (source) => {
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const run = (type) =>
      new Promise((resolve) => {
        const worker = new Worker(url, { type });
        const timer = setTimeout(() => resolve({ type, error: "timeout" }), 5000);
        worker.addEventListener("message", (event) => {
          clearTimeout(timer);
          worker.terminate();
          resolve({ type, jobId: event.data.jobId, length: event.data.chunk?.blocks?.length ?? -1 });
        });
        worker.addEventListener("error", (event) => {
          clearTimeout(timer);
          worker.terminate();
          resolve({ type, error: String(event.message ?? event.type) });
        });
        worker.postMessage({ jobId: 7, coord: { x: 0, y: 0, z: 0 }, seed: 1337 });
      });
    return { module: await run("module"), classic: await run("classic") };
  }, code);
  console.log("viteWorker", builtWorker, JSON.stringify(built));
  // Neste Chromium, Worker {type:"module"} criado de Blob numa página
  // about:blank (setContent) falha até para um script trivial (limitação do
  // ambiente, não do bundle); o script é o mesmo, então basta um modo responder.
  const ok = [built.module, built.classic].some((r) => r.jobId === 7 && r.length === 65536);
  check("G58 Worker do vite build responde (dist/assets)", ok, built);
} else {
  console.log("SKIP  Worker do vite build (rode `npm run build` antes)");
}

await browser.close();

if (logs.length > 0) {
  console.log(logs.join("\n"));
}

check("sem erros de página", logs.filter((line) => !line.includes("boom on load")).length === 0, logs);

if (failures.length > 0) {
  console.error(`\n${failures.length} falha(s)`);
  process.exit(1);
}

console.log("\nOK: terrain/streaming verificados em navegador real.");
