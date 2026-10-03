Projeto1_057 - Correção complementar do HudRenderer

Causa dos erros TS6133:
O arquivo src/debug/hud/HudRenderer.ts possuía interpolações de template string
escapadas/corrompidas, como \${valor}, \({valor} e \){valor}. Como o TypeScript
tratava esses trechos como texto literal, variáveis locais pareciam não utilizadas.

Correções:
- todas as interpolações agora usam ${...} corretamente;
- getErrorMessage volta a ser executado nos catch;
- master/activeSectorCount/hlod/metrics/loadedModCount/isLocked são usados de fato;
- diagnósticos de subsistemas foram limitados a 500 ms;
- mensagens repetidas de diagnóstico são deduplicadas;
- InputDiagnostics continua sendo atualizado a cada frame, preservando o lifecycle
  atual de InputApi.update() até que game.loop assuma oficialmente esse owner;
- arquivo completo substituível, sem patch parcial.

Aplicação:
  unzip -o projeto1_057_hudrenderer_fix.zip -d .

Validação:
  npx tsc --noEmit
  node tests/hud-renderer-smoke-test.mjs
  npx vitest run tests/modding-system.test.ts
  node tests/modding-smoke-test.mjs
  cargo check --manifest-path src-tauri/Cargo.toml
  npm run build
