# SPEC.md — Projeto_Engine: ENGINE GAME-READY → framework distribuível

Status: **Especificação normativa — base de engine agora, framework reutilizável no futuro**

## 1. Objetivo

Transformar o Projeto1 atual em um framework modular e distribuível para desenvolvimento de:

- jogos 3D;
- jogos 2D/2.5D;
- aplicações desktop;
- aplicações distribuídas pela Steam;
- runtimes headless;
- ferramentas e companion apps baseados em Tauri.

O framework deve reutilizar a arquitetura atual em vez de criar uma segunda engine.

**Estado presente:** base técnica completa de engine/framework para jogos, com sistemas e testes existentes. Isso **não significa** jogo pronto, certificação nativa completa ou framework publicado.

**Objetivo imediato:** provar que é possível começar o primeiro jogo sobre a engine, através de suas APIs públicas: marco **ENGINE GAME-READY** (§12.1).

**Objetivo futuro:** productizar essa mesma base para terceiros consumirem packages, presets e CLI em jogos e aplicações (Stages 85–116). O marco intermediário não renumera, cancela ou declara concluída nenhuma stage. Não exigir Stage 116 antes do início de protótipos jogáveis.

Nome de trabalho:

```text
Projeto_Engine
```

Namespace de packages de trabalho:

```text
@projeto-engine/*
```

O nome/namespace final pode mudar sem alterar esta arquitetura.

---

## 2. Como esta SPEC deve ser usada pelo Symphony

O Symphony/Linear é o sistema operacional do trabalho.

Este arquivo NÃO armazena status de tarefa.

Ele define:

- produto final e milestone intermediário GAME-READY;
- invariantes arquiteturais;
- arquitetura-alvo;
- sequência de transformação;
- critérios de aceite do programa.

O tracker deve conter as issues executáveis e relações `blockedBy`.

### 2.1 Bootstrap do programa

Quando ainda não existir um DAG de issues confiável:

1. criar uma issue de planejamento rotulada `symphony`;
2. essa issue lê esta SPEC e o checkout;
3. identifica a primeira etapa ainda não concluída de verdade;
4. materializa somente as issues necessárias a partir dali;
5. conecta dependências;
6. não duplica stages comprovadamente concluídas.

### 2.2 Granularidade de issue

Uma issue deve representar uma unidade revisável com acceptance criteria objetivos.

Evitar:

- uma issue para cada arquivo;
- uma única issue para toda a migração;
- duplicação de milestones como tarefas sem entrega.

Preferir:

```text
um boundary
um package
um validator
um preset
uma integração
uma migração coerente
```

por issue.

---

## 3. Baseline conhecida

A referência histórica fornecida é `Projeto1_107.md`.

Ela indica uma arquitetura já madura, incluindo:

- migração arquitetural v20;
- microkernel;
- plugins/capabilities/contracts/tokens;
- separação `/public` e `/internal`;
- `scripts/architecture/module-map.mjs` como catálogo canônico;
- baseline de 20 módulos funcionais + 3 runtimes;
- Core com facade pública;
- Domain Layer 2 dimension-agnostic;
- application services reais já iniciados;
- app flows reais já iniciados;
- guardrails de architecture boundaries/dependencies;
- build integrando `arch:check`;
- Tauri/Rust;
- Three.js;
- Rapier;
- Steamworks;
- certificação automatizada Layer 1: Stages 80–84 com PASS em 07/10/2026 (arquitetura, TypeScript, Vitest, Cargo e build); validação real da Steam na janela nativa do Tauri ainda pendente.

Isso é apenas ponto de partida.

Antes de qualquer stage nova, o agente deve verificar o checkout real.

---

## 4. Visão do produto final

O framework deve permitir uma experiência equivalente a:

```ts
import {
  createApplication,
  game3dPreset,
} from "@projeto-engine/framework";

const app = createApplication({
  preset: game3dPreset({
    steam: true,
  }),
});

await app.start();
```

Aplicação desktop Steam sem runtime de jogo:

```ts
import {
  createApplication,
  desktopSteamPreset,
} from "@projeto-engine/framework";

const app = createApplication({
  preset: desktopSteamPreset(),
});

await app.start();
```

Headless:

```ts
import {
  createApplication,
  headlessPreset,
} from "@projeto-engine/framework";

const app = createApplication({
  preset: headlessPreset(),
});

await app.start();
```

