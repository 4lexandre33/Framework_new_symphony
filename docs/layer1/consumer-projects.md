# Layer 1 — Projetos consumidores

A engine é um **substrato genérico**. Cada jogo ou aplicativo é um consumidor
isolado, removível e substituível. Criar um novo jogo não deve exigir alterar o
Kernel, `src/engine/**/internal`, os plugins canônicos em `src/plugins/**`, os
contracts nem os tokens estáveis.

## 1. Onde o projeto vive

| Caminho | Papel |
|---|---|
| `src/project-contract.ts` | Contrato `ProjectDefinition` (`id`, `name`, `createPlugins()`) |
| `src/project.ts` | Descoberta automática: encontra `src/projects/<nome>/index.ts` em build time e expõe `createProjectPlugins()` e `listProjects()` |
| `src/projects/<nome>/**` | Cenas, assets, HUD, regras, controles e adapters daquele projeto |
| `src/projects/_template/` | Molde para novos jogos. Pastas que começam com `_` nunca são carregadas |
| `src/app/bootstrap.ts` | Conhece somente `createProjectPlugins()`; registra no Kernel os plugins retornados |

**Adicionar um jogo:** copiar `src/projects/_template/` para `src/projects/<meu-jogo>/`
e implementar. **Remover um jogo:** apagar a pasta. Nenhum arquivo da engine muda e
os gates (`arch:check`, `tsc`, Vitest, build) continuam verdes, inclusive com
`src/projects/` vazio. Isso é verificado por `npm run project:isolation`
(`scripts/architecture/check-project-isolation.mjs`).

Seleção do projeto ativo: se existe exatamente um, ele é usado; com vários, defina
`VITE_PROJECT=<id>`. Passar `"none"` sobe o host sem projeto. O exemplo atual é
`physics-sandbox`.

Esta composição local **não** é a API pública definitiva do framework
(`defineProject`, `createApplication`, packages e presets), que pertence às
Stages 91–116. Guia passo a passo: `docs/layer1/creating-a-game.md`.

## 2. Estrutura de um projeto

O exemplo existente é `src/projects/physics-sandbox/`:

| Parte | Responsabilidade |
|---|---|
| `src/projects/physics-sandbox/PhysicsSandboxPlugin.ts` | Plugin de **composição**: requisita capabilities, conecta eventos, gerencia inicialização e teardown e delega ao projeto. Não guarda lógica de jogo. |
| `src/projects/physics-sandbox/PhysicsSandboxGame.ts` | Lógica do projeto |
| `src/projects/physics-sandbox/adapters/SandboxHud.ts` | HUD do exemplo (vida, mana, munição). A engine só oferece o contêiner `#hud-overlay` |
| `ports/` | Interfaces mínimas que o projeto exige (por exemplo, view e áudio) |
| `adapters/` | Implementações concretas dos ports sobre as APIs públicas da engine |

Fluxo de dependência permitido: projeto → ports públicos → adapters → engine.
O sentido inverso é proibido.

## 3. Regras

- Three.js, Rapier, DOM, Tauri e Steam pertencem aos adapters técnicos. A lógica
  semântica do projeto não conhece `internal/**`, `THREE.Mesh`, `RAPIER.World`,
  `window` nem IPC de plataforma.
- O projeto ativo é selecionado **somente** pela composição explícita. Não pode
  ser ativado por porta do Vite, detecção implícita do host ou `game.debug`.
- Todo recurso adquirido tem dono e dispose. Unload/reload não pode deixar
  listeners, corpos de física, recursos de GPU ou handles de IPC.
- Evitar alocação por tick/render.
- Se a API pública não atende, abre-se uma issue separada para contrato e
  adapters. Não se cruza `/internal` nem se altera freeze.

## 4. Critério de aceite arquitetural

Substituir um projeto por outro (ou por nenhum) sem alterar `src/core/**`,
`src/engine/**` e `src/plugins/**`, apenas adicionando ou apagando pastas em `src/projects/`.

Limitação conhecida: a API de câmera v1 não tem operação dedicada para atualizar
a pose de uma câmera virtual. Um projeto pode adaptar seus descritores somente
sob eventos de input, via `CameraApi`. A evolução desse port exige issue própria.

Regras completas: `AGENTS.md`, `WORKFLOW.md` e `SPEC.md` (§5.1).
