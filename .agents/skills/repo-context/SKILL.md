---
name: repo-context
description: Buscar símbolos, contratos e testes do Projeto_Engine antes de abrir arquivos, reduzindo leitura do repositório e resultados extensos.
---

# Contexto dirigido do Projeto_Engine

Use esta Skill ao iniciar uma issue que requer localizar código, testes ou limites arquiteturais.

1. Confirme `git status --short` e `git log -1 --oneline`.
2. Consulte `scripts/architecture/module-map.mjs` quando o problema envolver um módulo.
3. Rode `scripts/agent-tools/find-context.sh 'símbolo ou termo' 60`.
4. Selecione de 1 a 5 arquivos candidatos e leia apenas faixas que contenham os símbolos e suas chamadas diretas.
5. Leia testes locais antes de modificar comportamento. Expanda a busca somente se o caminho inicial não explicar o problema.
6. Nunca solicite todo o repositório, snapshots grandes, `node_modules`, `dist`, `target` ou lockfiles para resolver uma alteração localizada.
7. Ao retomar uma tentativa, consulte primeiro `## Codex Workpad`, `git status` e o diff existente.

Produza uma hipótese curta, arquivos candidatos, teste focado e risco de regressão; não gere um documento permanente paralelo.