Estas assinaturas representam a intenção da API. O boundary audit pode ajustar nomes exatos antes de congelá-los.

---

## 5. Princípios

### P1 — Reutilizar, não reescrever

A base atual é o substrato do framework.

### P2 — Optional by composition

Renderer, physics, Steam, Tauri, networking, terrain e outros subsistemas não devem ser dependências obrigatórias quando o preset não os usa.

### P3 — Stable public boundaries

Código consumidor deve depender de APIs públicas, não de paths internos.

### P4 — Headless first-class

Core e Domain devem funcionar sem DOM, renderer, Tauri ou Steam.

### P5 — Desktop first-class

Tauri/Steam são integrações oficiais, mas opcionais.

### P6 — Zero-cost hot path

A camada de framework não deve adicionar lookup/reflection/alocação por frame desnecessária.

### P7 — Evidence over documentation

Nenhuma stage é concluída porque um `.md` diz PASS.

---

## 5.1 Contrato normativo de substituição de projetos e vibecoding

A engine é **substrato genérico** para jogos 2D/3D, ferramentas e aplicações.
Cada jogo/app é um consumidor isolado, removível e substituível. Uma IA
orientada por vibecoding deve poder construir um novo projeto sem editar
Kernel, módulos internos, plugins de infraestrutura ou Domain compartilhado.

- **Core/engine:** possui lifecycle, loop, renderer, física e capabilities.
  Não conhece entidades, mapas, regras ou personagens específicos de jogos.
- **Contracts/ports:** definem capacidades mínimas, assinaturas estáveis,
  ownership, ciclo de vida e limites de erro. Dependências fluem para
  abstrações, nunca de engine para consumidores.
- **Adapters:** implementam ports e isolam Three.js, Rapier, WebView/DOM,
  Tauri/Steam e fontes de assets; backends podem evoluir independentemente.
- **Projeto consumidor:** declara composição, cenas, mecânicas, assets,
  controllers e seus adapters, usando APIs públicas. Seu plugin de
  composição é somente cola de integração, não repositório de gameplay.
- **IA/vibecoding:** trabalha prioritariamente no projeto consumidor;
  alterações em engine requerem escopo independente e invariantes aprovadas.

Na fase atual, `src/project.ts` e `src/projects/<nome>/**` exercem o papel
local de composition root e consumers. O bootstrap da engine conhece apenas
`createProjectPlugins()`. Alternar para outro projeto ou host vazio altera
somente a composição do consumidor. **Não considerar isto** implementação
antecipada de `defineProject`, `createApplication`, packages ou presets das
Stages 91–116.

Aceite verificável: projeto A -> unload/dispose -> projeto B (ou host vazio)
sem alterações em `src/core/**`, `src/engine/**` e `src/plugins/**`; nenhum
código de jogo em plugins canônicos ou internals; sem leaks relevantes de
RAF/listeners/physics/GPU/IPC; sem importar deep internals. Public APIs com
lacunas devem virar issue de evolução de contrato, não hacks via internals.

A API de câmera v1 ainda não possui operação dedicada para atualizar pose de
câmera virtual. Um exemplo pode adaptar seus descritores somente sob eventos
de input, via `CameraApi`, sem acessar internals ou sobrescrever diretamente
a câmera do Three.js. A evolução do port merece issue própria antes da
productização; não alterar API congelada de forma implícita.

---

## 6. Arquitetura lógica preservada

```text
┌────────────────────────────────────────────┐
│ Core / Kernel                              │
│ lifecycle • plugins • capabilities         │
│ events • commands • queries                │
└────────────────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────┐
│ Layer 1 — Engine / Infrastructure          │
│ loop • render • physics • input • assets   │
│ world • audio • UI • net • Steam • Tauri   │
└────────────────────────────────────────────┘

┌────────────────────────────────────────────┐
│ Layer 2 — Domain                           │
│ semantic state/rules/events/progression    │
│ economy/narrative/random/snapshots/ports   │
└────────────────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────┐
│ Layer 3 — Application Services             │
│ use cases / orchestration                  │
└────────────────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────┐
│ Layer 4 — App / Composition                │
│ bootstrap / product flows                  │
└────────────────────────────────────────────┘
```

A Layer 2 não depende da Layer 1; o diagrama representa composição do produto, não inversão das regras de dependência.

