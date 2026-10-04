PROJETO1 — CAMADA 2 / MECHANICS

Path: src/domain/mechanics
Camada arquitetural: Camada 2 — Domínio
Status: implementação real expandida até a Etapa 59.

SISTEMAS PRESENTES
- AbilityAction;
- SkillTreeGraph;
- Status Effects;
- Modifiers;
- Resources;
- Cooldowns;
- Gameplay Rules.

REGRAS GERAIS
Mechanics é puramente semântico.

Não contém:
- renderer;
- física concreta;
- input;
- câmera;
- UI;
- Tauri;
- Steamworks;
- acesso a engine.

ABILITY / SKILL TREE
AbilityAction e SkillTreeGraph permanecem como definidos na Etapa 44.3.

STATUS EFFECTS
StatusEffect, StatusEffectInstance e StatusEffectSet permanecem como definidos
na Etapa 51.

MODIFIERS
Modifier, ModifierOperation e ModifierSet permanecem como definidos na Etapa 52.

RESOURCES + COOLDOWNS
ResourcePool, Cooldown e CooldownSet permanecem como definidos na Etapa 53.

ResourcePool:
- canSpend();
- trySpend();
- gain();
- setCurrent();
- setMax();
- fill();
- empty();
- snapshot/restore.

Cooldown:
- start();
- restart();
- clear();
- advance();
- snapshot/restore.

CooldownSet:
- storage Map;
- lookup O(1) médio;
- advance sem materializar arrays temporários;
- snapshot ordenado somente sob demanda.

ETAPA 59 — GAMEPLAY RULES

GameplayRuleOutcome.ts
Resultado genérico discriminado:

accepted = true
- value

accepted = false
- reason
- details

A estrutura é imutável e não executa side effects.

DamageRule.ts
Recebe facts numéricos:
- currentHealth;
- incomingDamage;
- flatMitigation opcional;
- multiplier opcional.

Ordem:
1. incomingDamage - flatMitigation;
2. saturação em zero;
3. multiplier;
4. saturação pela vida disponível.

Resultado:
- previousHealth;
- requestedDamage;
- effectiveDamage;
- appliedDamage;
- overkillDamage;
- nextHealth;
- lethal.

currentHealth = 0:
- outcome rejeitado como target-already-defeated.

DamageRule não chama Agent.applyDamage().
A integração com Agent fica fora da regra.

HealingRule.ts
Recebe:
- currentHealth;
- maxHealth;
- incomingHealing;
- multiplier opcional.

Resultado:
- previousHealth;
- maxHealth;
- requestedHealing;
- effectiveHealing;
- appliedHealing;
- wastedHealing;
- nextHealth;
- fullyRestored.

currentHealth = 0:
- outcome rejeitado como target-defeated.

HealingRule não revive automaticamente e não chama Agent.heal().

MovementRule.ts
Primitives semânticas:
- MovementEndpointId;
- MovementModeId;
- MovementIntent.

MovementIntent contém somente:
- from;
- to;
- modeId.

Não existem coordenadas, velocidade física ou transform.

createMovementIntent rejeita from === to.

TraversalRule.ts
Regra declarativa de autorização de traversal.

Configuração:
- TraversalRuleId;
- allowedModeIds;
- requiredCapabilityIds.

Avaliação recebe:
- MovementIntent;
- ReadonlySet<TraversalCapabilityId>.

Outcomes rejeitados:
- unsupported-movement-mode;
- missing-traversal-capability.

TraversalRule não:
- move entidade;
- consulta mapa físico;
- executa pathfinding;
- executa colisão.

RequirementRule.ts
Regra genérica de requirements já resolvidos.

IDs:
- RequirementRuleId;
- RequirementId.

Modes:
- all;
- any.

Entrada de avaliação:
ReadonlyMap<RequirementId, boolean>

A origem dos booleans é externa.

A regra NÃO conhece diretamente o sistema concreto que resolveu os facts.

Validações:
- requirements não vazios;
- IDs únicos;
- mode válido;
- resolutions desconhecidas são erro estrutural;
- requirement ausente produz requirements-unresolved.

Outcomes:
- accepted;
- requirements-unresolved;
- requirements-unsatisfied.

INTEGRAÇÃO
A Etapa 59 NÃO conecta automaticamente:
- DamageRule -> Agent;
- HealingRule -> Agent;
- DamageRule -> ModifierSet;
- HealingRule -> ModifierSet;
- TraversalRule -> LocationGraph;
- RequirementRule -> qualquer avaliador concreto;
- gameplay rules -> DomainEvent;
- gameplay rules -> StateStore.

Essas integrações são responsabilidade explícita da etapa de integração
cross-domain.

PERFORMANCE
DamageRule / HealingRule:
- O(1);
- sem coleção;
- apenas outcome discreto.

MovementIntent:
- estrutura pequena e imutável.

TraversalRule:
- movement mode lookup O(1) médio via Set;
- capability checks O(n required capabilities);
- nenhuma coleção temporária na avaliação.

RequirementRule:
- valida resolutions em O(n);
- nenhuma coleção temporária na avaliação;
- arrays são normalizados somente no construtor.

PORTABILIDADE
Nenhuma regra depende de dimensionalidade.

Mesma implementação:
- 2D;
- 2.5D;
- 3D;
- headless.

LIMITE DE ETAPA
Etapa 60 permanece intacta.
Nenhum registry estático global é criado nesta etapa.

Etapa 61 permanece intacta.
Nenhum sistema de classificação semântica global é criado nesta etapa.

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

PRÓXIMA ETAPA
Etapa 60 — Definitions.
