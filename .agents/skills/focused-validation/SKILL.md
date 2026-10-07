---
name: focused-validation
description: Validar alterações TypeScript/Vitest com teste focado e gates globais sem executar verificações redundantes.
---

# Validação com custo controlado

Ative quando for corrigir, adicionar ou revisar código TypeScript do Projeto_Engine.

1. Localize o arquivo de teste relevante (`tests/**/*.test.ts` ou teste próximo ao código).
2. Execute `scripts/agent-tools/validate.sh focused tests/arquivo.test.ts` substituindo pelo caminho real.
3. Se falhar, leia apenas linhas relevantes do erro e corrija a causa no escopo.
4. Não repita um comando idêntico sem modificação verificável de código ou hipótese nova.
5. Antes do PR/handoff, execute `scripts/agent-tools/validate.sh full` uma única vez depois da última alteração.
6. Se código Rust/Tauri mudou, trate `cargo check --manifest-path src-tauri/Cargo.toml` como gate adicional separado; uma compilação sem Steam não prova integração Steam completa.
7. Registre no Workpad comandos, resultados, limitações e o diff revisado. Não altere testes para apenas obter verde.

O modo `full` invoca `npm test` e `npm run build` porque o script `build` já inclui `arch:check` e `tsc`.