---

## 7. Arquitetura-alvo do framework

```text
User project
     │
     ▼
@projeto-engine/framework
 config • presets • bootstrap
     │
     ▼
existing Kernel / plugin graph
     │
     ├───────────── runtime modules
     │
     ├───────────── technical backends
     │                 ├─ Three
     │                 └─ Rapier
     │
     ├───────────── platform adapters
     │                 ├─ Tauri
     │                 └─ Steam
     │
     └───────────── application/domain composition
```

### 7.1 Não congelar cedo demais a quantidade de packages

A Stage 91 deve decidir a extração final.

Critérios para separar package:

- dependência técnica pesada/opcional;
- boundary público independente;
- versionamento independente útil;
- necessidade de uso headless;
- platform-specific dependency;
- possibilidade real de substituição de backend.

Não criar automaticamente um package por módulo apenas porque existem 23 módulos.

### 7.2 Families mínimas esperadas

A solução final provavelmente terá equivalentes a:

```text
foundation
  core
  domain
  framework

heavy/replaceable backends
  render-three
  physics-rapier

platform
  platform-tauri
  platform-steam

tooling
  cli
```

Módulos menores podem ficar agrupados ou expostos por subpaths conforme a Stage 91 provar ser mais adequada.

---

## 8. API de framework

### 8.1 Configuração

Target conceitual:

```ts
export interface ProjectDefinition {
  readonly preset: ProjectPreset;
  readonly plugins?: readonly Plugin[];
}

export function defineProject(
  definition: ProjectDefinition,
): ProjectDefinition;
```

`defineProject()` deve:

- ser puro;
- não iniciar Kernel;
- não tocar DOM;
- não invocar Tauri;
- não inicializar Steam;
- validar configuração quando apropriado.

### 8.2 Runtime

Target conceitual:

```ts
export interface ApplicationRuntime {
  readonly status:
    | "created"
    | "starting"
    | "running"
    | "stopping"
    | "stopped"
    | "failed";

  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createApplication(
  definition: ProjectDefinition,
): ApplicationRuntime;
```

`createApplication()` deve compor o Kernel existente.

Não criar lifecycle paralelo.

### 8.3 Presets oficiais

No mínimo:

```text
empty
headless
game-2d
game-3d
desktop-steam
```

#### empty

Core + somente o necessário para iniciar/parar.

#### headless

Sem DOM/Tauri/Steam/render obrigatório.

#### game-2d

Não deve exigir physics 3D/terrain 3D.

#### game-3d

Composição oficial Three + physics conforme decisão do projeto.

#### desktop-steam

Prova de que o framework serve uma aplicação Steam sem carregar módulos de jogo desnecessários.

### 8.4 Plugins

Third-party plugins devem conseguir usar apenas a superfície pública necessária.

Não exigir import de `internal`.

Uma SDK separada só deve existir se a Stage 91 provar que não é melhor manter esses contratos no Core/framework.

---

## 9. Package boundaries

Cada package publicado deve possuir exports explícitos.

Não publicar acidentalmente:

```text
./src/*
./internal/*
```

Consumidor externo não deve depender de estrutura física interna.

Package graph deve ser acíclico em runtime.

Dependências opcionais devem permanecer opcionais.

Core/Domain não podem adquirir dependência de Tauri/Steam/Three/Rapier por conveniência de empacotamento.

---

## 10. Runtime invariants

### 10.1 Game loop

Preservar fixed timestep, accumulator, frame delta clamp e render interpolation.

```text
wall-clock delta
      ↓
clamp
      ↓
accumulator
      ↓
0..N fixed simulation steps
      ↓
interpolation alpha
      ↓
render
```

Framework wrappers devem ser resolvidos fora do hot path quando possível.

### 10.2 Rendering

Ownership explícito de GPU resources.

Suportar resize/context lifecycle e teardown completo.

### 10.3 Physics

Physics avança no fixed tick.

Lifecycle de world/body/collider/event queue deve ser explícito.

### 10.4 Input

Pointer Lock, focus/blur e gamepad lifecycle devem continuar corretos.

### 10.5 Workers/assets/streaming

Jobs canceláveis; resultados obsoletos não podem ser aplicados após unload/dispose.

### 10.6 Networking

Transport deve permanecer substituível.

Steam P2P é backend, não regra de domínio.

