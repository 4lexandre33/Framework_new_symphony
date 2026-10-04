#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const STAGE43_MAIN =
  "scripts/architecture/stage43-integrate-development-guardrails.mjs";
const STAGE43_REPAIR =
  "scripts/architecture/stage43-repair-postmigration-command.mjs";
const MIGRATION_STATUS =
  "scripts/architecture/stage43-migration-status.mjs";
const OUTPUT_ROOT = ".migration/stage43";

const EXPECTED_SCRIPTS = Object.freeze({
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

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function ensureFile(relativePath) {
  const full = abs(relativePath);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    fail(`arquivo obrigatório ausente: ${relativePath}`);
  }
}

function parseMode(argv) {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === "--check")) {
    return "check";
  }

  if (argv.length === 1 && argv[0] === "--apply") {
    return "apply";
  }

  fail(
    "uso: node scripts/architecture/stage43-finalize-windows-runner-v4.mjs --check|--apply",
  );
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
  fs.mkdirSync(path.dirname(full), { recursive: true });

  const temp = `${full}.stage43-v4-${process.pid}.tmp`;
  fs.writeFileSync(temp, text, "utf8");
  fs.renameSync(temp, full);
}

function findFunctionRange(source, functionName) {
  const marker = `function ${functionName}(`;
  const start = source.indexOf(marker);

  if (start < 0) {
    fail(`função ${functionName} não encontrada.`);
  }

  const braceStart = source.indexOf("{", start);
  if (braceStart < 0) {
    fail(`função ${functionName}: abertura inválida.`);
  }

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1] ?? "";

    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }

    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i += 1;
      }
      continue;
    }

    if (quote !== null) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === "\\") {
        escaped = true;
        continue;
      }

      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === "/" && next === "/") {
      lineComment = true;
      i += 1;
      continue;
    }

    if (ch === "/" && next === "*") {
      blockComment = true;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }

    if (ch === "{") {
      depth += 1;
      continue;
    }

    if (ch === "}") {
      depth -= 1;

      if (depth === 0) {
        return {
          start,
          end: i + 1,
          text: source.slice(start, i + 1),
        };
      }
    }
  }

  fail(`função ${functionName}: fechamento não encontrado.`);
}

