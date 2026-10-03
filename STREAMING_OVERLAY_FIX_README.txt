Projeto1_055 - Correção das Camadas game.streaming e game.overlay
=================================================================

Este patch corrige os erros TypeScript encontrados após a atualização da camada
game.security e também problemas relacionados detectados na auditoria das
camadas 16 e 17.

Principais correções:
- StreamingWorkerPool passa a usar maxWorkers de verdade e maxWorkers=0 força fallback.
- Pool trata jobs pendentes, falhas de worker e dispose sem promessas abandonadas.
- WorldStreamingSectorManager valida raios, não cria estado para setor inexistente
  e usa distância ao quadrado no hot path.
- game.streaming usa deltaSeconds real, câmera ativa real, onBoot para capability,
  command IDs tipados e implementa SetStreamingRadiusCommand.
- Remove permissões/capabilities declaradas e não consumidas em game.streaming.
- game.overlay passa a usar position em dockToTaskbar e realiza docking nativo real.
- game.overlay usa IDs tipados, depende explicitamente de game.loop e preserva delta 0.
- TauriOverlayDriver possui fallback seguro fora do Tauri.
- Backend Rust adiciona overlay_dock_to_taskbar e registra o comando no invoke handler.
- Cargo declara windows-sys diretamente para o código Win32 já usado por overlay.rs.
- Testes e smoke tests foram ampliados.

Extração na raiz do projeto (Git Bash):
  unzip -o projeto1_055_streaming_overlay_fix.zip -d .

Validação sugerida:
  npx tsc --noEmit
  npx vitest run tests/streaming-system.test.ts tests/overlay-system.test.ts tests/security-system.test.ts
  node tests/streaming-smoke-test.mjs
  node tests/overlay-smoke-test.mjs
  node tests/security-smoke-test.mjs
  cargo check --manifest-path src-tauri/Cargo.toml
  npx vitest run
  npm run build
  npm run tauri dev

Somente após tudo passar:
  node agents.mjs --lock
  node agents.mjs

Validação executada no ambiente de preparação deste patch:
- tests/streaming-smoke-test.mjs: PASS
- tests/overlay-smoke-test.mjs: PASS
- TypeScript strict/noUnused dos arquivos TS alterados: PASS

Limitações do ambiente de preparação:
- Vitest completo não foi executado aqui.
- cargo check não pôde ser executado aqui por ausência do toolchain Rust.