---

## 11. Platform invariants

### 11.1 Tauri

WebView → Rust é boundary não confiável.

Commands:

- payload validado;
- least privilege;
- errors tipados/serializáveis;
- nenhuma execução arbitrária;
- path validation.

### 11.2 Steam

Steam pode estar:

```text
disabled
initializing
available
unavailable
stopping
stopped
```

Offline não deve derrubar o framework inteiro quando a feature puder degradar.

Init no máximo uma vez por lifecycle.

Callback pump/shutdown sem thread residual.

Steam Cloud/P2P/Overlay/Workshop/Achievements/Stats ficam atrás de interfaces/capabilities adequadas.

---

## 12. Estratégia de migração

A transformação é sequencial por dependência, não necessariamente por calendário.

### Fase A — concluir Layer 1

#### Stage 85 — Native/Tauri Infrastructure

Certificar:

- bridges nativas;
- IPC schema;
- input validation;
- permission model;
- error mapping;
- security;
- shutdown.

Exit:

```text
STAGE 85 PASS
```

#### Stage 86 — Performance & Resource Lifecycle

Certificar:

- allocations/frame;
- draw calls;
- GPU resources;
- physics resources;
- listeners;
- workers;
- WebAudio;
- network queues;
- cache growth.

Exit:

```text
STAGE 86 PASS
```

#### Stage 87 — Failure Recovery

Fault injection:

- WebGL context loss;
- corrupt asset;
- worker failure;
- network disconnect;
- Steam offline;
- storage failure;
- Rust invoke rejection;
- physics init failure;
- plugin boot failure.

Exit:

```text
STAGE 87 PASS
```

#### Stage 88 — Desktop / Steam Production

Certificar:

- Tauri release;
- executable/assets paths;
- Windows packaging;
- DPI/resize/focus;
- startup/shutdown;
- dev/release Steam handling;
- desktop smoke.

#### Stage 89 — Layer 1 Documentation

Atualizar documentação técnica necessária e validar referências.

#### Stage 90 — Final Layer 1 Gate

Agregar a certificação 71–89.

Exit:

```text
LAYER 1 PASS
```

Não iniciar movimentação estrutural massiva para packages antes deste gate.

---

## 12.1 Marco intermediário — ENGINE GAME-READY

**Objetivo:** certificar a integração prática do microkernel e dos módulos atuais para iniciar o primeiro jogo 3D em Tauri, sem misturar o jogo com internals da engine. Esse marco é independente da prova de distribuição externa da Stage 116.

### Escopo mínimo por entregas verificáveis

1. **Host nativo:** executar `npm run arch:check`, teste TS/Vitest, build e `cargo check --manifest-path src-tauri/Cargo.toml` com features efetivas; fazer smoke real com `tauri dev` ou equivalente no host alvo, com startup e shutdown. Distinguir falhas de ambiente, build Rust e Steam indisponível. Teste unitário mockado não prova execução real.
2. **Composition root:** iniciar, pausar, retomar, descarregar e encerrar um jogo a partir do Kernel existente, com código de cena/gameplay desacoplado de `src/engine/*/internal` e `src/core/internal`.
3. **Cena observável:** canvas renderizado; câmera; uma entidade controlada por teclado/mouse; física Rapier avançando no tick fixo; pelo menos uma colisão ou interação visível; ao menos um asset local carregado e liberado. Gamepad deve ser testado quando disponível e suportado pelo cenário.
4. **Lifecycle:** eventos, RAF, física, renderer/GPU, input listeners, workers e outros handles devem ter owners, cleanup e comportamento em perda de foco/resize/contexto quando aplicável. Verificar reload/unload e ausência de vazamentos relevantes.
5. **Steam opcional:** jogo/host sem Steam deve funcionar sem login obrigatório; qualquer dependência atual de Steam hardcoded deve ser registrada e corrigida como adapter/plataforma quando necessário, não ignorada.
6. **Resiliência e performance:** reproduzir falhas importantes (asset, physics init, IPC, contexto WebGL, Steam offline); medir baseline de frame time, fixed tick, draw calls e recursos sem inventar limites numéricos; preservar gates globais.

### Condições para declarar PASS

