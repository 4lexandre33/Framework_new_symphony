# Layer 1 — Projetos consumidores

A engine é um **substrato genérico**. Cada jogo ou aplicativo é um consumidor
isolado, removível e substituível. Criar um novo jogo não deve exigir alterar o
Kernel, `src/engine/**/internal`, os plugins canônicos em `src/plugins/**`, os
contracts nem os tokens estáveis.

## 1. Onde o projeto vive

| Caminho | Papel |
|---|---|
| `src/project.ts` | Composição **local** dos consumidores. Expõe `createProjectPlugins()` e o tipo `LocalProjectId` (`"none"` ou `"physics-sandbox"`). |
| `src/projects/<nome>/**` | Cenas, assets, regras, controles e adapters daquele projeto |
| `src/app/bootstrap.ts` | Conhece somente `createProjectPlugins()`; registra no Kernel os plugins retornados |

O padrão atual é `physics-sandbox`. Passar `"none"` devolve uma lista vazia, ou
seja, o host sobe sem nenhum projeto. Trocar de jogo altera apenas
`src/project.ts` e a pasta do projeto.

`src/project.ts` é uma composição local transitória. Ela **não** é a API pública
definitiva do framework (`defineProject`, `createApplication`, packages e
presets), que pertence às Stages 91–116.

## 2. Estrutura de um projeto

O exemplo existente é `src/projects/physics-sandbox/`:

| Parte | Responsabilidade |
|---|---|
| `src/projects/physics-sandbox/PhysicsSandboxPlugin.ts` | Plugin de **composição**: requisita capabilities, conecta eventos, gerencia inicialização e teardown e delega ao projeto. Não guarda lógica de jogo. |
| `src/projects/physics-sandbox/PhysicsSandboxGame.ts` | Lógica do projeto |
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
`src/engine/**` e `src/plugins/**`.

Limitação conhecida: a API de câmera v1 não tem operação dedicada para atualizar
a pose de uma câmera virtual. Um projeto pode adaptar seus descritores somente
sob eventos de input, via `CameraApi`. A evolução desse port exige issue própria.

Regras completas: `AGENTS.md`, `WORKFLOW.md` e `SPEC.md` (§5.1).
