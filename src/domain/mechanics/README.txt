PROJETO1 — CAMADA 2 / MECHANICS

Path: src/domain/mechanics
Camada arquitetural: Camada 2 — Domínio
Status: implementação real expandida até a Etapa 53.

SISTEMAS PRESENTES
- AbilityAction;
- SkillTreeGraph;
- Status Effects;
- Modifiers;
- Resources;
- Cooldowns.

ETAPA 53 — RESOURCES + COOLDOWNS

RESOURCE

ResourceId.ts
- ResourceId nominal puro.

ResourcePool.ts
Pool genérico:
- id;
- current;
- max.

Exemplos semânticos:
- resource.mana;
- resource.stamina;
- resource.energy;
- resource.ammo-charge.

Operações:
- canSpend();
- trySpend();
- gain();
- setCurrent();
- setMax();
- fill();
- empty();
- toSnapshot();
- fromSnapshot().

trySpend()
É atômico:
- se current >= amount, gasta amount e retorna true;
- se current < amount, não altera current e retorna false.

gain()
- satura no max;
- retorna quanto realmente entrou.

setMax()
- max precisa ser finito e > 0;
- por padrão current é clamped ao novo max;
- clampCurrent=false transforma redução incompatível em erro explícito.

ResourcePool NÃO substitui automaticamente Agent.health.
Agent.health já é parte do aggregate Agent e permanece inalterado.
Migrações/integracões cross-domain só devem ocorrer quando houver razão real.

Valores de recurso:
- são numbers finitos;
- podem ser fracionários;
- current/max nunca são negativos;
- current <= max.

COOLDOWN

CooldownId.ts
- CooldownId nominal puro.

Cooldown.ts
Estado:
- id;
- duration;
- SimulationTimer.

Ready:
- timer idle ou completed.

Active:
- timer running.

Operações:
- start();
- restart();
- clear();
- advance();
- toSnapshot();
- fromSnapshot().

start()
- só inicia se ready;
- se já active, falha explicitamente.

restart()
- reinicia mesmo se active.

clear()
- cancela contagem e volta a ready.

advance()
- só consome elapsed quando active;
- elapsed é DomainDuration fornecido externamente;
- não lê wall clock.

Cooldown isReady:
- true em idle/completed;
- false em running.

Cooldown.remaining:
- 0 quando ready;
- timer.remaining quando active.

CooldownSet.ts
Storage:
- Map<CooldownId, Cooldown>.

Operações:
- add();
- remove();
- get();
- has();
- isReady();
- start();
- restart();
- clearCooldown();
- advance();
- clear();
- forEach();
- toSnapshot();
- fromSnapshot().

advance()
- percorre Map diretamente;
- não materializa array;
- não cria snapshot;
- cada Cooldown decide se está active.

Snapshot:
- CooldownSet ordena por CooldownId;
- duplicate IDs são rejeitados no restore;
- duration/timer inconsistente é rejeitado.

PERFORMANCE
ResourcePool:
- operações O(1);
- mutação numérica in-place;
- snapshots somente sob demanda.

Cooldown:
- SimulationTimer mutável in-place;
- advance O(1).

CooldownSet:
- lookup O(1) médio;
- advance O(n cooldowns);
- sem arrays temporários no avanço;
- snapshot ordenado somente sob demanda.

INTEGRAÇÃO
Esta etapa NÃO acopla automaticamente:
- AbilityAction -> ResourcePool;
- AbilityAction -> Cooldown;
- Skill -> Cooldown;
- StatusEffect -> ResourcePool;
- Modifier -> ResourcePool.max.

Essas integrações pertencem à Etapa 62, onde os subdomínios serão conectados
explicitamente e testados em cenários headless.

NÃO IMPLEMENTADO NESTA ETAPA
Etapa 54 permanece intacta:
- InteractionId;
- InteractionIntent;
- Affordance;
- InteractionRequirement;
- InteractionOutcome.

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
- Date.now()
- performance.now()
- requestAnimationFrame()

COMPATIBILIDADE
Resources e cooldowns são semanticamente independentes de espaço.
Mesma implementação para 2D, 2.5D, 3D e headless.

PRÓXIMA ETAPA
Etapa 54 — Interaction / Affordances.
