// Verificação em navegador real (Chromium/Playwright) dos GAPS de
// input/audio/assets/ui que dependem do navegador. Uso:
//   node tests/browser/engine-gaps.mjs
// Requer playwright (node_modules ou /opt/npm-tools) e browsers instalados
// (PLAYWRIGHT_BROWSERS_PATH, padrão /opt/pw-browsers). Sem rede: a página é
// criada com setContent e o harness é injetado como script.
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

const built = await esbuild.build({
  entryPoints: [path.join(here, "engine-gaps-harness.ts")],
  bundle: true,
  format: "iife",
  write: false,
  platform: "browser",
  alias: { "@core": path.join(root, "src/core/index.ts") },
  logLevel: "warning",
});
const bundle = built.outputFiles[0].text;
const css = fs.readFileSync(path.join(root, "src/styles/ui.css"), "utf8");

const failures = [];
function check(label, condition, detail) {
  if (!condition) {
    failures.push(`${label}: ${JSON.stringify(detail)}`);
  }
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${condition ? "" : `  ${JSON.stringify(detail)}`}`);
}

async function openPage(args) {
  const browser = await chromium.launch({ headless: true, args });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const logs = [];
  page.on("pageerror", (error) => logs.push(`[pageerror] ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      logs.push(`[console.error] ${message.text()}`);
    }
  });
  await page.setContent("<!doctype html><html><head></head><body></body></html>");
  await page.addScriptTag({ content: bundle });
  return { browser, page, logs };
}

// ── A: autoplay liberado (reprodução real) ───────────────────────────────
{
  const { browser, page, logs } = await openPage(["--autoplay-policy=no-user-gesture-required"]);

  const assets = await page.evaluate(() => window.gaps.assetsPhase());
  console.log("assetsPhase", JSON.stringify(assets));
  check("G80 decodifica áudio real", assets.decodedDuration > 0.2, assets);
  check("G82 progresso parcial real de bytes (textura/áudio)", assets.progressPartial && assets.progressEvents >= 4, assets);
  check("G82 textura real carregada via fetch+blob", assets.textureSize[0] === 8 && assets.textureSize[1] === 4, assets);
  check("G83 colorSpace linear respeitado", assets.textureColorSpace === "srgb-linear", assets);
  check("G83 ./a e /a mesma chave", assets.sameKey === true, assets);
  check("G82 manifesto vai de 0 a 1 em ordem", assets.manifestProgress[0] === 0 && assets.manifestProgress.at(-1) === 1 && assets.manifestProgress.every((v, i, a) => i === 0 || v >= a[i - 1]), assets.manifestProgress);

  const setup = await page.evaluate(() => window.gaps.audioSetup());
  check("Web Audio real rodando (autoplay liberado)", setup.state === "running", setup);
  const audio = await page.evaluate(() => window.gaps.audioRunningChecks());
  console.log("audioRunningChecks", JSON.stringify(audio));
  check("G20 handle posicional > 0 e controle por handle", audio.positionalHandle > 0 && audio.moved && audio.volume && audio.stopped, audio);
  check("G84 setChannelVolume sem muted mantém mudo", audio.stillMuted === true, audio);
  check("G84 crossfade-completed não sai no início", audio.earlyCompleted === false, audio);
  check("G84 crossfadeMusic resolve após a duração (~400ms)", audio.completedAtMs >= 380, audio);
  check("G85 faixa atual / mesma faixa é no-op", audio.track !== null && audio.sameTrackMs < 50, audio);
  check("G85 stopMusic limpa faixa atual", audio.currentAfterStop === null, audio);
  check("G86 limite de vozes respeitado", audio.voicesAfterLimit === 3 && audio.handlesValid, audio);
  check("G85 stopAllSounds com fade encerra vozes", audio.voicesAfterStopAll === 0, audio);

  const inputSetup = await page.evaluate((styles) => window.gaps.inputSetup(styles), css);
  console.log("inputSetup", JSON.stringify(inputSetup));
  check("G99 centro da tela é o canvas, não o #screen-hud", inputSetup.elementAtCenter === "game-canvas", inputSetup);
  check("G53 Gamepad API presente (forma real)", inputSetup.gamepadsApi === "function", inputSetup);

  await page.mouse.click(400, 300);
  let frame = await page.evaluate(() => window.gaps.inputFrame());
  check("G99/G51 clique real no canvas aciona Attack", frame.attackPressed === true, frame);
  await page.mouse.move(400, 300);
  await page.mouse.wheel(0, 240);
  await page.waitForTimeout(100);
  frame = await page.evaluate(() => window.gaps.inputFrame());
  check("G5 roda real chega ao input", frame.wheelY > 0, frame);
  let tick = await page.evaluate(() => window.gaps.inputTick());
  check("G5 bordas/roda vistas no tick", tick.attackInTick === true && tick.tickWheelY > 0, tick);
  tick = await page.evaluate(() => window.gaps.inputTick());
  check("G5 borda não se repete no tick seguinte", tick.attackInTick === false && tick.tickWheelY === 0, tick);

  await page.click("#chat");
  await page.keyboard.press("Space");
  frame = await page.evaluate(() => window.gaps.inputFrame());
  check("G51 clique no campo do HUD não aciona Attack e Space no campo não pula", frame.attackPressed === false && frame.jumpPressed === false, frame);
  await page.mouse.click(400, 300);
  await page.keyboard.press("Space");
  frame = await page.evaluate(() => window.gaps.inputFrame());
  check("G51 Space fora do campo pula", frame.jumpPressed === true, frame);
  const scrolled = await page.evaluate(() => {
    const event = new KeyboardEvent("keydown", { code: "Space", cancelable: true, bubbles: true });
    document.body.dispatchEvent(event);
    return event.defaultPrevented;
  });
  check("G51 preventDefault em tecla mapeada", scrolled === true, scrolled);

  const safety = await page.evaluate(() => window.gaps.uiSafety());
  check("G11 HTML hostil não executa no navegador", safety.xss === 0 && safety.modalHasIgnore === true, safety);
  check("sem erros de página (A)", logs.filter((l) => l.startsWith("[pageerror]")).length === 0, logs);
  await browser.close();
}

