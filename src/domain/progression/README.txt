PROJETO1 — CAMADA 2 / PROGRESSION

Path: src/domain/progression
Camada arquitetural: Camada 2 — Domínio
Status: implementação real iniciada na Etapa 57.

FUNÇÃO
Modelar progressão cumulativa independente de Agent, renderer, física, UI,
economia concreta ou execução de skill tree.

ARQUIVOS

ProgressionCurve.ts
Curva imutável baseada em thresholds cumulativos de XP.

Exemplo:
[0, 100, 300, 600]

Significado:
- level 1 começa em 0 XP;
- level 2 começa em 100 XP;
- level 3 começa em 300 XP;
- level 4 começa em 600 XP.

Invariantes:
- array não vazio;
- primeiro threshold = 0;
- todos os thresholds são inteiros seguros >= 0;
- thresholds estritamente crescentes.

APIs:
- maxLevel;
- getRequiredTotalExperience(level);
- getLevelForTotalExperience(totalExperience);
- getExperienceIntoLevel(totalExperience);
- getExperienceRequiredForNextLevel(totalExperience);
- getProgress01(totalExperience);
- snapshot/restore.

getLevelForTotalExperience usa busca binária.
Nenhum array é criado no lookup.

ExperiencePool.ts
Mantém somente XP total cumulativo.

Invariantes:
- inteiro seguro >= 0;
- add(0) permitido;
- overflow é erro;
- setter estrito disponível para autoria/restore controlado.

ExperiencePool NÃO:
- calcula level;
- conhece Agent;
- concede unlock;
- publica eventos.

LevelProgression.ts
Compõe:
ProgressionCurve + ExperiencePool

Regra central:
LEVEL NÃO É ARMAZENADO.

currentLevel é sempre derivado de:
curve + totalExperience

Isso elimina drift:
level != XP

APIs:
- totalExperience;
- currentLevel;
- maxLevel;
- atMaxLevel;
- experienceIntoLevel;
- experienceRequiredForNextLevel;
- levelProgress01;
- addExperience();
- snapshot/restore.

addExperience retorna LevelProgressionChange:
- previousLevel;
- currentLevel;
- levelsGained;
- previousTotalExperience;
- currentTotalExperience.

O resultado é declarativo.
Não:
- altera Agent;
- publica DomainEvent;
- concede reward;
- desbloqueia SkillTreeGraph;
- chama UI.

Agent existente
Agent já possui level/experience desde a Etapa 44.1.

A Etapa 57 NÃO migra nem sincroniza esses campos automaticamente.
Essa integração deve ser explícita e pertence à composição cross-domain.

UnlockSet.ts
Set de UnlockId semânticos.

UnlockId pode representar:
- feature;
- recipe;
- ability;
- skill;
- chapter;
- qualquer capability lógica futura.

Operações:
- has();
- unlock();
- lock();
- clear();
- forEach();
- snapshot/restore.

Snapshot ordena UnlockId lexicograficamente.

UnlockSet NÃO conhece SkillTreeGraph.
Portanto:
unlock("skill.fireball")
não executa alteração automática em SkillTreeGraph.

ProgressionSnapshot.ts
Snapshot agregado do estado mutável da progressão:
- schemaVersion;
- LevelProgressionSnapshot;
- UnlockSetSnapshot.

ProgressionCurve NÃO entra no snapshot agregado.
Ela é uma definição do jogo e precisa ser fornecida no restore.

Isso impede duplicação de definição estática em saves e permite que a camada
de definitions futura seja a autoridade sobre a curva.

DETERMINISMO
- XP é inteiro seguro;
- curva é data-driven;
- level é função pura de XP + curve;
- unlock snapshot é ordenado;
- nenhum wall clock;
- nenhum RNG;
- nenhum frame dependency.

PERFORMANCE
ProgressionCurve:
- level lookup O(log n);
- demais lookups O(1) após o level;
- zero alocação no lookup.

ExperiencePool:
- O(1), mutação in-place.

LevelProgression:
- getters não materializam coleção;
- addExperience aloca apenas o resultado discreto da operação.

UnlockSet:
- has/unlock/lock O(1) médio;
- array/sort apenas no snapshot.

LIMITE DE ETAPA
Etapa 58 — Narrative expansion NÃO é antecipada:
- QuestId;
- QuestDefinition;
- QuestState;
- NarrativeState;
- StoryFlagSet.

DialogueGraph e QuestGoal existentes permanecem inalterados.

Também NÃO implementado:
- gameplay rules;
- definitions registry;
- tags;
- cross-domain integration;
- snapshot framework geral da Etapa 63;
- RNG da Etapa 64.

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
A mesma progressão é reutilizável em:
- 2D;
- 2.5D;
- 3D;
- headless.

PRÓXIMA ETAPA
Etapa 58 — Narrative.
