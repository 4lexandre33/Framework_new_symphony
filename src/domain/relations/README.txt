PROJETO1 — CAMADA 2 / RELATIONS

Path: src/domain/relations
Camada arquitetural: Camada 2 — Domínio
Status: implementação real iniciada na Etapa 55.

FUNÇÃO
Modelar relações sociais e políticas puramente semânticas:
- facções;
- disposição entre facções;
- reputação de sujeitos perante facções;
- relacionamentos tipados entre sujeitos lógicos.

Nenhuma estrutura depende de posição, renderer, física, networking ou classes
concretas de Agent/WorldObject.

ETAPA 55 — RELATIONS / FACTIONS / REPUTATION

FactionId.ts
- FactionId nominal via DomainId.

Exemplos:
- faction.guild;
- faction.bandits;
- faction.empire;
- faction.merchants.

FactionRelation.ts
Relação direcional:
- sourceFactionId;
- targetFactionId;
- disposition.

FactionDisposition:
- hostile;
- unfriendly;
- neutral;
- friendly;
- allied.

IMPORTANTE
A relação é DIRECIONAL.

guild -> empire = friendly
não implica:
empire -> guild = friendly

A simetria, quando desejada, precisa ser criada explicitamente.

FactionMatrix.ts
Storage:
Map<
  FactionId,
  Map<FactionId, FactionDisposition>
>

Características:
- lookup O(1) médio;
- relações direcionais;
- defaultDisposition configurável;
- default padrão = neutral;
- hasExplicit() distingue entrada real de fallback;
- set/setRelation sobrescrevem relação explicitamente;
- delete remove apenas a direção informada;
- snapshot ordenado por source -> target;
- restore rejeita pares duplicados.

Nenhuma relação é inferida automaticamente.

Reputation.ts
Standing runtime:
- subject lógico;
- factionId;
- min;
- max;
- current.

Defaults:
- min = -100;
- max = 100;
- current = 0.

Subject é opaco:
- ReputationSubjectTypeId;
- ReputationSubjectId;
- ReputationSubjectRef.

Pode representar semanticamente:
- agent/player;
- party;
- account lógico;
- settlement;
- qualquer agregado futuro.

Sem importar Agent, Player, Party ou outros aggregates.

Operações:
- adjust(delta);
- set(value);
- toSnapshot();
- fromSnapshot().

adjust():
- delta inteiro seguro;
- satura no range;
- retorna delta realmente aplicado.

set():
- estrito;
- não faz clamp silencioso.

normalized01:
- converte current para [0, 1] relativo ao range configurado.

Reputation NÃO deriva automaticamente FactionDisposition.
São conceitos diferentes:
- FactionRelation = política facção -> facção;
- Reputation = standing sujeito -> facção.

Relationship.ts
Relação direcional tipada entre sujeitos lógicos.

Tipos:
- RelationshipId;
- RelationshipTypeId;
- RelationshipSubjectTypeId;
- RelationshipSubjectId;
- RelationshipSubjectRef.

Campos:
- id;
- typeId;
- source;
- target;
- strength.

typeId é semanticamente aberto:
- relationship.friend;
- relationship.rival;
- relationship.mentor;
- relationship.family;
- relationship.debt;
- relationship.trust.

strength:
- inteiro seguro;
- range canônico -100..100;
- default 0;
- não define comportamento de gameplay automaticamente.

Operações:
- setStrength();
- adjustStrength();
- toSnapshot();
- fromSnapshot().

Self relationship:
- source e target idênticos são rejeitados.

Direcionalidade:
A -> B não implica B -> A.

PERFORMANCE
FactionMatrix:
- get/set/delete O(1) médio;
- sem alocação no get;
- snapshot cria/sorta arrays somente sob demanda.

Reputation:
- O(1);
- mutação numérica in-place;
- snapshot somente sob demanda.

Relationship:
- O(1);
- mutação numérica in-place;
- sem event dispatch implícito.

INTEGRAÇÃO FUTURA
Esta etapa NÃO conecta automaticamente:
- FactionRelation -> Conditions;
- Reputation -> Conditions;
- Reputation -> Dialogue;
- Reputation -> Quest;
- Relationship -> AI;
- Relationship -> DomainEvents.

A integração entre subdomínios permanece para a Etapa 62.

NÃO IMPLEMENTADO NESTA ETAPA
Etapa 56 — Economy complete permanece intacta:
- CurrencyId;
- CurrencyAccount;
- Cost;
- Reward;
- RewardPolicy;
- LootTable;
- LootEntry;
- CraftingRecipe.

Inventory/Item existentes não são alterados nesta etapa.

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

DIMENSIONALIDADE
Mesmas relações funcionam em:
- 2D;
- 2.5D;
- 3D;
- headless.

PRÓXIMA ETAPA
Etapa 56 — Economy complete.
