#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const TESTS_DIR = path.join(process.cwd(), "tests");
if (!fs.existsSync(TESTS_DIR)) {
  fs.mkdirSync(TESTS_DIR, { recursive: true });
}

function createSafeLogStream() {
  const primaryPath = path.join(TESTS_DIR, "debug-execution.log");
  const fallbackPath = path.join(TESTS_DIR, `debug-execution-${Date.now()}.log`);

  let stream = fs.createWriteStream(primaryPath, { flags: "w" });

  // Captura erros assíncronos do arquivo bloqueado (EBUSY / EPERM) para evitar crashes do Node.js
  stream.on("error", (err) => {
    if (err.code === "EBUSY" || err.code === "EPERM") {
      console.warn(`\n[AVISO]: O arquivo 'debug-execution.log' esta bloqueado por outro programa.`);
      console.warn(`[AVISO]: Alternando automaticamente para log secundario: '${fallbackPath}'\n`);
      stream = fs.createWriteStream(fallbackPath, { flags: "w" });
      stream.on("error", (fallbackErr) => {
        console.error(`[ERRO LOG]: Falha ao gravar log secundario: ${fallbackErr.message}`);
      });
    } else {
      console.error(`[ERRO LOG]: ${err.message}`);
    }
  });

  return stream;
}

console.log("============================================================");
console.log("  Iniciando Tauri Dev com Espelhamento de Log em Tempo Real  ");
console.log("============================================================\n");

const logStream = createSafeLogStream();

const isWin = process.platform === "win32";
const command = isWin ? "npx.cmd" : "npx";
const args = ["tauri", "dev"];

const child = spawn(command, args, {
  shell: true,
  env: {
    ...process.env,
    RUST_BACKTRACE: "1",
    RUST_LOG: "debug",
    TAURI_DEBUG: "true",
  },
  stdio: ["inherit", "pipe", "pipe"],
});

child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  if (logStream && logStream.writable) {
    try {
      logStream.write(chunk);
    } catch {
      // Ignora falhas de escrita se a stream estiver fechando
    }
  }
});

child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
  if (logStream && logStream.writable) {
    try {
      logStream.write(chunk);
    } catch {
      // Ignora falhas de escrita se a stream estiver fechando
    }
  }
});

child.on("error", (err) => {
  console.error(`[ERRO PROCESSO]: ${err.message}`);
  if (logStream && logStream.writable) {
    logStream.write(`\n[ERRO PROCESSO]: ${err.message}\n`);
    logStream.end();
  }
  process.exit(1);
});

child.on("close", (code) => {
  if (logStream && logStream.writable) {
    logStream.end();
  }
  process.exit(code ?? 0);
});