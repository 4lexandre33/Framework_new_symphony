import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const HUD_PATH = "src/debug/hud/HudRenderer.ts";
const fullPath = path.join(ROOT_DIR, HUD_PATH);

const failures = [];
const successes = [];

function ok(condition, success, failure) {
  if (condition) {
    successes.push(success);
  } else {
    failures.push(failure);
  }
}

if (!fs.existsSync(fullPath)) {
  console.error(`[ERRO] Arquivo ausente: ${HUD_PATH}`);
  process.exit(1);
}

const content = fs.readFileSync(fullPath, "utf8").replace(/\r\n/g, "\n");

ok(
  !content.includes("\\${"),
  "nenhuma interpolação ${...} está escapada",
  "ainda existe interpolação escapada \\${...}",
);

ok(
  !/\\[()]\{/.test(content),
  "nenhum placeholder corrompido \\({ / \\){ permanece",
  "ainda existe placeholder corrompido do snapshot",
);

ok(
  content.includes('`[HUD Audio] Master: ${(master * 100).toFixed(0)}%`'),
  "valor de áudio é interpolado de verdade",
  "HUD de áudio não interpola o volume real",
);

ok(
  content.includes("DIAGNOSTIC_REFRESH_INTERVAL_MS"),
  "diagnósticos pesados possuem cadência limitada",
  "diagnósticos ainda podem ser executados sem limitação de frequência",
);

ok(
  content.includes("logDiagnosticIfChanged"),
  "logs de subsistemas são deduplicados",
  "HUD ainda pode inundar o DOM com logs repetidos",
);

const renderFrameStart = content.indexOf("private readonly renderFrame");
const inputUpdate = content.indexOf("this.updateInputHud();", renderFrameStart);
const diagnosticGate = content.indexOf(
  "now - this.lastDiagnosticRefreshMs >= DIAGNOSTIC_REFRESH_INTERVAL_MS",
  renderFrameStart,
);

ok(
  renderFrameStart >= 0 &&
    inputUpdate > renderFrameStart &&
    diagnosticGate > inputUpdate,
  "InputApi.update continua no caminho por-frame antes do throttle de diagnóstico",
  "o throttle pode ter reduzido inadvertidamente a frequência do Input",
);

ok(
  content.includes("${getErrorMessage(error)}"),
  "mensagens de erro usam getErrorMessage de verdade",
  "getErrorMessage continua preso em string literal",
);

console.log("============================================================");
console.log("  Smoke Test: HudRenderer                                    ");
console.log("============================================================\n");

for (const success of successes) {
  console.log(`[OK] ${success}`);
}

if (failures.length > 0) {
  console.log("\n--- Falhas ---");
  for (const failure of failures) {
    console.log(`[ERRO] ${failure}`);
  }
  process.exit(1);
}

console.log("\n✅ HudRenderer sem placeholders escapados e sem spam por-frame.");
