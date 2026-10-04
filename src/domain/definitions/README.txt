PROJETO1 — CAMADA 2 / DEFINITIONS

Path: src/domain/definitions
Camada arquitetural: Camada 2 — Domínio
Status: implementação real iniciada na Etapa 60.

FUNÇÃO
Centralizar definições estáticas e suas referências sem acoplar gameplay a
arquivos, assets, engine, DI container ou plataforma.

MODELO

DefinitionKindId
Identifica uma categoria de definição.

Exemplos:
- definition-kind.item;
- definition-kind.quest;
- definition-kind.ability;
- definition-kind.progression-curve.

DefinitionId
Identifica uma entrada dentro de um DefinitionKindId.

DefinitionId NÃO precisa ser globalmente único.

Exemplo válido:
kind A + definitionId "common"
kind B + definitionId "common"

A identidade completa é:
DefinitionKindId + DefinitionId

DefinitionRef.ts
Referência estável:
- kindId;
- definitionId.

DefinitionRef<TDefinition> possui tipagem phantom somente em compile-time.
Runtime continua contendo apenas os dois IDs.

APIs:
- createDefinitionRef();
- definitionRefToSnapshot();
- definitionRefFromSnapshot();
- sameDefinitionRef().

DefinitionValidator.ts
Contrato de validação pura.

DefinitionValidator<T>:
- id;
- validate(context).

Context:
- kindId;
- definitionId;
- value readonly.

Validator retorna zero ou mais findings:
- code;
- message.

runDefinitionValidators():
- executa validators;
- valida findings;
- anexa validatorId/kindId/definitionId;
- ordena issues deterministicamente;
- retorna array readonly.

Validators NÃO:
- mutam GameDefinitions;
- consultam filesystem;
- consultam engine;
- fazem side effects.

DefinitionSet.ts
Registry imutável de UM kind.

Entrada:
DefinitionSetEntry<T> {
  id,
  value
}

Construtor:
- exige ao menos uma definição;
- rejeita DefinitionId duplicado;
- rejeita DefinitionValidatorId duplicado;
- ordena validators;
- ordena entries;
- valida todas as definições antes de concluir;
- qualquer finding reprova a construção.

Depois do construtor o catálogo é read-only.

APIs:
- size;
- has();
- get();
- require();
- getDefinitionIds();
- createRef();
- forEach().

Lookup:
Map<DefinitionId, Definition>

Complexidade média:
- has/get/require O(1);
- getDefinitionIds O(1), array pré-calculado;
- createRef O(1).

O valor da definição é armazenado como Readonly<T> na API.
O sistema NÃO tenta deep-freeze arbitrariamente objetos recebidos, pois isso
poderia alterar ownership externo e introduzir travessias/alocações ocultas.

Portanto:
definições devem ser construídas como dados estáticos tratados como readonly.

GameDefinitions.ts
Registry imutável de DefinitionSets.

Storage:
Map<DefinitionKindId, DefinitionSetView>

Construtor:
- recebe todos os sets;
- rejeita kind duplicado;
- pré-calcula kindIds ordenados.

APIs:
- kindCount;
- hasKind();
- has();
- getKindIds();
- getSet();
- requireSet();
- resolve(ref);
- require(ref);
- hasDefinition().

resolve():
- kind inexistente => null;
- definition inexistente => null.

require():
- kind inexistente => erro;
- definition inexistente => erro.

DETERMINISMO
- DefinitionSet IDs ordenados;
- validators ordenados por validatorId;
- issues ordenadas;
- GameDefinitions kind IDs ordenados;
- nenhuma dependência de ordem de Map para outputs públicos ordenados.

TIPAGEM
DefinitionRef<T> permite transportar a expectativa de tipo no TypeScript.

GameDefinitions.resolve<T>(ref):
- retorna Readonly<T> | null.

O phantom type não existe em runtime.
A consistência semântica entre um kindId e seu T deve ser definida pela camada
de composição/autoria.

LIMITES DE RESPONSABILIDADE
Definitions NÃO executa gameplay.

Não:
- instancia Agent;
- adiciona Item em Inventory;
- ativa Quest;
- concede Reward;
- executa Ability;
- avalia Condition;
- publica DomainEvent;
- acessa renderer/physics.

Também não substitui IDs específicos existentes.
ItemId, QuestId, AbilityId etc. continuam válidos dentro de seus subdomínios.

A Etapa 62 poderá estabelecer mapeamentos/referências cross-domain explícitos.

PERFORMANCE
Este subsistema é pensado para bootstrap/autoria/load de definições, não para
trabalho por frame.

Após construção:
- lookup médio O(1);
- arrays ordenados são reutilizados;
- nenhum sort em get/resolve/require.

PORTABILIDADE
Zero dimensionalidade.
Funciona igual em:
- 2D;
- 2.5D;
- 3D;
- headless.

LIMITE DE ETAPA
A Etapa 61 permanece intacta.
Nenhum subsistema global de classificação semântica é criado nesta etapa.

Também NÃO implementado:
- cross-domain integration;
- save/restore runtime generalizado;
- RNG oficial;
- ports adicionais.

DEPENDÊNCIAS PROIBIDAS
- src/core/**
- src/engine/**
- src/services/**
- src/app/**
- src/plugins/**
- stack gráfica/física/nativa concreta.

PRÓXIMA ETAPA
Etapa 61 — Tags.
