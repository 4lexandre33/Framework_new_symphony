# AGENTS.md — Projeto_Engine

## Missão

O Projeto1 atual é uma **base técnica de engine/framework para jogos**. A prioridade imediata é certificar a engine existente e torná-la **ENGINE GAME-READY** para desenvolvimento do primeiro jogo. O objetivo futuro é transformá-la em framework distribuível para jogos 2D/3D, headless e aplicações desktop/Steam.

O código de um jogo deve ser consumidor da engine, não uma modificação indiscriminada do Kernel, de Domain ou de `/internal`. Uma cena jogável de validação não é prova de framework distribuído. Não bloquear o primeiro jogo esperando a Stage 116.

`SPEC.md` define o destino. O ticket do Linear define o escopo atual. `WORKFLOW.md` define o processo do Symphony.

## Fontes de verdade

Em caso de conflito:

1. checkout Git atual;
2. testes e validators executáveis;
3. `scripts/architecture/module-map.mjs`;
4. manifests/contracts/tokens reais;
5. `SPEC.md`;
6. documentação histórica/snapshots.

`Projeto1_107.md` é referência histórica, não prova do estado atual.

## Regras permanentes

### Isolamento obrigatório: engine versus projeto consumidor

**Um novo jogo, exemplo ou aplicativo NÃO deve exigir modificações no Kernel,
em `src/engine/**/internal`, nos plugins canônicos em `src/plugins/**`,
nos contracts ou nos tokens já estáveis.** O host técnico continua genérico.

- `src/project.ts` é a configuração de **projeto consumidor** do host
  atual; `src/projects/<nome>/**` contém exclusivamente cenas, assets,
  regras, controles e adapters daquele projeto. Para trocar de jogo, troque
  a composição de projeto; não copie gameplay para a fundação.
- Plugins podem ser adaptadores de composição, **não depósitos de gameplay**:
  um plugin do consumidor apenas requisita capabilities, conecta eventos,
  gerencia inicialização/teardown e delega a sistemas do próprio projeto.
- Programe contra **ports/interfaces**; implemente dependências concretas em
  adapters trocáveis. Fluxo permitido: projeto/orquestração -> ports públicos
  -> adapters -> engine/capabilities. Inverter o fluxo é proibido.
- Three.js, Rapier, DOM, Tauri e Steam pertencem aos adapters técnicos
  apropriados. A lógica semântica do projeto não conhece `internal/**`,
  `THREE.Mesh`, `RAPIER.World`, `window` nem IPC de plataforma.
- Toda dependência tem ownership e dispose. Prove unload/reload, listeners,
  corpos de física e GPU sem vazamentos; evite alocação por tick/render.
- O código de projeto NÃO pode ser ativado por porta fixa do Vite, detecção
  implícita do host, ou `game.debug`. Só a composição explícita seleciona
  o consumidor ativo; host sem projeto deve ser possível.
- Para vibecoding: a IA edita o diretório do projeto consumidor e sua
  composição. Uma extensão da API de engine é **issue separada**, com
  contrato, testes, audit e autorização de freeze quando exigida.
- Não construir agora packages/presets genéricos antes da Stage 91–99;
  `src/project.ts` é uma composição **local transitória**, não API pública
  definitiva do framework.

Critério de aceite arquitetural: substituir um projeto por outro (ou nenhum)
sem alterar `src/core/**`, `src/engine/**` e `src/plugins/**`.

### Não reescrever a fundação

Não crie um segundo:

- Kernel;
- lifecycle;
- capability registry;
- event/command/query backbone;
- plugin manifest system;
- game loop concorrente;
- Domain paralelo.

A productização deve reutilizar a base existente.

### Módulos

A fonte canônica dos módulos first-party é:

```text
scripts/architecture/module-map.mjs
```

Não mantenha lista paralela para governança.

### `/public` e `/internal`

Preservar:

```text
src/engine/<module>/
├── public/
└── internal/
```

Regras:

- `engine/X/internal` não importa `engine/Y/internal`;
- `engine/X/public` não expõe implementação privada;
- `plugins/X` pode compor `engine/X/internal`;
- `plugins/X` não acessa `engine/Y/internal`;
- consumidores externos usam somente APIs públicas;
- não exporte internals apenas para contornar boundary errors.

### Core

Consumidores usam a fachada pública do Core.

Não importar diretamente `src/core/internal/**` ou `src/core/runtime/**` fora do próprio Core/testes white-box deliberados.

### Domain

`src/domain/**` permanece sem dependência de:

```text
Three.js
Rapier
WebGL
DOM
Tauri
Steamworks
src/engine/**
src/plugins/**
src/services/**
src/app/**
```

Não usar wall clock ou `Math.random()` para regras determinísticas.

O mesmo modelo semântico deve servir 2D, 2.5D, 3D e headless.

### Services/App e composição do primeiro jogo

`src/services/**` orquestra Domain + ports + APIs públicas, nunca internals concretos.

`src/app/**` é composition root e fluxo de produto, não lugar para lógica de Domain.

O jogo/cena de validação deve compor plugins, tokens, APIs públicas, input, física, world, render e assets sem criar segundo Kernel/loop. Regras de gameplay, dados de cena e assets específicos não pertencem aos internals da engine. Um ciclo create/load/start/pause/resume/unload/dispose deve liberar listeners, workers, GPU, corpos Rapier e handles nativos.

