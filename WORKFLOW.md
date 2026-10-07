---
tracker:
  kind: linear
  provider:
    project_slug: "framework-new-symphony-ae732ad971cc"
  required_labels:
    - symphony
  active_states:
    - Todo
    - In Progress
    - Rework
    - Merging
  terminal_states:
    - Done
    - Closed
    - Cancelled
    - Canceled
    - Duplicate

polling:
  interval_ms: 15000

workspace:
  root: ~/code/projeto-engine-symphony

hooks:
  after_create: |
    set -eu
    : "${PROJECT_REPO_URL:?PROJECT_REPO_URL must be set}"
    git clone "$PROJECT_REPO_URL" .

agent:
  max_concurrent_agents: 1
  max_turns: 12
---

# Projeto_Engine — Symphony Workflow

Você está trabalhando no ticket `{{ issue.identifier }}` do Projeto_Engine. **Prioridade atual:** certificar a engine técnica e permitir que um jogo seja criado sobre ela (ENGINE GAME-READY). **Visão futura:** distribuí-la como framework para jogos/aplicações. Consulte o marco §12.1 e o roadmap 85–116 em `SPEC.md`.

{% if attempt %}
Esta é a tentativa/continuação #{{ attempt }}. Continue a partir do workspace atual. Não repita investigação, implementação ou validação já concluída sem necessidade concreta.
{% endif %}

## Ticket

**ID:** {{ issue.identifier }}
**Título:** {{ issue.title }}
**Estado:** {{ issue.state }}
**Labels:** {{ issue.labels }}
**URL:** {{ issue.url }}

### Descrição

{% if issue.description %}
{{ issue.description }}
{% else %}
O ticket não possui descrição. Só implemente se objetivo e critérios puderem ser determinados com segurança a partir do título, `SPEC.md` e código atual.
{% endif %}

## Contrato do repositório

Trabalhe somente no workspace fornecido pelo Symphony.

O repositório possui três documentos de controle canônicos:

- `WORKFLOW.md`: processo do Symphony e política de execução.
- `AGENTS.md`: invariantes permanentes de engenharia e validação.
- `SPEC.md`: GAME-READY intermediário, framework futuro, arquitetura-alvo, stages e critérios de aceite.

Não crie `ROADMAP.md`, `TASKS.md`, `tasks.json`, `CONTEXT.md`, `HANDOFF.md`, `BLUEPRINT.md`, `MACHINE_CONTEXT.json`, `DEFINITION_OF_DONE.md` ou documentos equivalentes para duplicar informação.

O Linear é a fonte de verdade para fila, dependências, estado, prioridades, progresso, handoff, bloqueios e PRs. O Git + código + validators executáveis são a fonte de verdade para o estado técnico.

## Antes de qualquer alteração

1. Leia o ticket completo.
2. Leia `AGENTS.md`.
3. Leia somente as seções de `SPEC.md` relevantes ao ticket.
4. Inspecione o código real antes de assumir que o snapshot histórico continua correto.
5. Determine escopo, arquivos prováveis, contratos afetados, testes e riscos.
6. Confirme o estado Git.
7. Reproduza ou prove o estado atual antes da primeira alteração quando houver correção ou migração de comportamento.

Não inicie refatoração ampla apenas porque ela parece conveniente.

## Workpad único no Linear

Mantenha exatamente um comentário persistente chamado `## Codex Workpad`.

Use:

```markdown
## Codex Workpad

### Plan
- [ ] ...

### Acceptance
- [ ] ...

### Validation
- [ ] ...

### Notes
- ...
```

Atualize o mesmo comentário durante toda a execução. Não crie comentários de progresso separados. O workpad é o handoff entre tentativas do Symphony.

## Regra de escopo

Implemente apenas o ticket atual.

Se encontrar trabalho relevante fora do escopo:

1. não expanda silenciosamente o ticket;
2. crie nova issue no mesmo projeto;
3. coloque em `Backlog`;
4. aplique label `symphony`;
5. descreva objetivo, contexto, acceptance criteria e validation;
6. relacione ao ticket atual;
7. registre `blockedBy` quando houver dependência real.

Não crie arquivos locais de backlog para substituir o tracker.

## Programa e prioridade de issues

O roteiro normativo é `SPEC.md`; **não presumir etapas concluídas**. Trabalhe apenas na issue elegível.

1. Priorizar validação real de Ubuntu/Tauri/Rust e integração de bootstrap, input, fixed tick/física, world, renderer e lifecycle com uma pequena cena de referência.
2. Construir composição de jogo por APIs públicas; não criar segundo Kernel/loop, Domain paralelo nem API/package antecipado de Stage 98. É permitido protótipo antes do gate; não declarar GAME-READY sem §12.1.
3. Certificar Layer 1 Stages 85–90, aproveitando evidências reais. Não marcar PASS sem execução exigida.
4. Depois executar Stage 91 *read-only* e productização incremental Stages 92–116 conforme dependências do Linear (`blockedBy`).
5. Issues bloqueadas não devem ser forçadas a avançar; dependências de produto e de distribuição podem formar trilhas distintas quando não se bloqueiam.

Se este ticket for o ticket de bootstrap/decomposição do programa:

