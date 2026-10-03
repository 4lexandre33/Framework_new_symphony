Projeto1_057 - Correção completa da Camada 19 game.modding
Snapshot auditado: #057 (03/10/2026 17:16:21)

Arquivos substituídos:
- src/tokens/modding.ts
- src/engine/modding/AssetOverrideRegistry.ts
- src/engine/modding/DynamicPluginLoader.ts
- src/engine/modding/ScriptSandbox.ts
- src/engine/modding/SteamWorkshopDriver.ts
- src/engine/modding/TauriModdingDriver.ts
- src/plugins/modding/plugin.ts
- src/plugins/debug/plugin.ts
- src-tauri/src/modding.rs
- src-tauri/src/lib.rs
- tests/modding-system.test.ts
- tests/modding-smoke-test.mjs

Correções principais:
- resolveOverride() agora acessa o primeiro item do array de overrides ordenado;
- testes de load order agora acessam order[0]/order[1];
- DynamicPluginLoader valida manifestos de verdade;
- comparação de versões passa a usar semver da própria engine;
- detecção de dependência ausente, versão incompatível e ciclo;
- enableMod ativa dependências na ordem correta;
- disableMod não destrói o manifesto instalado e bloqueia desativação de dependência ainda usada;
- handler ausente de PublishModToWorkshopCommand;
- commands/events passam a usar os contratos tipados como fonte de verdade;
- TauriModdingDriver não mascara falhas do backend como sucesso falso;
- ScriptSandbox aplica timeout, libera Blob URL e respeita allowlist de capabilities declaradas no envelope;
- SteamWorkshopDriver limita progresso a 0..100;
- DTOs Rust usam camelCase e preservam entryScript/overrides/dependencies;
- scan de mods Rust passa a propagar erros de diretório e ignorar manifests inválidos com diagnóstico;
- game.debug passa a resolver ModdingToken;
- src-tauri/src/lib.rs preserva também o registro overlay_dock_to_taskbar, que estava ausente no snapshot 057.

Validação executada neste pacote:
- TypeScript strict/noUnusedLocals/noUnusedParameters do núcleo modding: PASS
- testes comportamentais locais de AssetOverrideRegistry: PASS
- testes comportamentais locais de DynamicPluginLoader (load order/semver/ciclo): PASS
- testes comportamentais locais de SteamWorkshopDriver: PASS
- tests/modding-smoke-test.mjs em reconstrução do snapshot 057 + patch: PASS

Não foi possível executar neste ambiente:
- Vitest real do projeto (dependências do repositório não estão montadas aqui)
- cargo check (toolchain Rust não está instalado neste ambiente)

Observações arquiteturais:
1. O backend Rust de download/publicação Workshop do snapshot ainda não contém integração Steamworks UGC real; ele valida entradas e mantém o comportamento existente, mas isso continua sendo uma etapa de implementação futura.
2. Web Worker isola scripts do DOM, mas não é uma fronteira de segurança equivalente a processo separado para mods hostis. Para mods totalmente não confiáveis, use runtime dedicado (WASM/QuickJS/processo separado) em uma camada futura.

Aplicação na raiz do projeto:
node agents.mjs --unlock
unzip -o projeto1_057_modding_fix.zip -d .

Validação recomendada:
npx tsc --noEmit
npx vitest run tests/modding-system.test.ts
node tests/modding-smoke-test.mjs
cargo check --manifest-path src-tauri/Cargo.toml
npx vitest run
npm run build
npm run tauri dev
