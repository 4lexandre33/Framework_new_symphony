PROJETO1 — CAMADA 2 / CROSS-DOMAIN INTEGRATION

Path: src/domain/integration
Camada arquitetural: Camada 2 — Domínio
Status: implementação real iniciada na Etapa 62.

OBJETIVO
Conectar explicitamente subdomínios que já estavam completos e isolados.

A Etapa 62 NÃO transforma os subdomínios em dependências circulares.
As dependências cruzadas ficam concentradas neste diretório de integração.

FLUXOS IMPLEMENTADOS

1. LOCATION -> DOMAIN EVENT
LocationEventIntegration.ts

createLocationEnteredEvent():
- recebe DomainEventId;
- sequence;
- SimulationTick;
- LocationRef atual;
- LocationRef anterior opcional.

Produz DomainEvent:
typeId = "location.entered"

Metadata:
source.typeId = "location"
source.sourceId = LocationId atual

Payload:
- locationId;
- previousLocationId.

Nenhum publish é realizado.

2. CONDITIONS -> STATE
ConditionStateIntegration.ts

resolveConditionsFromState():
- recebe ConditionDefinition[];
- StateStore;
- ConditionEvaluator opcional.

Retorna DomainResult com:
- ConditionId;
- satisfied.

O StateStore não é alterado.

ConditionId duplicado no batch é erro estrutural.

3. INTERACTION -> CONDITIONS -> STATE
InteractionConditionIntegration.ts

InteractionRequirementId é ligado explicitamente a ConditionDefinition.

Fluxo:
Affordance requirement
-> binding
-> ConditionEvaluator
-> StateStore
-> InteractionRequirementResolution
-> resolveInteractionOutcome()

A interação continua sendo somente autorizada/rejeitada.
Nenhuma ação concreta é executada.

Bindings:
- duplicados = erro estrutural;
- requirement desconhecido = erro estrutural;
- requirement sem binding = DomainResult error;
- erro de comparação da Condition = DomainResult error.

4. STATUS EFFECTS -> DOMAIN TIME
StatusEffectTimeIntegration.ts

advanceStatusEffectsByTime():
- recebe StatusEffectSet;
- DomainDuration;
- chama avanço determinístico existente;
- reporta activeBefore;
- activeAfter;
- expiredNow.

Não prune effects automaticamente.

5. QUEST -> STATE / DOMAIN EVENTS
QuestIntegration.ts

createQuestStateProjection():
- converte QuestState para StateValue serializável.

projectQuestStateToState():
- grava a projeção em StateKey fornecida pelo chamador.

createQuestUpdatedEvent():
- produz DomainEvent "quest.updated";
- source = QuestId;
- payload contém previousStatus + projeção atual.

Nenhum event bus é chamado.

6. REWARD -> INVENTORY / CURRENCY
RewardGrantIntegration.ts

grantRewardAtomically():
- recebe Reward;
- Inventory;
- CurrencyAccount[];
- Map<ItemId, Item>.

PRE-FLIGHT antes de qualquer mutação:
- todas as CurrencyAccounts necessárias existem;
- não há overflow de saldo;
- todas as definições Item existem;
- chave do map corresponde ao Item.id;
- definição existente no Inventory não conflita;
- quantidades não estouram inteiro seguro;
- totalUnits não estoura;
- capacidade de slots considera TODAS as entradas do Reward em conjunto.

Somente após todas as validações:
- moedas são creditadas;
- itens são adicionados.

Resultado:
granted = true/false

Rejeição não altera Inventory nem CurrencyAccount.

7. PROGRESSION -> UNLOCK SET
ProgressionUnlockIntegration.ts

ProgressionUnlockPlan:
- LevelUnlockRule[];
- level inteiro >= 1;
- UnlockId único;
- ordem canônica por level + UnlockId.

applyProgressionUnlocks():
- lê LevelProgression.currentLevel;
- aplica regras alcançadas em UnlockSet;
- retorna newlyUnlocked;
- retorna alreadyUnlocked.

Não adiciona XP.
Não altera ProgressionCurve.
Não interpreta UnlockId como skill/recipe concretos.

HEADLESS
Os testes da etapa executam cenários sem renderer, DOM, input, física ou
plataforma:

Location -> Event
State -> Condition -> Interaction
Reward -> Inventory/Currency
XP -> Level -> Unlock
Quest -> State/Event
DomainDuration -> StatusEffect expiry

DETERMINISMO
- nenhum relógio global;
- nenhum RNG;
- event sequence/tick/id vêm do chamador;
- State/Condition são inputs explícitos;
- Reward grant usa preflight determinístico;
- Unlock rules são ordenadas deterministicamente.

PERFORMANCE
Integrações são operações discretas de gameplay.

Nenhuma delas deve ser chamada como trabalho de render por frame sem motivo.

Hot paths preservados:
- lookups Map/Set;
- effects avançam in-place;
- Reward usa uma fase de preflight e uma fase de commit;
- nenhum snapshot global é materializado.

LIMITE DE ETAPA
A Etapa 63 — padronização geral de snapshots/restore NÃO é antecipada.

Esta etapa usa apenas snapshots/projeções já pertencentes aos próprios
subdomínios quando necessário para ler seus estados.

NÃO implementado:
- registry global de snapshots;
- bundle global de save state;
- restore coordinator;
- version migration framework.

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
- wall clock;
- RNG global.

PRÓXIMA ETAPA
Etapa 63 — Snapshots / Restore.
