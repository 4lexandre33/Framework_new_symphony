import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const LAYER1_DOCUMENTATION_AUDIT_VERSION = "1.0.0";

export const DOC_FILES = Object.freeze([
  "README.md",
  "docs/layer1/README.md",
  "docs/layer1/runtime-lifecycle.md",
  "docs/layer1/native-tauri-steam.md",
  "docs/layer1/consumer-projects.md",
  "docs/layer1/validation-evidence.md",
]);

const REQUIRED_FILES = Object.freeze([
  ...DOC_FILES,
  "ETAPA89_MANIFEST.json",
  "ETAPA89_LAYER1_DOCUMENTATION.txt",
  "LAYER1_DOCUMENTATION_BASELINE_V1.json",
  "package.json",
  "scripts/architecture/module-map.mjs",
  "src-tauri/tauri.conf.json",
  "src-tauri/steam_appid.txt",
  "src-tauri/src/lib.rs",
]);

const STALE_README_CLAIMS = Object.freeze([
  [/até a Etapa 25/u, "README ainda afirma estado 'até a Etapa 25'"],
  [/não deve ser presumida/u, "README ainda diz que arch:check não integra o build"],
  [/camada conceitual de domínio/u, "README ainda trata o Domain como conceitual"],
  [/Estrutura conceitual futura/u, "README ainda possui a seção 'Estrutura conceitual futura'"],
]);

const TAURI_AREAS = Object.freeze(["steam", "overlay", "security", "modding", "monetization"]);
const FIRST_STAGE = 71;
const LAST_STAGE = 89;

const PATH_EXTENSION = /\.(?:ts|mjs|json|md|txt|rs|toml|yml|yaml|html)$/u;
const PATH_ROOTS = /^(?:src|src-tauri|docs|tests|scripts|public|\.github|\.agents|\.migration)\//u;

function abs(root, relativePath) {
  return path.join(root, ...relativePath.split("/"));
}

function readText(root, relativePath) {
  return fs.readFileSync(abs(root, relativePath), "utf8").replace(/\r\n/gu, "\n");
}

function violation(code, scope, message) {
  return Object.freeze({ code, scope, message });
}

function stripFences(text) {
  return text.replace(/```[\s\S]*?```/gu, "");
}

