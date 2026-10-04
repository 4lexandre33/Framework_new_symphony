PROJETO1 — CAMADA 2 / NARRATIVE

Path: src/domain/narrative
Camada arquitetural: Camada 2 — Domínio
Status:
- DialogueGraph e QuestGoal desde a Etapa 44.4;
- Narrative expandida na Etapa 58.

FUNÇÃO
Modelar narrativa lógica independente de renderer, mundo físico, UI, áudio,
Core EventBus, engine e infraestrutura.

PRIMITIVES EXISTENTES

DialogueGraph
Definição imutável de diálogo com:
- line;
- choice;
- branch;
- end.

Loops são permitidos.
Condições permanecem IDs semânticos opacos.

QuestGoal
Estado runtime de um objetivo:
inactive -> active -> completed
inactive -> active -> failed

Goal possui:
- QuestGoalId;
- QuestGoalKindId;
- QuestGoalTargetId opcional;
- requiredProgress;
- progress;
- status.

ETAPA 58

QuestId.ts
Identidade nominal de uma quest.

QuestDefinition.ts
Definição imutável:
- QuestId;
- title;
- description opcional;
- um ou mais QuestGoalDefinition.

Cada QuestGoalDefinition possui:
- QuestGoalId;
- QuestGoalKindId;
- QuestGoalTargetId opcional;
- requiredProgress.

Invariantes:
- título válido;
- goals não vazios;
- IDs de goal únicos;
- requiredProgress inteiro seguro >= 1.

Os goals são normalizados em ordem de QuestGoalId.

REGRA DE ETAPA
Todos os goals declarados são obrigatórios.

A Etapa 58 NÃO implementa:
- optional goals;
- OR-groups;
- quest branches;
- condition trees;
- reward execution;
- event subscriptions.

Esses comportamentos exigem composição explícita futura.

QuestState.ts
Estado runtime de QuestDefinition.

Lifecycle:
inactive -> active -> completed
inactive -> active -> failed

activate():
- ativa todos os QuestGoals.

advanceGoal()/completeGoal():
- delegam ao QuestGoal;
- após cada mudança verificam se todos os goals foram completed;
- se todos completed, QuestState -> completed.

failGoal():
- falha o goal selecionado;
- falha todos os outros goals ainda active;
- QuestState -> failed.

fail():
- falha todos os goals ainda active;
- QuestState -> failed.

Isso garante que uma quest terminal não deixe goals active.

SNAPSHOT / RESTORE
QuestStateSnapshot salva:
- questId;
- status;
- snapshots de todos os goals.

Restore exige QuestDefinition externa.

O restore valida:
- QuestId;
- quantidade de goals;
- IDs;
- kindId;
- targetId;
- requiredProgress;
- consistência entre status da quest e status dos goals.

Definição estática não é duplicada como autoridade runtime.

StoryFlagSet.ts
Facts narrativos booleanos.

Presença no Set = true.
Ausência = false.

StoryFlagId é semântico e opaco.

Operações:
- has();
- set();
- clear();
- clearAll();
- forEach();
- snapshot/restore.

Snapshot é ordenado por StoryFlagId.

StoryFlagSet NÃO modifica StateStore automaticamente.
A conexão Narrative -> State permanece para a Etapa 62.

NarrativeState.ts
Agregado runtime mínimo:
- Map<QuestId, QuestState>;
- StoryFlagSet.

APIs:
- hasQuest();
- getQuest();
- activateQuest();
- advanceQuestGoal();
- completeQuestGoal();
- failQuestGoal();
- failQuest();
- hasStoryFlag();
- setStoryFlag();
- clearStoryFlag();
- snapshot/restore.

NarrativeState não:
- publica DomainEvent;
- executa DialogueGraph;
- concede Reward;
- altera Inventory/Currency;
- altera StateStore;
- move Agent;
- consulta engine.

SNAPSHOT DETERMINÍSTICO
- quests ordenadas por QuestId;
- goals ordenados por QuestGoalId;
- flags ordenadas por StoryFlagId.

PERFORMANCE
QuestDefinition:
- Map por QuestGoalId;
- ordenação só no construtor.

QuestState:
- lookup de goal O(1) médio;
- avanço de um goal O(1) + scan O(n goals) para detectar conclusão;
- sem snapshots no caminho comum.

StoryFlagSet:
- lookup/mutação O(1) médio;
- array/sort somente no snapshot.

NarrativeState:
- lookup de quest O(1) médio;
- snapshot aloca/ordena somente sob demanda.

PORTABILIDADE
Zero dimensionalidade espacial.
Funciona igual em:
- 2D;
- 2.5D;
- 3D;
- headless.

INTEGRAÇÃO FUTURA
Reservada para Etapa 62:
- Quest -> DomainEvents;
- Quest -> State;
- Narrative -> Conditions;
- Rewards -> Economy/Inventory;
- Dialogue branches -> Conditions.

LIMITE DE ETAPA
Etapa 59 — Gameplay Rules NÃO é antecipada:
- DamageRule;
- HealingRule;
- traversal/movement semantic rules;
- RequirementRule;
- rule outcomes.

DEPENDÊNCIAS PROIBIDAS
- src/core/**
- src/engine/**
- src/services/**
- src/app/**
- src/plugins/**
- stack gráfica/física/nativa concreta.

PRÓXIMA ETAPA
Etapa 59 — Gameplay Rules.
