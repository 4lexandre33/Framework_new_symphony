#!/usr/bin/env node
/**
 * snapshot.mjs
 *
 * Script gerador de snapshots automatizados para o Projeto1_c2.
 * Cria uma cópia limpa do projeto e consolida todo o código em um arquivo Markdown único (.md)
 * com tabela de conteúdos e metadados para auditoria e contextos de IA.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_CONFIG = path.join(SCRIPT_DIR, ".snapshot-repository");
const PROJECT_NAME = process.env.PROJECT_NAME || "Projeto1";

const EXCLUDES = [
  "node_modules",
  ".git",
  ".vite",
  ".tanstack",
  ".vercel",
  "dist",
  "coverage",
  ".next",
  ".bash-errors",
  ".fix-backup",
  ".cleanup-backup",
  ".backup",
  ".snapshot-repository",
  ".kernel-hardening-backup",
  "sessions",
  "~bin",
  "devnull",
  "tmpsnap-trace.log",
  "*.bak",
  "src-tauri/target",
];

const isTTY = process.stdout.isTTY;
const R = isTTY ? "\x1b[31m" : "";
const G = isTTY ? "\x1b[32m" : "";
const Y = isTTY ? "\x1b[33m" : "";
const B = isTTY ? "\x1b[34m" : "";
const C = isTTY ? "\x1b[36m" : "";
const N = isTTY ? "\x1b[0m" : "";

const say = (...args) => console.log(`${B}▸${N}`, ...args);
const ok = (...args) => console.log(`${G}✓${N}`, ...args);
const warn = (...args) => console.log(`${Y}!${N}`, ...args);
const err = (...args) => console.error(`${R}✗${N}`, ...args);
const note = (...args) => console.log(`${C}·${N}`, ...args);

function prompt(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

function normalizePath(p) {
  if (!p) return p;
  let str = p.trim().replace(/^["']|["']\$/g, "");

  if (process.platform === "win32") {
    const posixMatch = str.match(/^[/\\]([a-zA-Z])([/\\].*)?\$/);
    if (posixMatch) {
      str = `${posixMatch.toUpperCase()}:${posixMatch || ""}`;
    }
  }
  return path.normalize(str);
}

function getTimestamps() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");

  const ts = `${year}${month}${day}_${hours}${minutes}${seconds}`;
  const human = `${day}/${month}/${year}, ${hours}:${minutes}:${seconds}`;
  const iso = now.toISOString();

  return { ts, human, iso };
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function anchorFor(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9_\-\/]/g, "")
    .replace(/[\/\\]/g, "");
}

function langFor(ext) {
  const map = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    rs: "rust",
    toml: "toml",
    html: "html",
    css: "css",
    md: "markdown",
    sh: "bash",
    bat: "cmd",
    sql: "sql",
  };
  return map[ext] || "";
}

function mimeFor(ext) {
  const map = {
    ts: "texto/código",
    tsx: "texto/código",
    js: "texto/código",
    jsx: "texto/código",
    mjs: "texto/código",
    cjs: "texto/código",
    json: "texto/config",
    rs: "texto/código",
    toml: "texto/config",
    html: "texto/html",
    css: "texto/css",
    md: "texto/markdown",
    sh: "texto/script",
    bat: "texto/script",
    sql: "texto/sql",
  };
  return map[ext] || "texto/plain";
}

function isExcluded(relPath) {
  const normalized = relPath.replaceAll("\\", "/");
  const parts = normalized.split("/");
  for (const part of parts) {
    for (const ex of EXCLUDES) {
      if (ex.startsWith("*.")) {
        const ext = ex.slice(1);
        if (part.endsWith(ext)) return true;
      } else if (part === ex || normalized.startsWith(ex)) {
        return true;
      }
    }
  }
  return false;
}

async function chooseSnapshotRoot() {
  console.log(`\n${B}Configuração do Repositório de Snapshots${N}`);
  console.log("Informe a pasta onde os snapshots serão armazenados (fora do projeto).");
  console.log("Exemplo no Windows: C:\\Users\\SeuUsuario\\Snapshots");

  const answer = await prompt("\nCaminho do repositório: ");
  if (!answer) {
    err("Caminho não fornecido. Abortando.");
    process.exit(1);
  }

  const resolved = normalizePath(answer);
  try {
    fs.mkdirSync(resolved, { recursive: true });
    fs.writeFileSync(REPOSITORY_CONFIG, resolved, "utf8");
    ok(`Repositório salvo em ${REPOSITORY_CONFIG}`);
  } catch (e) {
    err(`Não foi possível criar o diretório: ${e.message}`);
    process.exit(1);
  }
  return resolved;
}

async function loadSnapshotRoot() {
  if (process.env.SNAPSHOT_ROOT) {
    const root = normalizePath(process.env.SNAPSHOT_ROOT);
    fs.mkdirSync(root, { recursive: true });
    return root;
  }
  if (fs.existsSync(REPOSITORY_CONFIG)) {
    const saved = fs.readFileSync(REPOSITORY_CONFIG, "utf8").trim();
    if (saved) {
      const resolved = normalizePath(saved);
      try {
        fs.mkdirSync(resolved, { recursive: true });
        return resolved;
      } catch {
        warn("Repositório salvo não está acessível. Escolha outro.");
      }
    }
  }
  return await chooseSnapshotRoot();
}

function getRegistryPath(snapshotRoot) {
  return path.join(snapshotRoot, ".registry.json");
}

function ensureRegistry(registryPath) {
  if (!fs.existsSync(registryPath)) {
    const init = { version: 1, lastSeq: 0, snapshots: [] };
    fs.writeFileSync(registryPath, JSON.stringify(init, null, 2) + "\n", "utf8");
    ok(`Registro criado em ${registryPath}`);
    return init;
  }
  try {
    return JSON.parse(fs.readFileSync(registryPath, "utf8"));
  } catch {
    warn("registry.json corrompido — recriando");
    const init = { version: 1, lastSeq: 0, snapshots: [] };
    fs.writeFileSync(registryPath, JSON.stringify(init, null, 2) + "\n", "utf8");
    return init;
  }
}

function scanMaxSeq(snapshotRoot, projectName) {
  let max = 0;

  const regPath = getRegistryPath(snapshotRoot);
  if (fs.existsSync(regPath)) {
    try {
      const reg = JSON.parse(fs.readFileSync(regPath, "utf8"));
      if (typeof reg.lastSeq === "number" && reg.lastSeq > max) {
        max = reg.lastSeq;
      }
      if (Array.isArray(reg.snapshots)) {
        for (const s of reg.snapshots) {
          if (typeof s.seq === "number" && s.seq > max) {
            max = s.seq;
          }
        }
      }
    } catch {}
  }

  if (fs.existsSync(snapshotRoot)) {
    const entries = fs.readdirSync(snapshotRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const subPath = path.join(snapshotRoot, entry.name);
      try {
        const subEntries = fs.readdirSync(subPath);
        for (const item of subEntries) {
          const stem = item.endsWith(".md") ? item.slice(0, -3) : item;
          const prefix = `${projectName}_`;
          if (stem.startsWith(prefix)) {
            const suffix = stem.slice(prefix.length);
            if (/^\d+\$/.test(suffix)) {
              const num = parseInt(suffix, 10);
              if (num > max) max = num;
            }
          }
        }
      } catch {}
    }
  }

  return max;
}

function recordSnapshot(registryPath, entry) {
  const reg = ensureRegistry(registryPath);
  reg.lastSeq = entry.seq;
  reg.snapshots.unshift(entry);
  fs.writeFileSync(registryPath, JSON.stringify(reg, null, 2) + "\n", "utf8");
}

function cmdHelp() {
  console.log(`
${B}snapshot.mjs${N} — cria snapshots numerados do projeto

${B}Uso:${N}
  node snapshot.mjs                 cria um snapshot
  node snapshot.mjs --list          lista todos os snapshots registrados
  node snapshot.mjs --help          mostra esta ajuda
  node snapshot.mjs --reset         apaga o registro
  node snapshot.mjs --repository    escolhe e salva um novo repositório

${B}Variáveis de ambiente:${N}
  PROJECT_NAME    nome do projeto (default: Projeto1)
  SNAPSHOT_ROOT   pasta raiz dos snapshots
`);
}

async function cmdReset(snapshotRoot) {
  const regPath = getRegistryPath(snapshotRoot);
  if (!fs.existsSync(regPath)) {
    warn(`Nenhum registro em ${regPath}`);
    return;
  }
  const ans = await prompt(`Apagar ${regPath}? [s/N] `);
  if (/^[sSyY]\$/.test(ans)) {
    fs.rmSync(regPath, { force: true });
    ok("Registro removido (os arquivos dos snapshots foram mantidos).");
  } else {
    note("Cancelado.");
  }
}

async function cmdRepository() {
  if (fs.existsSync(REPOSITORY_CONFIG)) {
    fs.rmSync(REPOSITORY_CONFIG, { force: true });
  }
  delete process.env.SNAPSHOT_ROOT;
  const root = await chooseSnapshotRoot();
  ok(`Novo repositório configurado: ${root}`);
}

function cmdList(snapshotRoot) {
  const regPath = getRegistryPath(snapshotRoot);
  if (!fs.existsSync(regPath)) {
    warn(`Nenhum registro encontrado em ${regPath}`);
    return;
  }
  const reg = ensureRegistry(regPath);
  const total = reg.lastSeq || 0;

  console.log(`\n${B}Snapshots Registrados (último seq = ${total})${N}\n`);
  console.log(
    "SEQ".padEnd(5) + "  " +
    "PROJETO".padEnd(18) + "  " +
    "TIMESTAMP".padEnd(20) + "  " +
    "ARQUIVOS".padEnd(9) + "  " +
    "TAMANHO".padEnd(10) + "  " +
    "MARKDOWN"
  );
  console.log(
    "-----".padEnd(5) + "  " +
    "------------------".padEnd(18) + "  " +
    "--------------------".padEnd(20) + "  " +
    "---------".padEnd(9) + "  " +
    "----------".padEnd(10) + "  " +
    "--------"
  );

  for (const s of reg.snapshots) {
    const sizeH = humanSize(s.sizeBytes);
    console.log(
      String(s.seq).padEnd(5) + "  " +
      String(s.project).padEnd(18) + "  " +
      String(s.timestamp).padEnd(20) + "  " +
      String(s.fileCount).padEnd(9) + "  " +
      sizeH.padEnd(10) + "  " +
      String(s.mdPath)
    );
  }
  console.log();
}

function scanDirectory(dir, baseDir = dir) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath);

    if (isExcluded(relPath)) continue;

    if (entry.isDirectory()) {
      results = results.concat(scanDirectory(fullPath, baseDir));
    } else if (entry.isFile()) {
      results.push(relPath);
    }
  }
  return results;
}

function copyProjectFiles(srcDir, destDir, files) {
  for (const file of files) {
    const srcFile = path.join(srcDir, file);
    const destFile = path.join(destDir, file);
    fs.mkdirSync(path.dirname(destFile), { recursive: true });
    fs.copyFileSync(srcFile, destFile);
  }
}

async function main() {
  const cliArgs = process.argv.slice(2);
  const arg = cliArgs;

  if (arg === "--help" || arg === "-h") {
    cmdHelp();
    return;
  }

  if (arg === "--repository" || arg === "--repo") {
    await cmdRepository();
    return;
  }

  const snapshotRoot = await loadSnapshotRoot();

  if (arg === "--list" || arg === "-l") {
    cmdList(snapshotRoot);
    return;
  }
  if (arg === "--reset") {
    await cmdReset(snapshotRoot);
    return;
  }
  if (arg && typeof arg === "string" && arg.startsWith("-")) {
    err(`Argumento desconhecido: ${arg}`);
    console.log("  Use --help para listar opções.");
    process.exit(1);
  }

  const cwd = process.cwd();
  let srcDir = cwd;
  if (!fs.existsSync(path.join(cwd, "package.json")) && fs.existsSync(path.join(cwd, PROJECT_NAME, "package.json"))) {
    srcDir = path.join(cwd, PROJECT_NAME);
  }

  const { ts, human, iso } = getTimestamps();
  const maxSeq = scanMaxSeq(snapshotRoot, PROJECT_NAME);
  const seqNum = maxSeq + 1;
  const seqStr = String(seqNum).padStart(3, "0");
  const projectLabel = `${PROJECT_NAME}_${seqStr}`;

  const destRoot = path.join(snapshotRoot, ts);
  const destProject = path.join(destRoot, projectLabel);
  const destMd = path.join(destRoot, `${projectLabel}.md`);

  const srcReal = fs.realpathSync(srcDir).toLowerCase();
  const destReal = path.resolve(destRoot).toLowerCase();
  if (destReal.startsWith(srcReal) && destReal !== srcReal) {
    err("SNAPSHOT_ROOT está dentro do diretório do projeto.");
    console.error(`  SNAPSHOT_ROOT: ${snapshotRoot}`);
    console.error(`  Projeto:       ${srcDir}`);
    process.exit(1);
  }

  fs.mkdirSync(destProject, { recursive: true });

  say(`Gerando Snapshot #${seqStr} do ${PROJECT_NAME}`);

  say(`1/2 — Copiando arquivos do projeto para ${destProject}`);
  const files = scanDirectory(srcDir).sort((a, b) => a.localeCompare(b, "en"));

  if (files.length === 0) {
    err("Nenhum arquivo encontrado para incluir no snapshot.");
    process.exit(1);
  }

  copyProjectFiles(srcDir, destProject, files);
  ok("Cópia de segurança concluída com sucesso.");

  say(`2/2 — Gerando documento consolidado: ${destMd}`);

  let mdContent = `# ${projectLabel}\n\n`;
  mdContent += `> **Snapshot:** #${seqStr}\n`;
  mdContent += `> **Projeto:** ${PROJECT_NAME}\n`;
  mdContent += `> **Gerado em:** ${human}\n`;
  mdContent += `> **Total de arquivos:** ${files.length}\n`;
  mdContent += `> **Origem:** Snapshot automático do projeto\n`;
  mdContent += `> **Formato:** Documento consolidado para auditoria e LLMs\n\n`;
  mdContent += `## 📑 Índice\n\n`;

  files.forEach((f, idx) => {
    const display = `${projectLabel}/${f.replaceAll(path.sep, "/")}`;
    const anchor = anchorFor(display);
    mdContent += `${idx + 1}. [${display}](#${anchor})\n`;
  });

  mdContent += `\n---\n\n`;

  for (const f of files) {
    const absPath = path.join(destProject, f);
    const display = `${projectLabel}/${f.replaceAll(path.sep, "/")}`;
    const baseName = path.basename(f);

    let ext = "";
    if (baseName.includes(".") && !baseName.startsWith(".")) {
      ext = baseName.split(".").pop();
    } else if (baseName.startsWith(".") && baseName.slice(1).includes(".")) {
      ext = baseName.split(".").pop();
    }

    const sizeBytes = fs.statSync(absPath).size;
    const sizeH = humanSize(sizeBytes);
    const lang = langFor(ext);
    const mime = mimeFor(ext);
    let rawText = "";

    try {
      rawText = fs.readFileSync(absPath, "utf8");
    } catch {
      rawText = "[Arquivo binário ou não legível como UTF-8]";
    }

    const fence = rawText.includes("```") ? "````" : "```";

    mdContent += `### ${display}\n\n`;
    mdContent += `*Extensão:* \`\${ext || "—"}\` · *Tamanho:* ${sizeH} · *Tipo:* ${mime}\n\n`;
    mdContent += `${fence}${lang}\n`;
    mdContent += rawText;
    if (!rawText.endsWith("\n")) mdContent += "\n";
    mdContent += `${fence}\n\n`;
    mdContent += `---\n\n`;
  }

  fs.writeFileSync(destMd, mdContent, "utf8");
  ok("Documento Markdown consolidado gerado.");

  const regPath = getRegistryPath(snapshotRoot);
  const mdSizeBytes = fs.statSync(destMd).size;
  const relProject = path.relative(snapshotRoot, destProject).replaceAll(path.sep, "/");
  const relMd = path.relative(snapshotRoot, destMd).replaceAll(path.sep, "/");

  recordSnapshot(regPath, {
    seq: seqNum,
    project: PROJECT_NAME,
    timestamp: ts,
    label: projectLabel,
    projectPath: relProject,
    mdPath: relMd,
    fileCount: files.length,
    sizeBytes: mdSizeBytes,
    createdAt: iso,
  });

  ok(`Registro de snapshots atualizado em ${regPath}`);

  console.log();
  ok(`Snapshot #${seqStr} criado com sucesso!`);
  console.log(`  Diretório raiz: ${destRoot}`);
  console.log(`  Pasta do código: ${destProject}`);
  console.log(`  Arquivo Markdown: ${destMd}`);
  console.log(`  Total de arquivos: ${files.length}`);
  console.log(`  Tamanho do Markdown: ${humanSize(mdSizeBytes)}`);
}

main().catch((e) => {
  err(e?.message || String(e));
  process.exit(1);
});