- Fluxo reproduzível: `iniciar → carregar cena → mover/interagir → pausar/retomar → descarregar → encerrar`.
- Nenhuma integração do jogo depende de import cruzado de internals da engine.
- Testes focados, `arch:check`, TypeScript, Vitest, build e gates nativos aplicáveis concluídos.
- Execução Tauri/Rust real comprovada no ambiente declarado; se bloqueada por SDK/ambiente, marcar `BLOCKED`, não `PASS`.
- Asset local e caminho de inicialização sem Steam suportados ou explicitamente bloqueados.
- Teardown e baseline de performance registrados; defeitos remanescentes têm issues no Linear.

Saída permitida **somente após evidência**:

```text
ENGINE GAME-READY ........ PASS
```

A primeira cena pode ser prototipada antes da conclusão formal deste gate, com riscos registrados. A preparação do jogo **não substitui** Stages 85–90 nem autoriza marcar Stage 91+ concluída. Framework distribuível só pode ser declarado na Stage 116.

---

## 13. Fase B — descoberta do framework

### Stage 91 — Framework Boundary Audit

Read-only primeiro.

Classificar o código atual em:

```text
foundation
domain
runtime
backend
platform
application-specific
tooling
legacy compatibility
```

A stage deve responder:

- o que realmente precisa virar package;
- o que pode permanecer agrupado;
- quais APIs já são públicas;
- quais dependências tornam módulos opcionais;
- onde existem deep imports;
- quais parts pertencem ao produto atual e não ao framework.

Nenhum runtime move nesta stage.

---

## 14. Fase C — packaging foundations

### Stage 92 — Workspace

Introduzir workspace/package infrastructure sem alterar comportamento.

### Stage 93 — Package guardrails

Detectar:

- deep import proibido;
- cross-package internal;
- package cycles;
- undeclared dependencies;
- platform dependency leaking into core/headless.

### Stage 94 — Core extraction

Extrair/publicar Core preservando semântica.

Compat facade temporária é permitida quando reduz risco.

### Stage 95 — Domain extraction

Provar execução/teste headless fora da aplicação atual.

---

## 15. Fase D — framework surface

### Stage 96 — Configuration

Implementar `defineProject` ou contrato equivalente.

Sem side effects.

### Stage 97 — Plugin authoring surface

Estabilizar a menor API necessária para third-party plugins.

Criar package `plugin-sdk` somente se houver valor arquitetural real.

### Stage 98 — Bootstrap

Implementar `createApplication` ou equivalente usando o Kernel existente.

### Stage 99 — Profiles

Distinguir composição:

```text
game
desktop
headless
```

Exit:

```text
FRAMEWORK FOUNDATION PASS
```

---

## 16. Fase E — runtime/backend/platform extraction

### Stage 100 — Loop/runtime base

Preservar determinismo.

### Stage 101 — Heavy backends

Separar renderer Three e physics Rapier de modo opcional/substituível.

### Stage 102 — Input/assets/presentation

Migrar boundaries preservando lifecycle.

### Stage 103 — World/AI/streaming/scripting

Preservar separação de Domain.

### Stage 104 — Storage/network

Preservar ports e substituição de backend.

### Stage 105 — Tauri/Steam

Transformar Tauri e Steam em platform packages/adapters opcionais.

Exit obrigatório:

- headless não instala/carrega plataforma;
- non-Steam app não exige Steam;
- Cargo/native gates permanecem verdes.

---

## 17. Fase F — presets

### Stage 106 — empty + headless

Provar mínima composição e ausência de DOM/platform dependency.

### Stage 107 — game-2d

Provar jogo sem dependência obrigatória de stack 3D.

### Stage 108 — game-3d

Provar integração oficial renderer/physics/input/assets.

### Stage 109 — desktop-steam

Provar app Steam real sem world/physics/terrain/game-loop obrigatórios quando não necessários.

Exit:

```text
OFFICIAL PRESETS PASS
```

---

## 18. Fase G — developer experience

### Stage 110 — CLI

Comando alvo conceitual:

```bash
projeto-engine create
```

### Stage 111 — templates

Templates oficiais:

```text
Empty
Headless
2D Game
3D Game
Steam Desktop App
```

Projeto recém-criado deve construir sem edição manual obrigatória.

---

## 19. Fase H — distribution

### Stage 112 — Package build

Validar:

- exports;
- `.d.ts`;
- package contents;
- dependency metadata;
- peer/optional dependencies;
- side effects metadata;
- licenses/readmes necessários.

