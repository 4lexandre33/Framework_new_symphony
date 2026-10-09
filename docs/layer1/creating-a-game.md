# Layer 1 — Como criar um jogo (guia curto, para humanos e IA)

A engine é genérica. **O jogo é uma pasta-plugin em `src/projects/<nome>/`**, carregada
automaticamente e removível apagando a pasta. Nunca coloque código de jogo em
`src/core`, `src/engine`, `src/plugins`, `src/contracts` ou `src/tokens`.

## Passo a passo

1. Copie `src/projects/_template/` para `src/projects/<meu-jogo>/`.
2. Em `src/projects/<meu-jogo>/index.ts`, troque `id` e `name` do `project`.
3. Em `src/projects/<meu-jogo>/TemplatePlugin.ts`, renomeie e ajuste o `manifest`
   (`id` único, `dependsOn`, `permissions`, `capabilities.consumes`).
4. Peça as capabilities pelos tokens públicos (`src/tokens/*`) com `ctx.caps.require`.
5. Coloque a lógica do jogo em classes da própria pasta; o plugin só compõe e conecta.
6. Registre o dispose de tudo que o jogo adquire em `ctx.lifecycle.onDispose`.
7. Rode `npm run arch:check`, `npx tsc --noEmit`, `npx vitest run` e `npm run build`.

Com mais de um projeto em `src/projects/`, escolha o ativo com `VITE_PROJECT=<id>`.

## O que a IA pode usar

| Preciso de | Use |
|---|---|
| Cena e câmera 3D | `src/tokens/render.ts`, `src/tokens/camera.ts` |
| Física | `src/tokens/physics.ts` e o evento `CollisionEnterEvent` |
| Teclado, mouse, gamepad | `src/tokens/input.ts` |
| Assets e áudio | `src/tokens/assets.ts`, `src/tokens/audio.ts` |
| UI e HUD | `src/tokens/ui.ts`; o contêiner genérico é `#hud-overlay` |
| Loop de jogo | evento `game.loop.tick` |
| Exemplo completo | `src/projects/physics-sandbox/` |

## Proibido

- Importar `src/engine/<módulo>/internal/**` ou `src/core/internal/**`.
- Acessar Three.js/Rapier da engine por fora das APIs públicas dos tokens.
- Alterar `.freeze-lock.json` ou desativar guardrails para obter PASS.
- Ativar o projeto por detecção implícita; a seleção é só `VITE_PROJECT` ou o projeto único.

## Verificação

`npm run project:isolation` copia o repositório, remove os projetos e confirma que
`arch:check`, `tsc`, os testes e o build continuam passando.
