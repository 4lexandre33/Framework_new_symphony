#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();

const TARGETS = Object.freeze([
  "scripts/architecture/stage43-integrate-development-guardrails.mjs",
  "scripts/architecture/stage43-repair-postmigration-command.mjs",
]);

const REQUIRED_PACKAGE_SCRIPTS = Object.freeze({
  "arch:audit": "node agents.mjs",
  "arch:check":
    "node scripts/architecture/check-boundaries.mjs && node scripts/architecture/check-dependencies.mjs",
  "arch:dependencies":
    "node scripts/architecture/check-dependencies.mjs",
  "arch:migrate":
    "node scripts/architecture/stage43-migration-status.mjs",
  build:
    "npm run arch:check && tsc && vite build",
});

function fail(message) {
  throw new Error(message);
}

function abs(relativePath) {
  return path.join(ROOT, ...relativePath.split("/"));
}

function parseMode(argv) {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === "--check")) {
    return "check";
  }

  if (argv.length === 1 && argv[0] === "--apply") {
    return "apply";
  }

  fail(
    "uso: node scripts/architecture/stage43-repair-windows-npm-runner.mjs --check|--apply",
  );
}

function ensureFile(relativePath) {
  const full = abs(relativePath);

  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    fail(`arquivo obrigatório ausente: ${relativePath}`);
  }
}

function readPackage() {
  try {
    return JSON.parse(fs.readFileSync(abs("package.json"), "utf8"));
  } catch (error) {
    fail(
      `package.json inválido: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function atomicWrite(relativePath, text) {
  const full = abs(relativePath);
  const temp = `${full}.stage43-v3-${process.pid}.tmp`;

  fs.writeFileSync(temp, text, "utf8");
  fs.renameSync(temp, full);
}

function windowsRunnerFunction() {
  return `function runNpm(scriptName, labelOrMarkers = [], maybeMarkers = []) {
  const label =
    typeof labelOrMarkers === "string"
      ? labelOrMarkers
      : \`npm run \${scriptName}\`;

  const markers =
    Array.isArray(labelOrMarkers)
      ? labelOrMarkers
      : maybeMarkers;

  let result;

  if (process.platform === "win32") {
    const commandProcessor =
      process.env.ComSpec ??
      process.env.COMSPEC ??
      "C:\\\\Windows\\\\System32\\\\cmd.exe";

    result = spawnSync(
      commandProcessor,
      ["/d", "/s", "/c", \`npm run \${scriptName}\`],
      {
        cwd: ROOT,
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } else {
    result = spawnSync(
      "npm",
      ["run", scriptName],
      {
        cwd: ROOT,
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  }

  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");

  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    fail(\`\${label} falhou com código \${String(result.status)}.\`);
  }

  for (const marker of markers) {
    if (!stdout.includes(marker)) {
      fail(\`\${label} sem marcador esperado: \${marker}\`);
    }
  }

  console.log(\`[OK] \${label}\`);
  return { stdout, stderr };
}`;
}

function patchFunction(source, target) {
  const start = source.indexOf("function runNpm(");

  if (start < 0) {
    fail(`${target}: função runNpm não encontrada.`);
  }

  const braceStart = source.indexOf("{", start);

  if (braceStart < 0) {
    fail(`${target}: início da função runNpm inválido.`);
  }

  let depth = 0;
  let end = -1;
  let inString = null;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1] ?? "";

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (inString !== null) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === "\\") {
        escaped = true;
        continue;
      }

      if (ch === inString) {
        inString = null;
      }
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }

    if (ch === "{") {
      depth += 1;
      continue;
    }

    if (ch === "}") {
      depth -= 1;

      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }

  if (end < 0) {
    fail(`${target}: não foi possível localizar o fim de runNpm.`);
  }

  const replacement = windowsRunnerFunction();

  return (
    source.slice(0, start) +
    replacement +
    source.slice(end)
  );
}

function runNode(args, label, markers = []) {
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });

  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");

  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  if (result.error) throw result.error;

  if (result.status !== 0) {
    fail(`${label} falhou com código ${String(result.status)}.`);
  }

  for (const marker of markers) {
    if (!stdout.includes(marker)) {
      fail(`${label} sem marcador esperado: ${marker}`);
    }
  }

  console.log(`[OK] ${label}`);
}