1. leia `SPEC.md` inteiro;
2. inspecione o checkout atual;
3. determine a primeira etapa ainda não concluída de fato;
4. crie as issues necessárias no Linear;
5. use `blockedBy` para representar o DAG;
6. prefira unidades verificáveis e revisáveis;
7. não replique uma task para cada bullet da SPEC quando puderem ser entregues com segurança juntas;
8. não implemente código no mesmo ticket de planejamento, salvo exigência explícita.

## Regra adicional — projetos consumidores e vibecoding

Em tickets de cenas, gameplay, câmeras específicas, exemplos ou aplicações,
concentre novas implementações em `src/projects/<nome>/**` e na seleção
explícita de `src/project.ts`. A engine (`src/core`, `src/engine`,
`src/plugins`) permanece reutilizável e ignorante do conteúdo do produto.
Um plugin de projeto apenas faz o wiring de ports, adapters e lifecycle;
não recebe lógica de jogo específica. Se a API pública não atender, abra
issue separada para contrato/adapters e não cruze `/internal` nem mude
freeze. Verifique substituição do projeto por outro ou pelo host vazio.

## Política arquitetural

A transformação é incremental.

Não:

- reescreva o Kernel;
- crie segundo lifecycle;
- crie segundo capability registry;
- duplique event/command/query infrastructure;
- substitua Three.js/Rapier/Tauri/Steam apenas por estética;
- faça big-bang migration;
- mova dezenas de módulos para packages sem boundary audit;
- misture extração de package com feature nova.

Productizar significa estabilizar, extrair, empacotar, configurar e provar consumo externo da arquitetura existente.

## Implementação

Durante implementação:

- use TypeScript estrito;
- não introduza placeholders;
- não deixe `TODO` no lugar do comportamento exigido;
- não use `any` novo sem boundary inevitável e justificativa;
- preserve APIs/capabilities quando o ticket não autoriza breaking change;
- não acesse `/internal` de outro módulo;
- não introduza alocação relevante em hot path;
- não faça física dependente do frame rate;
- trate Tauri IPC como boundary de segurança;
- mantenha Steam opcional e fora do Domain;
- todo recurso adquirido deve ter teardown correspondente.

Leia `AGENTS.md` para as invariantes completas.

## Validação

Comece por validação focada.

Baseline global:

```bash
npm run arch:check
npx tsc --noEmit
npx vitest run
npm run build
```

Se Rust/Tauri foi tocado:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Se runtime desktop foi tocado, execute o smoke desktop disponível ou `npm run tauri dev` quando o ambiente permitir.

Não altere validators/testes apenas para obter verde. `cargo check` ou testes Steam mockados não comprovam, sozinhos, um smoke Tauri/Steam real. Para o gate GAME-READY, reporte evidência real ou BLOCKED.

Se um gate falhar por problema preexistente não relacionado, prove, registre no workpad e crie issue separada quando necessário.

## Economia de contexto, RTK e segurança

- Use pesquisa dirigida por símbolos (`repo-context`) e uma Skill específica conforme tarefa; não despeje o repositório inteiro no contexto.
- Teste focado durante desenvolvimento; suíte global uma vez após a última alteração, repetindo se novas mudanças forem feitas.
- RTK, quando disponível no host, compacta saídas de terminal, **não** substitui testes. Para falhas ambíguas, repita comando sem RTK para recuperar o log integral.
- Não reinstale/edite hooks e permissões globais de `~/.codex` por issue. Não exponha credenciais em outputs, Workpad ou commits.
- `rtk gain` relata economia estimada de saída, não redução garantida de 80% de todos os tokens; não ocultar erros para melhorar métricas.

## Git e PR

Antes de editar:

```bash
git status --short
git log -1 --oneline
```

Não use `git reset --hard`, `git clean -fdx` ou comandos destrutivos sem instrução explícita.

Antes do push:

- execute validação exigida;
- execute `git diff --check`;
- revise o diff;
- confirme ausência de temporários/secrets.

O PR deve representar uma unidade coerente do ticket.

## Estado da issue

- `Backlog`: não implemente.
- `Todo`: mova para `In Progress`, crie/reuse o workpad e execute.
- `In Progress`: continue do workpad/workspace.
- `Human Review`: não faça novas alterações; aguarde.
- `Rework`: releia ticket + feedback, atualize o plano e corrija.
- `Merging`: finalize integração/merge e só então mova para `Done`.
- `Done`: nenhuma ação.

## Bloqueio verdadeiro

Pare somente por bloqueio externo real: credencial, permissão, SDK/ferramenta obrigatória, dependency issue não concluída ou ambiente incapaz de executar validação obrigatória não substituível.

Antes de bloquear, tente alternativas seguras, registre evidência e descreva a ação exata necessária.

## Completion bar

Antes de mover para `Human Review`, confirme no workpad:

- [ ] objetivo implementado;
- [ ] acceptance criteria atendidos;
- [ ] focused validation executada;
- [ ] gates globais aplicáveis verdes;
- [ ] Cargo/Tauri/Steam validation executada quando aplicável; mocks claramente diferenciados de execução real;
- [ ] para ENGINE GAME-READY: smoke integrado, lifecycle e validação no ambiente alvo comprovados;
- [ ] diff revisado;
- [ ] nenhuma mudança fora do escopo;
- [ ] documentação canônica atualizada somente se contrato/arquitetura mudou;
- [ ] PR/commit corresponde ao trabalho descrito.

A mensagem final do agente deve ser curta: trabalho concluído, validação e bloqueios reais. O Linear/Symphony controla o que vem depois.
