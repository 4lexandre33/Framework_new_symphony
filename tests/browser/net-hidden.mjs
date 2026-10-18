// Verificação em navegador real (Chromium/Playwright) do G130: com a aba
// oculta o game loop suspende tick/render, mas o plugin game.net mantém o
// pump (relógio em Worker real) e o host não derruba o cliente.
// Uso: node tests/browser/net-hidden.mjs
// Observação: o Chromium headless não oculta abas de verdade; `document.hidden`
// é sobrescrito e `visibilitychange` é disparado (o game loop e o driver reagem
// a esse evento). O estrangulamento de timers de abas ocultas não é emulado.
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
  entryPoints: [path.join(here, "net-hidden-harness.ts")],
  bundle: true,
  format: "iife",
  write: false,
  platform: "browser",
  alias: { "@core": path.join(root, "src/core/index.ts") },
  logLevel: "warning",
});
const bundle = built.outputFiles[0].text;

const failures = [];
function check(label, condition, detail) {
  if (!condition) failures.push(`${label}: ${JSON.stringify(detail)}`);
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${condition ? "" : `  ${JSON.stringify(detail)}`}`);
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const html = `<!doctype html><html><body><script>${bundle.replace(/<\/script/giu, "<\\/script")}</script></body></html>`;
  await page.route("http://localhost:5999/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: html }));
  await page.goto("http://localhost:5999/");

  const clock = await page.evaluate(() => window.netHidden.workerClock());
  console.log("workerClock", JSON.stringify(clock));
  check("G130 relógio do pump é um Worker real e pulsa com a aba oculta", clock.source === "worker" && clock.pulses >= 5, clock);
  check("G130 pulso para quando a aba volta a ficar visível", clock.pulsesAfterShow === 0, clock);

  const off = await page.evaluate(() => window.netHidden.withoutPump());
  console.log("withoutPump", JSON.stringify(off));
  check("controle: sem backgroundPump o host oculto derruba o cliente", off.hosted && off.connected && off.ticksWhileHidden === 0 && !off.clientStillConnected, off);

  const on = await page.evaluate(() => window.netHidden.withPump());
  console.log("withPump", JSON.stringify(on));
  check("G130 com a aba oculta (loop suspenso) o host mantém o cliente", on.hosted && on.connected && on.ticksWhileHidden === 0 && on.clientStillConnected && on.hostPeers === 1, on);
  check("sem erros de página", errors.length === 0, errors);
  await context.close();
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} verificação(ões) falharam.`);
  process.exit(1);
}
console.log("\nTodas as verificações de rede com aba oculta passaram.");
