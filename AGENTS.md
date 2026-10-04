# Diretivas Arquiteturais e Invariantes do Projeto (AGENTS.md)

Este documento define os limites de autoridade para agentes de IA, assistentes de código e scripts de automação que operam neste repositório.

Ele descreve o estado operacional atual da arquitetura após a migração v20 até a Etapa 25.

## 1. Fonte canônica da arquitetura modular

A árvore de módulos não deve ser duplicada manualmente em documentação, scripts de freeze, smoke tests de governança ou outros guardrails.

A fonte única dos módulos first-party é:

```text
scripts/architecture/module-map.mjs
```

O catálogo canônico descreve:

- módulos funcionais;
- runtimes fundamentais;
- contracts;
- tokens;
- plugins;
- arquivos nativos;
- testes;
- arquivos extras;
- roots físicos da Engine;
- roots públicos;
- roots internos.

A estrutura vigente de cada módulo da Engine segue:

```text
src/engine/<module>/
├── public/
│   └── index.ts
└── internal/
    └── ...
```

Qualquer automação que precise conhecer ownership, roots ou catálogo de módulos deve importar `module-map.mjs` em vez de manter listas paralelas.

## 2. Fronteira `/public` vs `/internal`

`/public` é a fronteira formal do módulo.

Código consumidor deve preferir:

```text
src/engine/<module>/public/index.ts
```

`/internal` contém implementações concretas e não é API pública.

Regras obrigatórias:

1. `engine/X/internal` não importa `engine/Y/internal`.
2. `engine/X/public` não importa `internal`.
3. `plugins/X` pode acessar `engine/X/internal` quando necessário para composição.
4. `plugins/X` não deve acessar `engine/Y/internal`.
5. testes white-box podem acessar `/internal` de forma deliberada.
6. não reexportar classes concretas de `/internal` apenas para contornar boundary errors.
7. não transformar uma implementação concreta em API pública sem decisão arquitetural explícita.

## 3. Core público

A fachada pública do Core é:

```text
src/core/index.ts
```

Consumidores externos devem preferir:

```ts
import { ... } from "@core";
```

Código externo ao Core não deve importar diretamente:

```text
src/core/internal/
src/core/runtime/
```

Exceções devem ficar restritas a código do próprio Core ou testes white-box deliberados.

Nunca resolva uma violação exportando indiscriminadamente todo o conteúdo de `internal`.

## 4. Plugins e capabilities

Plugins vivem em:

```text
src/plugins/<module>/plugin.ts
```

Os manifestos usam a estrutura:

```text
capabilities.provides
capabilities.consumes
capabilities.conflicts
dependsOn
```

Semântica vigente:

- `consumes optional:false` = capability obrigatória;
- `consumes optional:true` = capability opcional;
- `dependsOn` é separado e participa do lifecycle;
- `conflicts` declara incompatibilidades;
- provider ambiguity, semver, ciclos, permissions e conflitos devem ser detectados pelos guardrails/preflight.

Não crie um segundo orquestrador de lifecycle fora do Kernel.

## 5. Lifecycle e preflight

O Kernel é o único coordenador do lifecycle.

Antes do primeiro `setup()`, o preflight arquitetural valida o conjunto de plugins.

Fases relevantes:

```text
setup -> resolving -> ready -> running
```

O shutdown deve preservar inverse shutdown:

```text
BOOT: A -> B -> C
STOP: C -> B -> A
```

Dependências devem permanecer disponíveis enquanto consumidores executam `onStop` e disposers.

Não altere essa propriedade sem testes específicos.

## 6. Freeze arquitetural

O freeze é controlado por:

```text
agents.mjs
tests/freeze-lock.mjs
tests/freeze-invariants.mjs
```

O lock canônico é:

```text
/.freeze-lock.json
```

O path histórico:

```text
tests/.freeze-lock.json
```

não é mais o path canônico. Compatibilidade temporária pode existir apenas para conversão one-shot pelo script de freeze.

Nunca crie novamente dependência operacional do path legado.

### Verificação

```bash
node agents.mjs
```

### Desbloqueio controlado

```bash
node agents.mjs --unlock
```

### Congelamento

```bash
node agents.mjs --lock
```

Não apagar nem editar `.freeze-lock.json` manualmente.

Mudanças em áreas congeladas exigem desbloqueio explícito e novo lock na etapa apropriada.

## 7. Guardrails arquiteturais

Boundary checker:

```bash
node scripts/architecture/check-boundaries.mjs
```

Dependency checker:

```bash
node scripts/architecture/check-dependencies.mjs
```

TypeScript:

```bash
npx tsc --noEmit
```