function runNpmPortable(scriptName, markers = []) {
  let result;

  if (process.platform === "win32") {
    const commandProcessor =
      process.env.ComSpec ??
      process.env.COMSPEC ??
      "C:\\Windows\\System32\\cmd.exe";

    result = spawnSync(
      commandProcessor,
      ["/d", "/s", "/c", `npm run ${scriptName}`],
      {
        cwd: ROOT,
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } else {
    result = spawnSync(
      "npm",
      ["run", scriptName],
      {
        cwd: ROOT,
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  }

  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");

  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    fail(`npm run ${scriptName} falhou com código ${String(result.status)}.`);
  }

  for (const marker of markers) {
    if (!stdout.includes(marker)) {
      fail(`npm run ${scriptName} sem marcador esperado: ${marker}`);
    }
  }

  console.log(`[OK] npm run ${scriptName}`);
}

function assertPackageScripts() {
  const packageJson = readPackage();

  if (
    packageJson.scripts === null ||
    typeof packageJson.scripts !== "object" ||
    Array.isArray(packageJson.scripts)
  ) {
    fail("package.json.scripts inválido.");
  }

  for (const [name, expected] of Object.entries(REQUIRED_PACKAGE_SCRIPTS)) {
    if (packageJson.scripts[name] !== expected) {
      fail(
        `package.json scripts.${name} inesperado.\n` +
        `Atual: ${String(packageJson.scripts[name])}\n` +
        `Esperado: ${expected}`,
      );
    }
  }
}

function assertAgentsIntegration() {
  const agents = fs.readFileSync(abs("agents.mjs"), "utf8");

  const required = [
    'runNode("tests/freeze-invariants.mjs");',
    'runNode("tests/freeze-lock.mjs");',
    'runNode("scripts/architecture/check-boundaries.mjs");',
    'runNode("scripts/architecture/check-dependencies.mjs");',
    'runNode("tests/freeze-lock.mjs", ["--lock"]);',
    'runNode("tests/freeze-lock.mjs", ["--unlock"]);',
  ];

  for (const snippet of required) {
    if (!agents.includes(snippet)) {
      fail(`agents.mjs perdeu integração obrigatória: ${snippet}`);
    }
  }
}

function main() {
  const mode = parseMode(process.argv.slice(2));

  try {
    ensureFile("package.json");
    ensureFile("agents.mjs");
    ensureFile("scripts/architecture/stage43-migration-status.mjs");

    for (const target of TARGETS) {
      ensureFile(target);
    }

    assertPackageScripts();
    assertAgentsIntegration();

    console.log("============================================================");
    console.log("  PROJETO1 — ETAPA 43 v3: RUNNER NPM WINDOWS");
    console.log("============================================================");
    console.log(`Modo: ${mode.toUpperCase()}`);

    const pending = [];

    for (const target of TARGETS) {
      const source = fs.readFileSync(abs(target), "utf8");

      const hasCmdPortable =
        source.includes('process.env.ComSpec') &&
        source.includes('["/d", "/s", "/c", `npm run ${scriptName}`]');

      const hasShellTrue =
        /shell\s*:\s*true/u.test(source);

      const hasNpmCmd =
        source.includes('"npm.cmd"');

      if (!hasCmdPortable || hasShellTrue || hasNpmCmd) {
        pending.push(target);
        console.log(`[PENDENTE] ${target}`);
      } else {
        console.log(`[OK] ${target}`);
      }
    }

    console.log("");
    console.log(`Pendências: ${pending.length}`);

    if (mode === "check") {
      console.log("");
      console.log("ETAPA 43 v3: CHECK PASS");
      console.log("[OK] Nenhum arquivo foi alterado.");
      return;
    }

    for (const target of pending) {
      const source = fs.readFileSync(abs(target), "utf8");
      const next = patchFunction(source, target);

      if (/shell\s*:\s*true/u.test(next)) {
        fail(`${target}: shell:true ainda presente após patch.`);
      }

      if (next.includes('"npm.cmd"')) {
        fail(`${target}: npm.cmd direto ainda presente após patch.`);
      }

      atomicWrite(target, next);
      console.log(`[OK] patched ${target}`);
    }

    console.log("");
    console.log("=== VALIDAÇÃO STATUS v20 ===");

    runNode(
      ["scripts/architecture/stage43-migration-status.mjs"],
      "migration status",
      ["MIGRATION STATUS: PASS"],
    );

    console.log("");
    console.log("=== VALIDAÇÃO NPM PORTÁVEL ===");

    runNpmPortable(
      "arch:migrate",
      ["MIGRATION STATUS: PASS"],
    );

    runNpmPortable(
      "arch:check",
      [
        "Violações de boundary: 0",
        "Violações do grafo: 0",
      ],
    );

    runNpmPortable(
      "arch:dependencies",
      ["Violações do grafo: 0"],
    );

    runNpmPortable(
      "arch:audit",
      [
        "PRONTO PARA DESENVOLVIMENTO",
        "Violações de boundary: 0",
        "Violações do grafo: 0",
      ],
    );

    runNpmPortable(
      "build",
      [
        "Violações de boundary: 0",
        "Violações do grafo: 0",
      ],
    );

    assertPackageScripts();
    assertAgentsIntegration();

    console.log("");
    console.log("============================================================");
    console.log("  ETAPA 43: PASS");
    console.log("============================================================");
    console.log("[OK] arch:migrate = status pós-migração v20 read-only.");
    console.log("[OK] arch:check passou.");
    console.log("[OK] arch:dependencies passou.");
    console.log("[OK] arch:audit passou.");
    console.log("[OK] build passou com arch:check primeiro.");
    console.log("[OK] agents.mjs preserva freeze + boundaries + dependencies.");
    console.log("[OK] --lock/--unlock preservados.");
    console.log("[OK] runner Windows usa cmd.exe explicitamente.");
    console.log("[OK] shell:true removido da Etapa 43.");
    console.log("[OK] npm.cmd não é spawnado diretamente.");
  } catch (error) {
    console.error("");
    console.error("============================================================");
    console.error("  ETAPA 43 v3: REPROVADA");
    console.error("============================================================");
    console.error(
      error instanceof Error
        ? error.stack ?? error.message
        : String(error),
    );
    process.exitCode = 1;
  }
}

main();
