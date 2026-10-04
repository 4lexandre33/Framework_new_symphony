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
console.log("  Auditoria de Sanidade do Pipeline de Assets (Tauri 2)     ");
console.log("============================================================\n");

// 1. Arquivos da camada de Assets
checkFileExists("src/contracts/assets/types.ts");
checkFileExists("src/tokens/assets.ts");
checkFileExists("src/engine/assets/internal/AssetCache.ts");
checkFileExists("src/engine/assets/internal/GLTFLoaderService.ts");
checkFileExists("src/engine/assets/internal/TextureLoaderService.ts");
checkFileExists("src/engine/assets/internal/AudioLoaderService.ts");
checkFileExists("src/plugins/assets/plugin.ts");

// 2. Validação dos Contratos e Tipos
checkFileContains("src/contracts/assets/types.ts", "AssetProgressEvent", "Evento AssetProgressEvent");
checkFileContains("src/contracts/assets/types.ts", "AssetLoadedEvent", "Evento AssetLoadedEvent");

// 3. Validação das Capabilities
checkFileContains("src/tokens/assets.ts", "AssetsToken", "Capability Token AssetsToken");
checkFileContains("src/tokens/assets.ts", "releaseAsset", "Método releaseAsset na interface AssetsApi");

// 4. Validação dos Serviços de Carregamento e VRAM
checkFileContains("src/engine/assets/internal/AssetCache.ts", "refCount", "Contagem de Referências no AssetCache");
checkFileContains("src/engine/assets/internal/AssetCache.ts", "disposeResource", "Descarte automático de VRAM/GPU no AssetCache");
checkFileContains("src/engine/assets/internal/GLTFLoaderService.ts", "GLTFLoader", "Uso do GLTFLoader do Three.js");
checkFileContains("src/engine/assets/internal/TextureLoaderService.ts", "SRGBColorSpace", "Configuração de ColorSpace na Textura");
checkFileContains("src/engine/assets/internal/AudioLoaderService.ts", "decodeAudioData", "Decodificação de áudio via Web Audio API");

// 5. Validação do Plugin Bridge
checkFileContains("src/plugins/assets/plugin.ts", "AssetsToken", "Provedor da capability AssetsToken no plugin");

console.log("\n--- Resultados ---");
for (const ok of successes) {
  console.log(`\x1b[32m[OK]\x1b[0m ${ok}`);
}

if (failures.length > 0) {
  console.log("\n--- Erros Encontrados ---");
  for (const err of failures) {
    console.log(`\x1b[31m[ERRO]\x1b[0m ${err}`);
  }
  console.log("\n\x1b[31mA camada de Assets Pipeline precisa de ajustes antes do congelamento.\x1b[0m");
  process.exit(1);
} else {
  console.log("\n\x1b[32mTodos os requisitos da Camada de Assets Pipeline foram validados com sucesso!\x1b[0m\n");
}