function portableRunNpmFunction() {
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

function isPortableRunNpm(functionText) {
  return (
    functionText.includes("process.env.ComSpec") &&
    functionText.includes(
      '["/d", "/s", "/c", `npm run ${scriptName}`]',
    ) &&
    !functionText.includes('"npm.cmd"') &&
    !/\bshell\s*:/u.test(functionText)
  );
}

function patchRunNpm(source) {
  const range = findFunctionRange(source, "runNpm");

  if (isPortableRunNpm(range.text)) {
    return source;
  }

  return (
    source.slice(0, range.start) +
    portableRunNpmFunction() +
    source.slice(range.end)
  );
}

function patchGenericRunShell(source) {
  return source.replace(
    /^\s*shell:\s*process\.platform\s*===\s*"win32",\s*\r?\n/mu,
    "",
  );
}

function patchMisleadingLog(source) {
  return source.replace(
    'console.log("[OK] shell:true não é usado neste reparo.");',
    'console.log("[OK] subprocessos npm não usam shell:true implícito.");',
  );
}

function assertPackageScripts(packageJson) {
  const scripts = packageJson.scripts;

  if (
    scripts === null ||
    typeof scripts !== "object" ||
    Array.isArray(scripts)
  ) {
    fail("package.json.scripts inválido.");
  }

  for (const [name, expected] of Object.entries(EXPECTED_SCRIPTS)) {
    if (scripts[name] !== expected) {
      fail(
        `scripts.${name} inesperado.\nAtual: ${String(scripts[name])}\nEsperado: ${expected}`,
      );
    }
  }
}

function assertAgents() {
  const source = fs.readFileSync(abs("agents.mjs"), "utf8");

  const required = [
    'runNode("tests/freeze-invariants.mjs");',
    'runNode("tests/freeze-lock.mjs");',
    'runNode("scripts/architecture/check-boundaries.mjs");',
    'runNode("scripts/architecture/check-dependencies.mjs");',
    'runNode("tests/freeze-lock.mjs", ["--lock"]);',
    'runNode("tests/freeze-lock.mjs", ["--unlock"]);',
  ];

  for (const snippet of required) {
    if (!source.includes(snippet)) {
      fail(`agents.mjs sem integração obrigatória: ${snippet}`);
    }
  }
}

function patchPackageIfHistorical(packageJson) {
  const current = packageJson.scripts?.["arch:migrate"];
  const expected = EXPECTED_SCRIPTS["arch:migrate"];

  if (current === expected) {
    return {
      changed: false,
      packageJson,
    };
  }

  if (
    current !==
    "node scripts/architecture/migrate-v20.mjs --dry-run"
  ) {
    fail(
      `scripts.arch:migrate está em estado inesperado: ${String(current)}`,
    );
  }

  const next = structuredClone(packageJson);
  next.scripts["arch:migrate"] = expected;

  return {
    changed: true,
    packageJson: next,
  };
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
  return { stdout, stderr };
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

  if (result.error) throw result.error;

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

function timestampFolder() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function main() {
  const mode = parseMode(process.argv.slice(2));

  try {
    ensureFile("package.json");
    ensureFile("agents.mjs");
    ensureFile(STAGE43_MAIN);
    ensureFile(STAGE43_REPAIR);
    ensureFile(MIGRATION_STATUS);
    ensureFile("scripts/architecture/check-boundaries.mjs");
    ensureFile("scripts/architecture/check-dependencies.mjs");
    ensureFile(".freeze-lock.json");

    console.log("============================================================");
    console.log("  PROJETO1 — ETAPA 43 v4: FINALIZAÇÃO WINDOWS");
    console.log("============================================================");
    console.log(`Modo: ${mode.toUpperCase()}`);

    const originalPackage = readPackage();
    const packagePatch = patchPackageIfHistorical(originalPackage);

    const originalMain = fs.readFileSync(abs(STAGE43_MAIN), "utf8");
    const originalRepair = fs.readFileSync(abs(STAGE43_REPAIR), "utf8");

    const nextMain =
      patchGenericRunShell(
        patchRunNpm(originalMain),
      );

    const nextRepair =
      patchMisleadingLog(
        patchRunNpm(originalRepair),
      );

    const mainPending = nextMain !== originalMain;
    const repairPending = nextRepair !== originalRepair;

    console.log("");
    console.log("=== PENDÊNCIAS ===");
    console.log(
      `[${packagePatch.changed ? "PENDENTE" : "OK"}] package.json arch:migrate`,
    );
    console.log(
      `[${mainPending ? "PENDENTE" : "OK"}] ${STAGE43_MAIN}`,
    );
    console.log(
      `[${repairPending ? "PENDENTE" : "OK"}] ${STAGE43_REPAIR}`,
    );

    const totalPending =
      Number(packagePatch.changed) +
      Number(mainPending) +
      Number(repairPending);

    console.log(`Pendências: ${totalPending}`);

    if (mode === "check") {
      console.log("");
      console.log("============================================================");
      console.log("  ETAPA 43 v4: CHECK PASS");
      console.log("============================================================");
      console.log("[OK] Nenhum arquivo foi alterado.");
      return;
    }

    console.log("");
    console.log("=== APPLY IDEMPOTENTE ===");

    if (packagePatch.changed) {
      atomicWrite(
        "package.json",
        JSON.stringify(packagePatch.packageJson, null, 2) + "\n",
      );
      console.log("[OK] package.json");
    }

    if (mainPending) {
      atomicWrite(STAGE43_MAIN, nextMain);
      console.log(`[OK] ${STAGE43_MAIN}`);
    }

    if (repairPending) {
      atomicWrite(STAGE43_REPAIR, nextRepair);
      console.log(`[OK] ${STAGE43_REPAIR}`);
    }

    const finalPackage = readPackage();
    assertPackageScripts(finalPackage);
    assertAgents();

    const finalMain = fs.readFileSync(abs(STAGE43_MAIN), "utf8");
    const finalRepair = fs.readFileSync(abs(STAGE43_REPAIR), "utf8");

    const mainRunNpm = findFunctionRange(finalMain, "runNpm").text;
    const repairRunNpm = findFunctionRange(finalRepair, "runNpm").text;

    if (!isPortableRunNpm(mainRunNpm)) {
      fail("runNpm do integrador principal ainda não é portátil.");
    }

    if (!isPortableRunNpm(repairRunNpm)) {
      fail("runNpm do reparo pós-migração ainda não é portátil.");
    }

    if (
      finalMain.includes(
        'shell: process.platform === "win32"',
      )
    ) {
      fail("helper genérico do integrador ainda contém shell dinâmico.");
    }

    console.log("[OK] runners Windows validados estruturalmente.");

    console.log("");
    console.log("=== STATUS PÓS-MIGRAÇÃO ===");

    runNode(
      [MIGRATION_STATUS],
      "migration status",
      ["MIGRATION STATUS: PASS"],
    );

    console.log("");
    console.log("=== NPM GUARDRAILS ===");

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

    console.log("");
    console.log("=== BUILD PROTEGIDO ===");

    runNpmPortable(
      "build",
      [
        "Violações de boundary: 0",
        "Violações do grafo: 0",
      ],
    );

    const runId = timestampFolder();
    const outputDir = `${OUTPUT_ROOT}/${runId}`;

    const evidence = {
      schemaVersion: 1,
      stage: "stage-43-permanent-architecture-integration",
      architectureMigrationVersion: "v20",
      status: "completed",
      completedAtUtc: new Date().toISOString(),
      npmScripts: EXPECTED_SCRIPTS,
      validation: {
        migrationStatus: "pass",
        archMigrate: "pass-read-only-postmigration-status",
        archCheck: "pass",
        archDependencies: "pass",
        archAudit: "pass",
        build: "pass",
      },
      windowsRunner: {
        strategy: "cmd.exe /d /s /c",
        directNpmCmdSpawn: false,
        shellOption: false,
      },
      agents: {
        freezeInvariants: true,
        freezeLock: true,
        boundaries: true,
        dependencies: true,
        lockPreserved: true,
        unlockPreserved: true,
      },
      hashes: {
        packageJson: sha256(
          fs.readFileSync(abs("package.json")),
        ),
        agents: sha256(
          fs.readFileSync(abs("agents.mjs")),
        ),
        stage43Main: sha256(
          fs.readFileSync(abs(STAGE43_MAIN)),
        ),
        migrationStatus: sha256(
          fs.readFileSync(abs(MIGRATION_STATUS)),
        ),
      },
      pendingBlockingItems: [],
      nextStage: 44,
    };

    const report = [
      "# Stage 43 — Permanent Architecture Integration",
      "",
      "**ETAPA 43: PASS**",
      "",
      "## Permanent npm integration",
      "",
      ...Object.entries(EXPECTED_SCRIPTS).map(
        ([name, command]) => `- \`${name}\`: \`${command}\``,
      ),
      "",
      "## agents.mjs",
      "",
      "- freeze invariants: PASS",
      "- freeze lock: PASS",
      "- boundary checker: PASS",
      "- dependency graph: PASS",
      "- `--lock`: preserved",
      "- `--unlock`: preserved",
      "",
      "## Windows process execution",
      "",
      "- npm scripts use explicit `cmd.exe /d /s /c` on Windows.",
      "- direct `spawnSync(\"npm.cmd\", ...)` is not used.",
      "- `shell:true` is not required.",
      "",
      "## Validation",
      "",
      "- migration status v20: PASS",
      "- `npm run arch:migrate`: PASS, read-only",
      "- `npm run arch:check`: PASS",
      "- `npm run arch:dependencies`: PASS",
      "- `npm run arch:audit`: PASS",
      "- `npm run build`: PASS",
      "",
      "No blocking item remains in Stage 43.",
      "",
    ].join("\n");

    atomicWrite(
      `${outputDir}/stage43-evidence.json`,
      JSON.stringify(evidence, null, 2) + "\n",
    );

    atomicWrite(
      `${outputDir}/stage43-report.md`,
      report,
    );

    atomicWrite(
      `${outputDir}/artifact-checksums.sha256`,
      [
        `${sha256(Buffer.from(JSON.stringify(evidence, null, 2) + "\n", "utf8"))}  stage43-evidence.json`,
        `${sha256(Buffer.from(report, "utf8"))}  stage43-report.md`,
        "",
      ].join("\n"),
    );

    console.log("");
    console.log("============================================================");
    console.log("  ETAPA 43: PASS");
    console.log("============================================================");
    console.log("[OK] arch:audit instalado e validado.");
    console.log("[OK] arch:check instalado e validado.");
    console.log("[OK] arch:dependencies instalado e validado.");
    console.log("[OK] arch:migrate é status pós-migração v20 read-only.");
    console.log("[OK] build depende de arch:check e passou.");
    console.log("[OK] agents.mjs fiscaliza freeze + boundaries + dependencies.");
    console.log("[OK] --lock/--unlock preservados.");
    console.log("[OK] runner Windows usa cmd.exe explicitamente.");
    console.log("[OK] falso positivo de shell:true eliminado.");
    console.log(`[OK] Evidência: ${outputDir}/stage43-evidence.json`);
    console.log(`[OK] Relatório: ${outputDir}/stage43-report.md`);
    console.log("[INFO] Etapa 44 pode iniciar.");
  } catch (error) {
    console.error("");
    console.error("============================================================");
    console.error("  ETAPA 43 v4: REPROVADA");
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
