PROJETO1 — CAMADA 2 / EVALUATION

Path: src/domain/evaluation
Camada arquitetural: Camada 2 — Domínio
Status: implementação real expandida na Etapa 50.

FUNÇÃO
Avaliar resultados, condições e predicados de gameplay de forma pura,
determinística e independente de renderer, física, scripting ou infraestrutura.

IMPLEMENTAÇÃO ATUAL

DomainResult.ts
- DomainResult<TValue, TError>;
- domainOk();
- domainErr();
- mapDomainResult();
- flatMapDomainResult().

ConditionId.ts
- branded DomainId<"condition">.

ComparisonOperator.ts
Operadores:
- equals;
- not-equals;
- greater-than;
- greater-or-equal;
- less-than;
- less-or-equal;
- contains.

SEMÂNTICA DOS OPERADORES
equals/not-equals:
- aceitam qualquer StateValue;
- usam igualdade estrutural determinística.

greater-than / greater-or-equal / less-than / less-or-equal:
- aceitam somente number x number;
- tipos incompatíveis retornam DomainResult failure.

contains:
- string contains string;
- array contains StateValue por igualdade estrutural;
- outros operandos retornam failure.

Comparação incompatível NÃO lança exception no fluxo de gameplay.

ConditionExpression.ts
Tipos de nó:
- literal;
- state-exists;
- state-compare;
- all;
- any;
- not.

Conditions são DADOS.
Não são closures, callbacks, eval(), script source ou funções armazenadas.

ConditionDefinition:
- ConditionId;
- expression.

createConditionDefinition():
- valida árvore;
- rejeita ciclos;
- rejeita all/any vazios;
- limita profundidade a 128;
- copia/congela profundamente valores de comparação;
- retorna definição imutável.

BUILDERS
- createLiteralCondition();
- createStateExistsCondition();
- createStateCompareCondition();
- createAllCondition();
- createAnyCondition();
- createNotCondition().

ConditionEvaluator.ts
- recebe ConditionDefinition + StateStore;
- retorna DomainResult<boolean, ConditionEvaluationError>;
- state ausente em state-compare => false;
- state-exists distingue ausência explicitamente;
- all/any usam short-circuit;
- not inverte resultado;
- erro de comparação é retornado, não mascarado.

EXEMPLOS CONCEITUAIS

Door aberta:
state-compare(
  door.castle.open,
  equals,
  true
)

Jogador tem nível suficiente:
state-compare(
  player.level,
  greater-or-equal,
  10
)

Flag presente:
state-exists(
  quest.intro.accepted
)

Composição:
all(
  powerRestored,
  not(bossAlive),
  hasAccess
)

TAGS
O roadmap maior prevê avaliação de tags, porém o sistema canônico
DomainTag/TagSet pertence à Etapa 61.

A Etapa 50 NÃO cria TagSet temporário nem API paralela.
Enquanto isso, contains pode avaliar arrays/string existentes em StateValue.
Integração direta Condition <-> TagSet será feita somente quando Tags existir.

DETERMINISMO
- nenhuma leitura de wall clock;
- nenhuma geração aleatória;
- nenhuma consulta de engine;
- nenhuma closure arbitrária;
- StateStore é o único contexto runtime desta etapa;
- mesma definição + mesmo StateStore => mesmo resultado.

PERFORMANCE
- all/any fazem short-circuit;
- state lookup usa Map do StateStore;
- evaluation não cria snapshots;
- equals faz comparação estrutural apenas quando necessário;
- definitions são validadas/congeladas uma vez na criação;
- nenhuma Condition executa automaticamente por frame.

DEPENDÊNCIAS PROIBIDAS
- src/core/**
- src/engine/**
- src/services/**
- src/app/**
- src/plugins/**
- Three.js
- Babylon.js
- Rapier
- WebGL
- DOM
- Tauri
- Steamworks SDK
- eval / Function constructor
- scripting concreto

DIMENSIONALIDADE
Conditions operam sobre significado/facts.
A mesma árvore funciona em jogos 2D, 2.5D, 3D e headless.

PRÓXIMA ETAPA
Etapa 51 — Status Conditions / Effects.