Pode existir uma composição local à aplicação antes da API pública final do framework; não antecipe packages, presets ou breaking changes definidos somente nas Stages 91–116.

### Lifecycle

O Kernel continua sendo o coordenador único.

Preservar inverse shutdown e cleanup determinístico.

Todo recurso adquirido precisa de release/dispose:

- listeners;
- workers;
- WebSockets;
- Steam callbacks;
- WebAudio;
- GPU resources;
- physics bodies/colliders;
- timers;
- subscriptions;
- IPC handles;
- caches;
- object URLs.

### Game loop

Distinguir:

```text
simulation tick
render frame
wall clock
```

Simulação/física usa fixed timestep. Render usa frame variável/interpolação.

Em hot paths:

- evitar alocação por frame;
- evitar `map/filter/reduce` quando relevante;
- evitar criação de Promise/closure/listener por tick;
- evitar crescimento não limitado de Map/Set/cache.

### Three.js / GPU

Ownership e dispose devem ser explícitos para geometries, materials, textures, render targets e recursos relacionados.

### Rapier

Physics avança no fixed tick. Domain não armazena handles concretos de body/collider.

### Input

Tratar Pointer Lock, focus/blur e gamepad connect/disconnect. Remover listeners no teardown.

### Tauri/Rust

WebView → Rust é boundary de segurança.

Todo command novo precisa de:

- input validado;
- mínimo privilégio;
- erro serializável/mapeado;
- TypeScript API tipada.

Não introduzir shell arbitrário, path escape ou permissões globais desnecessárias.

### Steam

Steam é adapter opcional de plataforma, não owner de gameplay.

Preservar init/shutdown corretos, modo offline controlado e ausência de dependência Steam em presets que não a selecionem.

## Prioridade de execução e estratégia de framework

**P0: certificar a engine para jogos** com testes nativos Tauri/Rust e integração input → fixed tick/física → world → render; validar cena 3D de referência, asset, pause/resume e teardown.

**P1: tornar a produção de jogos prática** com uma composição simples e documentada por APIs públicas, diagnóstico, robustez e baseline de performance.

**P2: distribuir o framework** seguindo a SPEC (Stages 85–116): certificar Layer 1 (85–90), Stage 91 read-only, depois extrações, API, presets, CLI e consumidor externo. Nada de migração big-bang.

Protótipos podem começar antes do gate final, com riscos declarados. Somente evidência de integração real permite declarar `ENGINE GAME-READY PASS`. A futura configuração/preset compõe o Kernel existente, não o substitui.

## Skills, RTK e economia segura de tokens

Ative somente a Skill relevante em `.agents/skills/`: `repo-context`, `focused-validation`, `game-runtime`, `tauri-steam`, `engine-integration`, `game-composition` ou `game-readiness`. Não leia toda a SPEC nem todos os módulos em tarefas localizadas.

RTK é um **filtro opcional de saída** de terminal, não um teste. Use a saída sem filtros se o resultado compacto perder detalhes de erro. Não modifique hooks/permissões globais de `~/.codex` nem instale plugins fora do escopo da issue. Mantenha secrets e telemetria fora do repositório e do Workpad Linear.

## Git

Não executar comandos destrutivos sem autorização explícita.

Não apagar `.freeze-lock.json` para contornar freeze.

Respeitar `agents.mjs` e guardrails existentes.

### Freeze arquitetural

O arquivo canônico de congelamento é `/.freeze-lock.json`.

O orquestrador de proteção é `agents.mjs`, que utiliza
`tests/freeze-invariants.mjs`, `tests/freeze-lock.mjs`,
`scripts/architecture/module-map.mjs` e os verificadores arquiteturais.

Comandos disponíveis:

- `node agents.mjs`: executa as verificações.
- `node agents.mjs --lock`: ativa o congelamento.
- `node agents.mjs --unlock`: realiza o desbloqueio controlado.

Regras obrigatórias para Codex e Symphony:

- Nunca desbloquear automaticamente módulos protegidos.
- Nunca apagar ou editar manualmente `.freeze-lock.json`.
- Nunca desativar verificações para conseguir um PASS.
- Interromper a tarefa quando uma proteção bloquear mudanças.
- Registrar o bloqueio no ticket correspondente do Linear.
- Solicitar autorização antes de qualquer desbloqueio.
- Após alterações autorizadas, executar novamente os validadores.
- Restaurar o congelamento quando aplicável e autorizado.


## Gates mínimos

Após mudanças de código:

```bash
npm run arch:check
npx tsc --noEmit
npx vitest run
npm run build
```

Se Rust/Tauri estiver no escopo:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Se desktop runtime estiver no escopo, executar o smoke desktop disponível ou `npm run tauri dev` quando o ambiente permitir.

Testes focados devem ser executados antes da suíte completa sempre que existirem.

## Definition of Done

Uma mudança só está pronta quando:

- comportamento exigido foi implementado;
- não há placeholder substituindo funcionalidade;
- boundaries permanecem válidos;
- testes focados passam;
- gates globais aplicáveis passam;
- integração Tauri/Rust e smoke real foram comprovados se fazem parte do aceite; mocks não bastam para declarar nativo PASS;
- lifecycle/cleanup foi validado quando relevante;
- performance hot-path não regrediu quando relevante;
- documentação canônica foi atualizada se o contrato mudou;
- `git diff --check` passa;
- o diff está restrito ao ticket.

Não confunda arquivo existente, compilação isolada ou texto “PASS” em documentação com validação real.