// ── B: política de autoplay que exige gesto ─────────────────────────────
// Página carregada por navegação interceptada (sem rede) e SEM evaluate antes
// do gesto: no Playwright, evaluate conta como ativação do usuário.
{
  const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=document-user-activation-required"] });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const logs = [];
  page.on("pageerror", (error) => logs.push(`[pageerror] ${String(error)}`));
  const html = `<!doctype html><html><head></head><body><script>window.__autorunGesture = true;</script><script>${bundle.replace(/<\/script/giu, "<\\/script")}</script></body></html>`;
  await page.route("http://gaps.test/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: html }));
  await page.goto("http://gaps.test/index.html");
  await page.waitForTimeout(1200); // decodifica e pede sons ANTES do gesto
  await page.mouse.click(10, 10); // gesto real
  await page.waitForTimeout(400);
  const report = await page.evaluate(() => ({ ...window.gestureReport, after: window.gaps.audioStatus() }));
  console.log("gesturePhase", JSON.stringify(report));
  check("G80 contexto suspenso antes do gesto", report.audioContextStateBeforeGesture === "suspended", report);
  check("G80 loadAudio conclui antes do gesto (sem esperar resume)", report.decodedDuration > 0.2, report);
  check("áudio da engine suspenso antes do gesto", report.stateBeforeGesture === "suspended", report);
  check("G86 gesto real desbloqueia o contexto", report.after.state === "running", report);
  check("G86 one-shot pedido antes do gesto não toca junto depois", report.after.stale === false, report);
  check("G86 loop pedido antes do gesto e one-shot do gesto tocam", report.after.loop === true && report.after.fresh === true, report);
  check("sem erros de página (B)", logs.length === 0, logs);
  await browser.close();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} verificação(ões) falharam.`);
  process.exit(1);
}

console.log("\nTodas as verificações de navegador passaram.");