function inlineCode(text) {
  const tokens = [];
  for (const match of stripFences(text).matchAll(/`([^`\n]+)`/gu)) tokens.push(match[1].trim());
  return tokens;
}

function isPathToken(token) {
  if (/[\s<>*{}$|=()[\]#]/u.test(token)) return false;
  if (/^(?:https?:|@|\.\.\/)/u.test(token)) return false;
  const clean = token.replace(/^\//u, "");
  return PATH_ROOTS.test(clean) || PATH_EXTENSION.test(clean);
}

function tauriHandlers(libSource) {
  const start = libSource.indexOf("generate_handler![");
  if (start < 0) return [];
  const end = libSource.indexOf("]", start);
  const block = libSource.slice(start, end);
  return [...block.matchAll(/\b(steam|overlay|security|modding|monetization)::([a-z0-9_]+)/gu)].map((m) => ({
    area: m[1],
    name: m[2],
  }));
}

export async function auditLayer1Documentation({ projectRoot = process.cwd() } = {}) {
  const root = path.resolve(projectRoot);
  const checks = [];
  const violations = [];

  const record = (id, ok, detail = "") => checks.push({ id, ok, detail });
  const fail = (code, scope, message) => violations.push(violation(code, scope, message));

  // 1. Stage 88 precisa estar certificada.
  try {
    const previous = JSON.parse(readText(root, "ETAPA88_AUTOMATED_PASS.json"));
    const ok = previous.stage === 88 && previous.status === "PASS" && previous.violations === 0;
    record("previous.stage88", ok);
    if (!ok) fail("DOC_PREVIOUS_STAGE", "ETAPA88_AUTOMATED_PASS.json", "Stage 88 não está PASS/0 violations");
  } catch (error) {
    record("previous.stage88", false);
    fail("DOC_PREVIOUS_STAGE", "ETAPA88_AUTOMATED_PASS.json", `ausente ou inválido: ${String(error)}`);
  }

  // 2. Arquivos obrigatórios.
  const missing = REQUIRED_FILES.filter((file) => !fs.existsSync(abs(root, file)));
  record("required.files", missing.length === 0, `${REQUIRED_FILES.length - missing.length}/${REQUIRED_FILES.length}`);
  for (const file of missing) fail("DOC_FILE_MISSING", file, "arquivo obrigatório ausente");
  if (missing.length > 0) return finish();

  const texts = new Map(DOC_FILES.map((file) => [file, readText(root, file)]));
  const pkg = JSON.parse(readText(root, "package.json"));
  const scripts = new Set(Object.keys(pkg.scripts ?? {}));

  // 3. Referências a caminhos, links e scripts npm.
  let referenceCount = 0;
  let referenceMisses = 0;
  for (const [file, text] of texts) {
    const seen = new Set();
    for (const token of inlineCode(text)) {
      if (!isPathToken(token) || seen.has(token)) continue;
      seen.add(token);
      referenceCount += 1;
      const target = token.replace(/^\//u, "").replace(/\/$/u, "");
      if (!fs.existsSync(abs(root, target))) {
        referenceMisses += 1;
        fail("DOC_REF_MISSING", file, `caminho citado não existe: ${token}`);
      }
    }

    for (const match of text.matchAll(/\[[^\]\n]*\]\(([^)\s]+)\)/gu)) {
      const link = match[1];
      if (/^(?:https?:|mailto:|#)/u.test(link)) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), link.split("#")[0]));
      if (!fs.existsSync(abs(root, target))) fail("DOC_LINK_BROKEN", file, `link relativo quebrado: ${link}`);
    }

    for (const match of text.matchAll(/npm run ([A-Za-z0-9:_-]+)/gu)) {
      if (!scripts.has(match[1])) fail("DOC_NPM_SCRIPT_MISSING", file, `script npm inexistente: ${match[1]}`);
    }

    for (const token of inlineCode(text)) {
      if (/^stage\d+:[a-z]+$/u.test(token) && !scripts.has(token)) {
        fail("DOC_NPM_SCRIPT_MISSING", file, `script npm inexistente: ${token}`);
      }
    }
  }
  record("references.resolve", referenceMisses === 0, `${referenceCount} caminhos conferidos`);

  // 4. Todas as stages 71–89 listadas com seu documento técnico real.
  const layer1Readme = texts.get("docs/layer1/README.md");
  const rootFiles = fs.readdirSync(root);
  for (let stage = FIRST_STAGE; stage <= LAST_STAGE; stage += 1) {
    const doc = rootFiles.find((f) => f.startsWith(`ETAPA${String(stage)}_`) && f.endsWith(".txt") && !f.includes("SHA256SUMS"));
    if (!doc) {
      fail("DOC_STAGE_NOT_LISTED", "docs/layer1/README.md", `documento técnico da Stage ${String(stage)} não existe na raiz`);
    } else if (!layer1Readme.includes(`\`${doc}\``)) {
      fail("DOC_STAGE_NOT_LISTED", "docs/layer1/README.md", `Stage ${String(stage)} sem referência a ${doc}`);
    }
  }
  record("stages.listed", !violations.some((v) => v.code === "DOC_STAGE_NOT_LISTED"), `${String(LAST_STAGE - FIRST_STAGE + 1)} stages`);

  // 5. Módulos canônicos.
  const moduleMap = await import(pathToFileURL(abs(root, "scripts/architecture/module-map.mjs")).href);
  const modules = moduleMap.CANONICAL_MODULES;
  const moduleCount = modules.length;
  if (!layer1Readme.includes(`**${String(moduleCount)} módulos**`)) {
    fail("DOC_MODULE_COUNT", "docs/layer1/README.md", `contagem de módulos diverge do module-map (${String(moduleCount)})`);
  }
  for (const entry of modules) {
    if (!layer1Readme.includes(`\`${entry.key}\``)) {
      fail("DOC_MODULE_MISSING", "docs/layer1/README.md", `módulo não listado: ${entry.key}`);
    }
  }
  record("modules.match-module-map", !violations.some((v) => v.code === "DOC_MODULE_COUNT" || v.code === "DOC_MODULE_MISSING"), `${String(moduleCount)} módulos`);

  // 6. Host Tauri: comandos, identidade e Steam.
  const nativeDoc = texts.get("docs/layer1/native-tauri-steam.md");
  const handlers = tauriHandlers(readText(root, "src-tauri/src/lib.rs"));
  const totalMatch = /somam\s+\*\*(\d+)\*\*/u.exec(nativeDoc);
  if (!totalMatch || Number(totalMatch[1]) !== handlers.length) {
    fail("DOC_TAURI_COMMAND_COUNT", "docs/layer1/native-tauri-steam.md", `total documentado ${totalMatch ? totalMatch[1] : "ausente"} != ${String(handlers.length)} em lib.rs`);
  }
  for (const area of TAURI_AREAS) {
    const actual = handlers.filter((h) => h.area === area).length;
    const row = new RegExp(`\\|\\s*(\\d+)\\s*\\|\\s*\`src-tauri/src/${area}\\.rs\``, "u").exec(nativeDoc);
    if (!row || Number(row[1]) !== actual) {
      fail("DOC_TAURI_COMMAND_COUNT", "docs/layer1/native-tauri-steam.md", `${area}: documentado ${row ? row[1] : "ausente"} != ${String(actual)} em lib.rs`);
    }
  }

  const tauriConf = JSON.parse(readText(root, "src-tauri/tauri.conf.json"));
  for (const [label, value] of [["productName", tauriConf.productName], ["identifier", tauriConf.identifier]]) {
    if (!nativeDoc.includes(`\`${value}\``)) fail("DOC_CONFIG_MISMATCH", "docs/layer1/native-tauri-steam.md", `${label} '${value}' não documentado`);
  }
  if (!nativeDoc.includes(`\`${tauriConf.version}\``)) {
    fail("DOC_CONFIG_MISMATCH", "docs/layer1/native-tauri-steam.md", `versão '${tauriConf.version}' não documentada`);
  }
  if (!nativeDoc.includes(`\`${tauriConf.build.frontendDist}\``)) {
    fail("DOC_CONFIG_MISMATCH", "docs/layer1/native-tauri-steam.md", "frontendDist não documentado");
  }
  const appId = readText(root, "src-tauri/steam_appid.txt").trim();
  if (!nativeDoc.includes(`\`${appId}\``)) fail("DOC_CONFIG_MISMATCH", "docs/layer1/native-tauri-steam.md", `AppID '${appId}' não documentado`);
  record("tauri.host-facts", !violations.some((v) => v.code === "DOC_TAURI_COMMAND_COUNT" || v.code === "DOC_CONFIG_MISMATCH"), `${String(handlers.length)} comandos`);

  // 7. README raiz sem afirmações obsoletas e coerente com o build real.
  const readme = texts.get("README.md");
  for (const [pattern, message] of STALE_README_CLAIMS) {
    if (pattern.test(readme)) fail("DOC_STALE_CLAIM", "README.md", message);
  }
  if (!String(pkg.scripts.build ?? "").startsWith("npm run arch:check") || !readme.includes("npm run arch:check && tsc && vite build")) {
    fail("DOC_STALE_CLAIM", "README.md", "descrição do script build diverge do package.json");
  }
  record("readme.not-stale", !violations.some((v) => v.code === "DOC_STALE_CLAIM"));

  // 8. Nenhum PASS prematuro.
  for (const [file, text] of texts) {
    for (const line of text.split("\n")) {
      if (/LAYER 1 PASS/u.test(line) && !/não/u.test(line)) {
        fail("DOC_PREMATURE_PASS", file, "declara LAYER 1 PASS antes da Stage 90");
      }
    }
  }
  record("no.premature-pass", !violations.some((v) => v.code === "DOC_PREMATURE_PASS"));

  // 9. Baseline não pode divergir do código.
  const baseline = JSON.parse(readText(root, "LAYER1_DOCUMENTATION_BASELINE_V1.json"));
  if (baseline.moduleCount !== moduleCount || baseline.tauriCommandCount !== handlers.length) {
    fail("DOC_BASELINE_DRIFT", "LAYER1_DOCUMENTATION_BASELINE_V1.json", "contagens da baseline divergem do código atual");
  }
  record("baseline.in-sync", !violations.some((v) => v.code === "DOC_BASELINE_DRIFT"));

  return finish();

  function finish() {
    return Object.freeze({
      schemaVersion: 1,
      stage: 89,
      auditVersion: LAYER1_DOCUMENTATION_AUDIT_VERSION,
      ok: violations.length === 0,
      checks: Object.freeze(checks),
      violations: Object.freeze(violations),
    });
  }
}

export function formatLayer1DocumentationAudit(result) {
  const lines = [
    "============================================================",
    "STAGE 89 — LAYER 1 DOCUMENTATION AUDIT",
    "============================================================",
    `[INFO] Audit version: ${result.auditVersion}`,
    `[INFO] Semantic checks: ${String(result.checks.length)}`,
  ];

  for (const check of result.checks) {
    lines.push(`[${check.ok ? "OK" : "FAIL"}] ${check.id}${check.detail ? ` — ${check.detail}` : ""}`);
  }

  if (result.ok) {
    lines.push("[OK] Layer 1 documentation audit: 0 violations");
  } else {
    lines.push(`[FAIL] Violations: ${String(result.violations.length)}`);
    for (const item of result.violations) lines.push(`[${item.code}] ${item.scope} — ${item.message}`);
  }

  lines.push("============================================================", "");
  return lines.join("\n");
}
