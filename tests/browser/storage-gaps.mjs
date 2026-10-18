// Verificação em navegador real (Chromium/Playwright) dos GAPS de storage que
// dependem do navegador: Web Storage real (origem opaca, cota), WebCrypto e
// persistência entre recarregamentos. Uso: node tests/browser/storage-gaps.mjs
// Sem rede: páginas por setContent ou navegação interceptada (page.route).
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
  entryPoints: [path.join(here, "storage-harness.ts")],
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
  // A: origem opaca (setContent em about:blank).
  {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.addScriptTag({ content: bundle });
    const result = await page.evaluate(() => window.storageGaps.opaqueOrigin());
    console.log("opaqueOrigin", JSON.stringify(result));
    const okKind = result.webStorageThrows ? ["memory"] : ["indexeddb", "local-storage"];
    check("G12/G102 origem opaca: IndexedDB/Web Storage indisponíveis caem para o próximo backend, sem lançar", okKind.includes(result.info.kind) && result.loaded?.a === 1, result);
    await page.close();
  }

  // B: origem real (navegação interceptada).
  const context = await browser.newContext();
  const page = await context.newPage();
  const html = `<!doctype html><html><body><script>${bundle.replace(/<\/script/giu, "<\\/script")}</script></body></html>`;
  await page.route("http://storage.test/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: html }));
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto("http://storage.test/index.html");
  const imported = await page.evaluate(() => window.storageGaps.legacyImport());
  console.log("legacyImport", JSON.stringify(imported));
  check("G102 navegador usa IndexedDB por padrão", imported.info.kind === "indexeddb" && imported.info.persistent === true, imported.info);
  check("G102 saves antigos do localStorage importados para o IndexedDB", imported.loaded?.gold === 7 && imported.list.includes("antigo"), imported);
  check("G102 novos saves não vão para o localStorage", !imported.localKeys.some((k) => k.includes("novo")), imported.localKeys);

  const idbWritten = await page.evaluate(() => window.storageGaps.idbWrite());
  check("G102 IndexedDB aceita saves de 8 MB (+ backup) acima da cota do Web Storage", idbWritten.info.kind === "indexeddb" && idbWritten.localKeys.length === 0, idbWritten);
  await page.reload();
  const idbRead = await page.evaluate(() => window.storageGaps.idbRead());
  console.log("idbRead", JSON.stringify({ ...idbRead }));
  check("G102 IndexedDB persiste entre recarregamentos", idbRead.first === "r" && idbRead.size === 8 * 1024 * 1024 && idbRead.list.includes("grande"), idbRead);
  check("G102 IndexedDB delete", idbRead.deleted === true && idbRead.after === null, idbRead);

  const written = await page.evaluate(() => window.storageGaps.persistWrite());
  console.log("persistWrite", JSON.stringify(written));
  check("G12 Web Storage real (injetado) é persistente", written.info.kind === "custom" && written.info.persistent === true, written.info);
  check(
    "G102 chaves com namespace; backup e índice internos",
    written.keys.every((k) => k.startsWith("ns:meu-jogo:")) && written.keys.some((k) => k.includes("#bak1:")) && written.keys.some((k) => k.endsWith("#index")),
    written.keys,
  );

  await page.reload();
  const read = await page.evaluate(() => window.storageGaps.persistRead());
  console.log("persistRead", JSON.stringify(read));
  check("persiste entre recarregamentos", read.before?.gold === 2, read.before);
  check("G101 adulteração detectada e recuperada do backup (HMAC; http:// inseguro usa o SHA-256 JS)", read.recovered.status === "recovered" && read.recovered.data?.gold === 1, read.recovered);
  check("G101 evento save-recovered", read.events.includes("game.storage.save-recovered"), read.events);
  check("G103 metadados via opções; índice atualizado após a recuperação", read.list.length === 1 && read.list[0][1] === true && read.list[0][2] === 12, read.list);
  check("G102 outro namespace não enxerga os saves", read.otherList === 0, read.otherList);

  const quota = await page.evaluate(() => window.storageGaps.quota());
  console.log("quota", JSON.stringify(quota));
  check("G102 cota real: rejeita com code quota-exceeded", quota.failure?.code === "quota-exceeded", quota.failure);
  check("G102 cota real: save-completed com success:false", quota.failedEvent?.success === false && quota.failedEvent?.errorCode === "quota-exceeded", quota.failedEvent);
  check("G102 sem espaço p/ backup ainda grava o principal", quota.ok === null && quota.second === null && quota.loaded === "z", quota);
  check("sem erros de página", errors.length === 0, errors);
  await context.close();
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} verificação(ões) falharam.`);
  process.exit(1);
}
console.log("\nTodas as verificações de storage no navegador passaram.");
