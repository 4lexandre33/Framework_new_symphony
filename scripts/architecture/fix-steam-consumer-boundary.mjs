import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();
const TARGET = "src/engine/net/internal/SteamP2PTransport.ts";
const PUBLIC_FACADE = "src/engine/steam/public/index.ts";
const BACKUP_DIR = ".migration/fixes/steam-consumer-boundary";
const BACKUP = `${BACKUP_DIR}/SteamP2PTransport.before.ts`;
const REPORT = `${BACKUP_DIR}/report.json`;

function fail(message) {
  console.error(`[ERRO] ${message}`);
  process.exitCode = 1;
  return false;
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function writeAtomic(rel, content) {
  const abs = path.join(ROOT, rel);
  const dir = path.dirname(abs);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, abs);
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function normalizeEol(text) {
  return text.replace(/\r\n/g, "\n");
}

function restore(original) {
  writeAtomic(TARGET, original);
}

function main() {
  console.log("============================================================");
  console.log("  PROJETO1 — CORREÇÃO: CONSUMIDOR STEAM VIA PUBLIC FACADE");
  console.log("============================================================\n");

  if (!exists("package.json")) return fail("Execute na raiz do Projeto1.");
  if (!exists(TARGET)) return fail(`Arquivo ausente: ${TARGET}`);
  if (!exists(PUBLIC_FACADE)) return fail(`Fachada pública ausente: ${PUBLIC_FACADE}`);

  const facade = normalizeEol(read(PUBLIC_FACADE));
  if (!facade.includes('export * from "../../../tokens/steam";')) {
    return fail("A fachada Steam não reexporta o contrato/token SteamApi esperado.");
  }

  const original = read(TARGET);
  const normalized = normalizeEol(original);

  const legacySteamApi = /import type\s*\{\s*SteamApi,\s*\}\s*from\s*["']\.\.\/\.\.\/\.\.\/tokens\/steam["'];/m;
  const legacyP2PSendType = /import type\s*\{\s*P2PSendType,\s*\}\s*from\s*["']\.\.\/\.\.\/\.\.\/contracts\/steam\/net-types["'];/m;
  const publicCombined = /import type\s*\{\s*(?:P2PSendType,\s*SteamApi|SteamApi,\s*P2PSendType),?\s*\}\s*from\s*["']\.\.\/\.\.\/steam\/public["'];/m;

  if (publicCombined.test(normalized) &&
      !normalized.includes('../../../tokens/steam') &&
      !normalized.includes('../../../contracts/steam/net-types')) {
    console.log("[OK] Correção já aplicada; execução idempotente.");
    console.log("[OK] SteamP2PTransport consome somente ../../steam/public.");
    return;
  }

  if (!legacySteamApi.test(normalized)) {
    return fail("Import legado de SteamApi não corresponde ao estado esperado; nada foi alterado.");
  }
  if (!legacyP2PSendType.test(normalized)) {
    return fail("Import legado de P2PSendType não corresponde ao estado esperado; nada foi alterado.");
  }

  let updated = normalized.replace(
    legacySteamApi,
    'import type {\n  P2PSendType,\n  SteamApi,\n} from "../../steam/public";'
  );
  updated = updated.replace(legacyP2PSendType, "");

  // Preserve CRLF if the source used it.
  if (original.includes("\r\n")) {
    updated = updated.replace(/\n/g, "\r\n");
  }

  if (updated.includes('../../../tokens/steam') ||
      updated.includes('../../../contracts/steam/net-types')) {
    return fail("Validação pré-write falhou: referências Steam legadas permaneceriam.");
  }

  const beforeSha = sha256(original);
  const afterSha = sha256(updated);

  fs.mkdirSync(path.join(ROOT, BACKUP_DIR), { recursive: true });
  if (!exists(BACKUP)) {
    writeAtomic(BACKUP, original);
  } else if (read(BACKUP) !== original) {
    return fail(`Backup já existe e não corresponde ao estado atual: ${BACKUP}`);
  }

  try {
    writeAtomic(TARGET, updated);
    const persisted = read(TARGET);

    if (sha256(persisted) !== afterSha) {
      throw new Error("SHA-256 pós-write divergente.");
    }
    const check = normalizeEol(persisted);
    if (!publicCombined.test(check)) {
      throw new Error("Import público Steam não foi encontrado após a escrita.");
    }
    if (check.includes('../../../tokens/steam') ||
        check.includes('../../../contracts/steam/net-types')) {
      throw new Error("Referência Steam legada permaneceu após a escrita.");
    }

    const report = {
      schemaVersion: 1,
      kind: "typed-boundary-fix",
      target: TARGET,
      publicFacade: PUBLIC_FACADE,
      beforeSha256: beforeSha,
      afterSha256: afterSha,
      changes: [
        {
          from: "../../../tokens/steam",
          to: "../../steam/public",
          symbols: ["SteamApi"]
        },
        {
          from: "../../../contracts/steam/net-types",
          to: "../../steam/public",
          symbols: ["P2PSendType"]
        }
      ]
    };
    writeAtomic(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    restore(original);
    return fail(`Transação revertida: ${error instanceof Error ? error.message : String(error)}`);
  }

  console.log(`[OK] Alterado: ${TARGET}`);
  console.log("[OK] SteamApi e P2PSendType agora entram por src/engine/steam/public.");
  console.log("[OK] Nenhum import de src/engine/steam/internal foi criado.");
  console.log(`[OK] Backup: ${BACKUP}`);
  console.log(`[OK] Relatório: ${REPORT}`);
  console.log(`[OK] SHA antes:  ${beforeSha}`);
  console.log(`[OK] SHA depois: ${afterSha}`);
  console.log("\nPróxima validação:");
  console.log("  npx tsc --noEmit");
}

main();
