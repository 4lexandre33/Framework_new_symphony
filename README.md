# Projeto1

Projeto desktop de jogo 3D baseado em TypeScript, Three.js, Tauri e Rust, estruturado em torno de um microkernel modular com plugins, capabilities, contratos tipados e fronteiras explícitas entre API pública e implementação interna.

Este README descreve o estado operacional atual do repositório: arquitetura v20, Domain (Layer 2) documentado até a Stage 69 e Layer 1 certificada por stages até a Stage 88 e documentada na Stage 89. O gate final da Layer 1 foi executado na Stage 90 (ver `ETAPA90_LAYER1_FINAL_GATE.txt`).

A documentação técnica está em:

- `docs/layer1/README.md` — Layer 1 (engine, runtime, Tauri/Steam, projetos consumidores, validação);
- `docs/layer2/README.md` — Layer 2 (Domain);
- `AGENTS.md` — regras permanentes de engenharia;
- `WORKFLOW.md` — processo do Symphony;
- `SPEC.md` — destino, roteiro de stages e critérios de aceite.

## Stack principal

- TypeScript
- Three.js
- Vite
- Vitest
- Tauri 2
- Rust
- Rapier 3D
- Steam integration via host Tauri/Rust

## Requisitos de desenvolvimento

Tenha disponíveis no ambiente:

- Node.js
- npm
- Rust toolchain
- Cargo
- dependências exigidas pelo Tauri para Windows
- em Linux, os pacotes de sistema do Tauri 2 (lista verificada em `docs/layer1/native-tauri-steam.md`)
- Steam instalado quando estiver validando funcionalidades Steam

Instale as dependências JavaScript:

```bash
npm install
```

## Execução web

Servidor de desenvolvimento Vite:

```bash
npm run dev
```

Preview do build web:

```bash
npm run preview
```

## Execução desktop com Tauri

Modo de desenvolvimento:

```bash
npm run tauri dev
```

O host nativo vive em:

```text
src-tauri/
```

As integrações nativas relevantes incluem Steam, Overlay, Security, Modding e Monetization.

## Build

Build TypeScript + Vite:

```bash
npm run build
```

O script `build` executa, nesta ordem:

```text
npm run arch:check && tsc && vite build
```

Ou seja, o build falha se qualquer fronteira arquitetural ou dependência de plugin estiver inválida.

Release nativo do Tauri (detalhes, evidências e pré-requisitos em `docs/layer1/native-tauri-steam.md`):

```bash
npx tauri build --no-bundle --config src-tauri/tauri.stage88.conf.json
```

Build/check do host Rust:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

## Testes

Bateria Vitest:

```bash
npm test
```

Equivalente:

```bash
npx vitest run
```

Type-check isolado:

```bash
npx tsc --noEmit
```

Testes específicos podem ser executados diretamente, por exemplo:

```bash
npx vitest run tests/ui-system.test.ts
```

Smoke test de UI exposto no `package.json`:

```bash
npm run test:ui:smoke
```

Os smoke tests adicionais estão em:

```text
tests/*-smoke-test.mjs
```

Cada stage de certificação da Layer 1 expõe seus validadores como scripts npm (`stage85:validate` até `stage89:validate`, além de `audit`, `smoke` e `finalize` quando existem). A lista completa e o significado de cada um estão em `docs/layer1/validation-evidence.md`.

## Arquitetura

A arquitetura modular do Engine usa separação física entre API pública e implementação privada:

```text
src/engine/<module>/
├── public/
│   └── index.ts
└── internal/
    └── ...
```

### Regra de fronteira

Código externo a um módulo deve consumir a fachada pública quando aplicável:

```text
src/engine/<module>/public/index.ts
```

Implementações concretas permanecem em:

```text
src/engine/<module>/internal/
```

Testes white-box podem acessar `/internal` deliberadamente.

Plugins do próprio módulo podem instanciar sua implementação interna, mas não devem usar implementações internas de outros módulos como API pública.

## Core

A fachada pública do microkernel está em:

```text
src/core/index.ts
```

Consumidores externos devem preferir:

```ts
import { ... } from "@core";
```

O alias `@core` é configurado no TypeScript/Vite.

Código externo não deve importar diretamente:

```text
src/core/internal/
src/core/runtime/
```

salvo código pertencente ao próprio Core ou testes explicitamente white-box.

## Plugins e capabilities

Plugins vivem em:

```text
src/plugins/<module>/plugin.ts
```

Os manifestos preservam a estrutura:

```text
capabilities.provides
capabilities.consumes
capabilities.conflicts
dependsOn
```

Semântica usada:

- `consumes` com `optional: false` representa dependência obrigatória;
- `consumes` com `optional: true` representa dependência opcional;
- `dependsOn` permanece separado e participa da ordem de lifecycle;
- conflitos são validados antes do primeiro `setup()`.

O Kernel continua sendo o único orquestrador do lifecycle.

## Lifecycle do Kernel

O boot arquitetural passa por preflight antes do primeiro `setup()`.