### Stage 113 — External consumer

Obrigatório testar fora do workspace:

```text
pack
install tarball(s)
typecheck
build
run smoke
```

Workspace symlink não é prova suficiente.

### Stage 114 — Official samples

Samples mínimos independentes.

### Stage 115 — Documentation

Documentação pública somente do que realmente existe.

### Stage 116 — Final distribution gate

Saída conceitual:

```text
CORE ....................... PASS
DOMAIN ..................... PASS
FRAMEWORK API .............. PASS
PACKAGE BOUNDARIES ......... PASS
EMPTY PRESET ............... PASS
HEADLESS PRESET ............ PASS
GAME 2D PRESET ............. PASS
GAME 3D PRESET ............. PASS
DESKTOP STEAM PRESET ....... PASS
CLI/TEMPLATES .............. PASS
EXTERNAL CONSUMER .......... PASS
TAURI ...................... PASS
STEAM ...................... PASS

PROJETO_ENGINE FRAMEWORK ... PASS
```

---

## 20. Gates do programa

Baseline atual:

```bash
npm run arch:check
npx tsc --noEmit
npx vitest run
npm run build
```

Native:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Desktop:

```bash
npm run tauri dev
```

ou smoke automatizado equivalente quando existente.

Stages podem adicionar validators, mas não enfraquecer os atuais.

---

## 21. Definition of Done por tipo

### Código

- comportamento implementado;
- focused tests;
- global gates;
- execução Tauri/Rust real quando o escopo exige certificação nativa, sem extrapolar mocks;
- lifecycle limpo;
- sem mudança fora de scope.

### Package extraction

Além do acima:

- owner canônico único;
- exports explícitos;
- nenhum deep import;
- dependency graph válido;
- compat facade testada quando existir.

### Preset

- composition mínima correta;
- preflight PASS;
- start PASS;
- stop/dispose PASS;
- ausência de módulos não selecionados comprovada.

### CLI/template

Projeto gerado:

```text
instala
typechecka
testa
builda
```

e, quando Tauri:

```text
cargo check
```

### Framework final

Somente Stage 116 pode declarar o framework completo.

---

## 22. Failure policy

Um ticket deve ficar bloqueado em vez de produzir falso PASS quando:

- dependency issue ainda não está concluída;
- source of truth é contraditória;
- SDK obrigatório está ausente;
- validation obrigatória não pode ser executada;
- a única forma de continuar violaria boundary/invariant.

Não transformar `BLOCKED` em `PASS`.

---

## 23. Política de performance

Não estabelecer budgets arbitrários sem baseline.

Quando uma stage exigir budget:

1. medir baseline;
2. registrar hardware/profile quando relevante;
3. definir threshold justificável;
4. testar regressão.

Prioridades:

- allocations/frame;
- fixed-step cost;
- render CPU/GPU cost;
- draw calls;
- VRAM/resource count;
- worker lifecycle;
- physics object count;
- listener/subscription leaks;
- cache growth.

---

## 24. Política de compatibilidade

Durante a migração:

- capability IDs existentes são compatibilidade;
- não renomear `game.*` por estética;
- imports antigos podem receber facade temporária;
- cada facade tem owner e condição de remoção;
- package extraction não altera feature behavior;
- breaking changes exigem issue explícita.

---

## 25. Não objetivos do primeiro framework release

Não bloquear o primeiro jogo esperando publicação de packages, CLI ou presets oficiais.

Não bloquear v1 esperando:

- editor visual completo;
- marketplace próprio;
- novo ECS;
- novo renderer;
- novo physics engine;
- backend multiplayer authoritative completo;
- cloud build;
- marketplace de mods;
- engine voxel nova.

Esses itens podem virar programas posteriores.

---

## 26. Critério final de sucesso

O projeto deixa de ser “uma aplicação bem arquitetada” e vira framework quando um repositório externo, sem acesso a `src/**` privado, consegue:

1. instalar packages oficiais;
2. escolher um preset;
3. iniciar e encerrar corretamente;
4. adicionar plugin próprio somente por API pública;
5. criar um jogo 2D ou 3D;
6. criar app desktop Steam;
7. executar headless sem dependências gráficas/nativas desnecessárias;
8. buildar e validar de forma reproduzível.

Esse consumer externo é a prova final.