Uma checagem não deve ser afrouxada apenas para ficar verde.

Se um guardrail encontra uma violação real, corrija a arquitetura ou o consumidor, não o teste que a detectou.

## 8. Testes e smoke tests

Testes funcionais ficam em:

```text
tests/*.test.ts
```

Smoke tests ficam em:

```text
tests/*.mjs
```

Regras:

1. testes white-box podem acessar `/internal`;
2. smoke tests devem usar os paths físicos atuais;
3. não restaurar referências pré-migração como `src/engine/<module>/<arquivo>.ts` quando o arquivo real está em `/internal`;
4. não remover asserts para esconder regressões;
5. testes continuam responsáveis por comportamento e integração, não apenas existência de arquivos.

## 9. Build e execução

No estado atual, o build npm é:

```bash
npm run build
```

e corresponde ao pipeline configurado em `package.json`:

```text
tsc && vite build
```

Não assuma que `arch:check` já está acoplado automaticamente ao build. Essa integração permanente pertence a uma etapa posterior.

Validação Rust:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Runtime Tauri:

```bash
npm run tauri dev
```

Não altere configuração Rust/Tauri para corrigir problema puramente TypeScript sem evidência concreta.

## 10. Regras para movimentação de arquivos

A grande migração física para `/public` e `/internal` já ocorreu.

A partir do estado atual:

- não mover arquivos de Engine por conveniência;
- não reescrever imports em massa sem plano explícito;
- não ressuscitar paths antigos;
- não criar aliases ad hoc para esconder paths quebrados;
- mudanças estruturais futuras devem passar novamente por inventário, plano e validação.

Scripts históricos de migração permanecem auditáveis e não devem ser apagados apenas por estarem concluídos.

## 11. Diretórios conceituais

As áreas:

```text
src/domain/
src/services/
src/app/flows/
```

foram criadas como estrutura futura.

Enquanto não houver implementação real:

- preservar seus `README.txt`;
- não criar `.ts` vazios;
- não criar entidades, use cases ou FSMs fictícios apenas para preencher pastas.

Implementações futuras das Camadas 2 e 3 pertencem a fase posterior.

## 12. Documentação histórica

READMEs de patches antigos podem permanecer como histórico.

Exemplos de documentação histórica não devem ser reescritos automaticamente apenas porque mencionam paths antigos.

Quando houver conflito entre documentação histórica e estado operacional, prevalecem:

1. código/configuração atual;
2. `module-map.mjs`;
3. guardrails executáveis;
4. este `AGENTS.md`;
5. `README.md`.

## 13. Proibições para agentes

Agentes e automações não devem:

- duplicar manualmente o catálogo completo de módulos;
- mover arquivos sem escopo arquitetural explícito;
- importar implementação privada de outro módulo;
- expor classes internas para “resolver” um import;
- remover validações para deixar CI/testes verdes;
- alterar journals históricos como se fossem configuração atual;
- tratar READMEs históricos como fonte canônica;
- editar o freeze manualmente;
- criar placeholders TypeScript vazios;
- introduzir alocações desnecessárias dentro de game loops críticos;
- criar um segundo lifecycle manager paralelo ao Kernel.

## 14. Performance e runtime de jogo

Código de runtime deve preservar boas práticas de engine:

- evitar alocações por frame quando possível;
- separar fixed update de render update quando aplicável;
- manter ownership claro de timers, listeners e resources;
- usar disposers/scope do lifecycle;
- não registrar listeners globais sem remoção;
- não ocultar trabalho caro dentro de getters usados por frame;
- considerar draw calls, memória e pressão de GC ao alterar sistemas 3D.

## 15. Tauri e desktop

A aplicação alvo é desktop via Tauri.

Ao alterar integração nativa:

- manter fronteira TypeScript ↔ Rust explícita;
- validar comandos Tauri e payloads;
- evitar expor operações nativas inseguras diretamente a UI;
- preservar compatibilidade com Steam quando aplicável;
- validar `cargo check`;
- validar `npm run tauri dev` quando a mudança tocar runtime nativo.

## 16. Sequência mínima de validação arquitetural

Antes de considerar uma alteração arquitetural válida:

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

Falhas estruturais devem ser corrigidas antes de avançar para validações funcionais que dependem delas.

## 17. Princípio de autoridade

O objetivo dos guardrails é preservar a arquitetura, não congelar erros.

Quando uma regra, teste ou freeze divergir do estado arquitetural aprovado:

- identificar a fonte canônica;
- corrigir o consumidor ou guardrail correto;
- preservar a intenção arquitetural;
- registrar mudanças relevantes;
- não usar bypass silencioso.

