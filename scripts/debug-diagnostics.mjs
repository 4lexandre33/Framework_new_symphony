#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const logFile = path.join(process.cwd(), "debug-report.txt");
const output = [];

function log(msg) {
  console.log(msg);
  output.push(msg);
}

log("============================================================");
log(` DIAGNÓSTICO E AUDITORIA DE DEBUG - ${new Date().toISOString()}`);
log("============================================================\n");

try {
  log(`Node version: ${process.version}`);
  log(`Platform: ${process.platform} (${process.arch})`);
  log(`Cargo version: ${execSync("cargo --version").toString().trim()}`);
  log(`NPM version: ${execSync("npm --version").toString().trim()}`);
} catch (err) {
  log(`[ERRO AMBIENTE]: ${err.message}`);
}

log("\n--- Auditando src-tauri/Cargo.toml ---");
const cargoPath = path.join(process.cwd(), "src-tauri", "Cargo.toml");
if (fs.existsSync(cargoPath)) {
  const cargoContent = fs.readFileSync(cargoPath, "utf8");
  log(`Cargo.toml Encontrado (${cargoContent.length} bytes)`);
  if (!cargoContent.includes("[package]")) {
    log("[ERRO CRÍTICO]: Cargo.toml NÃO possui o bloco [package]!");
  } else {
    log("[OK]: Bloco [package] detectado em Cargo.toml");
  }
} else {
  log("[ERRO CRÍTICO]: src-tauri/Cargo.toml não encontrado!");
}

log("\n--- Auditando src-tauri/tauri.conf.json ---");
const tauriConfPath = path.join(process.cwd(), "src-tauri", "tauri.conf.json");
if (fs.existsSync(tauriConfPath)) {
  try {
    const confContent = fs.readFileSync(tauriConfPath, "utf8");
    const json = JSON.parse(confContent);
    log("[OK]: JSON de tauri.conf.json é válido");
    if (json.package !== undefined) {
      log("[ERRO SCHEMA]: tauri.conf.json possui a chave 'package' que é proibida no Tauri 2!");
    } else {
      log("[OK]: Nenhuma propriedade 'package' proibida encontrada no tauri.conf.json");
    }
    log(`ProductName: ${json.productName || "Não definido"}`);
    log(`Identifier: ${json.identifier || "Não definido"}`);
  } catch (err) {
    log(`[ERRO SINTAXE JSON]: ${err.message}`);
  }
} else {
  log("[ERRO CRÍTICO]: src-tauri/tauri.conf.json não encontrado!");
}

fs.writeFileSync(logFile, output.join("\n"), "utf8");
log("\n============================================================");
log(`Relatório de auditoria salvo em: ${logFile}`);
log("============================================================");