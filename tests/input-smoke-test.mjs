#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const failures = [];
const successes = [];

function checkFileExists(relPath) {
  const fullPath = path.join(ROOT_DIR, relPath);
  if (!fs.existsSync(fullPath)) {
    failures.push(`Arquivo essencial ausente: ${relPath}`);
    return false;
  }
  successes.push(`Arquivo encontrado: ${relPath}`);
  return true;
}

function checkFileContains(relPath, snippet, label) {
  const fullPath = path.join(ROOT_DIR, relPath);
  if (!fs.existsSync(fullPath)) return;
  const content = fs.readFileSync(fullPath, "utf8");
  if (!content.includes(snippet)) {
    failures.push(`O arquivo ${relPath} nao contem: '${label || snippet}'`);
  } else {
    successes.push(`Validado em ${relPath}: ${label || snippet}`);
  }
}

console.log("============================================================");
console.log("  Auditoria de Sanidade do Sistema de Input (Tauri 2)        ");
console.log("============================================================\n");

// 1. Arquivos da camada de Input
checkFileExists("src/contracts/input/types.ts");
checkFileExists("src/tokens/input.ts");
checkFileExists("src/engine/input/internal/KeyboardMouseDriver.ts");
checkFileExists("src/engine/input/internal/GamepadDriver.ts");
checkFileExists("src/engine/input/internal/InputManager.ts");
checkFileExists("src/plugins/input/plugin.ts");

// 2. Validação dos Contratos e Tipos
checkFileContains("src/contracts/input/types.ts", "InputDeviceType", "Tipo InputDeviceType");
checkFileContains("src/contracts/input/types.ts", "InputActionEvent", "Evento InputActionEvent");

// 3. Validação das Capabilities
checkFileContains("src/tokens/input.ts", "InputToken", "Capability Token InputToken");
checkFileContains("src/tokens/input.ts", "requestPointerLock", "Método requestPointerLock na interface InputApi");

// 4. Validação dos Drivers
checkFileContains("src/engine/input/internal/KeyboardMouseDriver.ts", "requestPointerLock", "Pointer Lock API no driver de mouse");
checkFileContains("src/engine/input/internal/GamepadDriver.ts", "deadzone", "Tratamento de Deadzone no Gamepad");
checkFileContains("src/engine/input/internal/InputManager.ts", "KeyboardMouseDriver", "Uso do driver de Teclado/Mouse no InputManager");
checkFileContains("src/engine/input/internal/InputManager.ts", "GamepadDriver", "Uso do driver de Gamepad no InputManager");

// 5. Validação do Plugin Bridge
checkFileContains("src/plugins/input/plugin.ts", "InputToken", "Injeção da capability InputToken no plugin");

console.log("\n--- Resultados ---");
for (const ok of successes) {
  console.log(`\x1b[32m[OK]\x1b[0m ${ok}`);
}

if (failures.length > 0) {
  console.log("\n--- Erros Encontrados ---");
  for (const err of failures) {
    console.log(`\x1b[31m[ERRO]\x1b[0m ${err}`);
  }
  console.log("\n\x1b[31mA camada de Input precisa de ajustes antes do congelamento.\x1b[0m");
  process.exit(1);
} else {
  console.log("\n\x1b[32mTodos os requisitos da Camada de Input foram validados com sucesso!\x1b[0m\n");
}