Fases relevantes:

```text
setup
resolving
ready
running
```

O shutdown preserva a ordem inversa do boot.

Exemplo:

```text
BOOT: A -> B -> C
STOP: C -> B -> A
```

Dependências permanecem vivas enquanto consumidores executam `onStop` e seus disposers.

## Fonte canônica dos módulos

A árvore modular não deve ser duplicada em scripts ou documentação operacional.

A fonte única é:

```text
scripts/architecture/module-map.mjs
```

Ela descreve os módulos first-party, runtimes fundamentais, contracts, tokens, plugins, arquivos nativos, testes e roots físicos da Engine.

No estado atual, os guardrails reconhecem 23 módulos canônicos.

## Guardrails arquiteturais

### Boundaries

```bash
node scripts/architecture/check-boundaries.mjs
```

Fiscaliza, entre outras regras:

- um módulo não importa `/internal` de outro módulo;
- `/public` não importa `/internal`;
- plugins só acessam implementações internas permitidas;
- Core externo usa sua fachada pública;
- testes podem ser white-box quando deliberado.

### Grafo de dependências

```bash
node scripts/architecture/check-dependencies.mjs
```

Valida providers, consumers obrigatórios/opcionais, conflitos, semver, `dependsOn`, ciclos e ambiguidades arquiteturais.

### Guardrail agregado

```bash
node agents.mjs
```

Executa os guardrails de freeze/invariantes atualmente integrados ao orquestrador.

## Freeze arquitetural

O lock canônico é:

```text
/.freeze-lock.json
```

Comandos:

Verificar:

```bash
node agents.mjs
```

Desbloquear antes de uma mudança autorizada em área congelada:

```bash
node agents.mjs --unlock
```

Gerar/atualizar o lock:

```bash
node agents.mjs --lock
```

Não edite manualmente `.freeze-lock.json`.

A regeneração final do freeze da arquitetura v20 deve ocorrer somente quando a sequência de validação correspondente estiver verde.

## Camadas 2, 3 e 4

As camadas acima da engine já possuem implementação real:

```text
src/domain/       Layer 2 — regras e estado semântico (docs/layer2/README.md)
src/services/     Layer 3 — casos de uso e orquestração
src/app/          Layer 4 — bootstrap, composição e fluxos (src/app/flows)
```

`src/domain/**` não depende de Three.js, Rapier, DOM, Tauri, Steamworks, `src/engine/**`, `src/plugins/**`, `src/services/**` nem `src/app/**`. As áreas que ainda tiverem apenas um README.txt explicativo não devem receber classes TypeScript vazias apenas para completar a árvore.

Um jogo ou aplicativo é um consumidor da engine e vive em `src/projects/<nome>/`, selecionado por `src/project.ts`. Ver `docs/layer1/consumer-projects.md`.

## Diretórios principais

```text
src/
├── app/             composition/bootstrap e flows
├── components/      UI de aplicação
├── contracts/       contratos tipados dos sistemas
├── core/            microkernel
├── debug/           tooling/diagnósticos
├── domain/          Layer 2: regras e estado semântico
├── engine/          módulos técnicos
├── plugins/         adaptação dos módulos ao Kernel
├── project.ts       composição local do projeto consumidor ativo
├── projects/        projetos consumidores (jogos/apps), um diretório por projeto
├── services/        casos de uso e orquestração
└── tokens/          capability tokens

src-tauri/            host desktop Rust/Tauri
tests/                testes funcionais e smoke tests
scripts/architecture/ governança, migração e validadores das stages
docs/                 documentação técnica (layer1, layer2)
.github/workflows/    certificação das stages no CI
.agents/skills/       skills de apoio para agentes
```

## Fluxo recomendado antes de considerar uma mudança válida

Para mudanças TypeScript/arquiteturais:

```bash
node scripts/architecture/check-boundaries.mjs
node scripts/architecture/check-dependencies.mjs
npx tsc --noEmit
```

Depois, conforme o escopo:

```bash
npx vitest run
cargo check --manifest-path src-tauri/Cargo.toml
npm run build
npm run tauri dev
```

Não pule uma falha estrutural apenas para fazer testes funcionais ficarem verdes.

## Migração arquitetural v20

O repositório contém scripts e journals da migração em:

```text
scripts/architecture/
.migration/
```

Esses artefatos são parte da trilha auditável da reestruturação.

Não remova scripts permanentes de governança apenas porque a migração principal já ocorreu.

READMEs históricos de correções e patches podem permanecer como registro histórico. Eles não constituem a fonte atual da arquitetura quando divergirem deste README, do `AGENTS.md` ou do `scripts/architecture/module-map.mjs`.

## Fontes operacionais de verdade

Em caso de dúvida, a precedência operacional é:

1. código e configuração atuais;
2. `scripts/architecture/module-map.mjs`;
3. guardrails executáveis;
4. `AGENTS.md`;
5. este `README.md`;
6. READMEs históricos de patches.

