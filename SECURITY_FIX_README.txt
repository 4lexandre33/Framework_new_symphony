Projeto1_055 - Correção completa da Camada 18 game.security
Snapshot auditado: #055 (03/10/2026 15:39:47)

Arquivos de substituição:
- src/contracts/security/types.ts (mantido compatível; incluído para pacote autocontido da camada)
- src/tokens/security.ts
- src/engine/security/FrameProfiler.ts
- src/engine/security/MemoryIntegrityGuard.ts
- src/engine/security/CrashReportDumper.ts
- src/engine/security/TauriSecurityDriver.ts
- src-tauri/src/security.rs
- src/plugins/security/plugin.ts
- src/plugins/debug/plugin.ts
- tests/security-system.test.ts
- tests/security-smoke-test.mjs

Correções principais:
- acesso correto ao array snapshot.subsystems nos testes;
- profiler com last/avg/max reais e janela de FPS por sampleCount;
- remoção da atribuição inválida em TypedArrays no MemoryIntegrityGuard;
- XOR reversível apenas sobre bits de mantissa do Float64, preservando finitude;
- checksum de integridade baseado nos bits exatos do valor ofuscado;
- validações contra NaN/Infinity e dados adulterados;
- handler ausente de game.security.validate-integrity;
- handlers passam a usar Command.type como fonte de verdade;
- deltaSeconds=0 deixa de virar 0.016;
- game.security declara dependência explícita de game.loop;
- remoção de capabilities não utilizadas do manifesto de segurança;
- Rust deixa de usar static mut e passa a OnceLock + Mutex;
- proteção contra path traversal no crash_id e limite de tamanho do dump;
- game.debug passa a resolver StreamingToken, OverlayToken e SecurityToken.

Validação feita no pacote antes da entrega:
- TypeScript strict/noUnused em scaffold compatível: PASS
- Testes comportamentais de FrameProfiler/MemoryIntegrityGuard/CrashReportDumper: PASS
- Teste runtime do plugin e handlers: PASS
- security-smoke-test.mjs aplicado sobre o snapshot #055 reconstruído: PASS

Observação:
O ambiente de geração não possui rustc/cargo, então a compilação Rust final deve ser executada no seu projeto Windows/Tauri.

Aplicação na raiz do projeto (Git Bash):
  node agents.mjs --unlock
  unzip -o projeto1_055_security_fix.zip -d .

Validação recomendada:
  npx tsc --noEmit
  npx vitest run tests/security-system.test.ts
  node tests/security-smoke-test.mjs
  cargo check --manifest-path src-tauri/Cargo.toml
  npx vitest run
  npm run build
  npm run tauri dev

Somente depois de tudo verde:
  node agents.mjs --lock
  node agents.mjs
