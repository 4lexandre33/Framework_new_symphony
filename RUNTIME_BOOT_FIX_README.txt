Projeto1_046 - Runtime Boot Capability Fix

Arquivos incluídos:
- src/plugins/game-loop/plugin.ts
- src/plugins/camera/plugin.ts
- src/plugins/ai/plugin.ts
- src/plugins/terrain/plugin.ts
- src/plugins/net/plugin.ts

Objetivo:
- impedir consumo de capabilities com ctx.caps.require() durante setup()
- mover binding de dependências obrigatórias para lifecycle.onBoot()
- iniciar game.loop somente após kernel.booted
- corrigir o fallback silencioso de Steam no game.net

Extração na raiz do projeto:
unzip -o projeto1_046_runtime_boot_fix.zip -d .

Validação:
npx tsc --noEmit
npx vitest run
npm run build
npm run tauri dev
