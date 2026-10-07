---
name: game-readiness
description: Certificar ENGINE GAME-READY com gates TS Rust Tauri smoke real integração cleanup Steam opcional e baseline de performance.
---

# Gate ENGINE GAME-READY

Use em auditorias, testes e issues que declarem prontidão para iniciar desenvolvimento do jogo. Comece **read-only**.

1. Leia `SPEC.md` §12.1, o ticket e seu `## Codex Workpad`. Classifique cada requisito como `PASS`, `FAIL`, `BLOCKED` ou `NOT RUN`, incluindo evidências de execução e ambiente.
2. Distingua testes Vitest/mock de validação Rust (`cargo check`) e execução real Tauri; nenhum substitui automaticamente os outros. Teste Steam com `vi.mock` é prova parcial.
3. Execute o fluxo reproduzível iniciar → carregar cena/asset → input/mover → colisão → câmera/render → pause/resume → unload → encerrar. Capture falta de recursos como defeitos, não como sucesso.
4. Verifique disposals de listeners, duas schedulers RAF quando presentes, GPU resources, Rapier handles, workers e caches. Simule foco perdido, resize/context loss, asset inválido e IPC rejeitado quando relevante.
5. Capture baseline sem inventar budgets: tempo de frame, tick, draw calls, alocações, listeners, worker e physics object count; registre hardware/condições.
6. Use testes focados antes do gate global obrigatório e smoke nativo quando exigido. Se SDK/ambiente impedir, detalhe ação para desbloquear e mantenha `BLOCKED`.
7. Somente declare `ENGINE GAME-READY PASS` após satisfazer **todos** os critérios de SPEC; anote resultados no Workpad Linear, sem informações sensíveis.
