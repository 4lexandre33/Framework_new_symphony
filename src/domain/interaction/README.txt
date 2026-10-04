PROJETO1 — CAMADA 2 / INTERACTION

Path: src/domain/interaction
Camada arquitetural: Camada 2 — Domínio
Status: implementação real iniciada na Etapa 54.

FUNÇÃO
Modelar interações semânticas entre um ator e um alvo lógico sem conhecer:
- distância física;
- coordenadas;
- raycast;
- collider;
- trigger volume;
- input;
- renderer;
- UI;
- engine.

ARQUITETURA

InteractionIntent
= o que um ator quer fazer com um alvo.

Affordance
= o que um alvo oferece semanticamente.

InteractionRequirement
= pré-requisito nomeado/opaco.

InteractionOutcome
= resultado puro de disponibilidade/autorização.

Execução concreta da ação NÃO acontece nesta camada.

InteractionId.ts
- InteractionId nominal.

Exemplos:
- interaction.open;
- interaction.close;
- interaction.talk;
- interaction.pickup;
- interaction.use;
- interaction.activate;
- interaction.inspect.

InteractionIntent.ts

Actor:
- InteractionActorTypeId;
- InteractionActorId;
- InteractionActorRef.

Target:
- InteractionTargetTypeId;
- InteractionTargetId;
- InteractionTargetRef.

Intent:
- interactionId;
- actor;
- target.

Nenhum ref contém:
- x/y/z;
- transform;
- mesh;
- sprite;
- rigid body;
- collider;
- raycast hit;
- pointer nativo.

A camada superior é responsável por detectar fisicamente que uma interação pode
ser tentada e só então cria o InteractionIntent.

Affordance.ts
Declara:
- InteractionId oferecido;
- target lógico que oferece a capacidade;
- requirements semânticos.

Exemplo conceitual:
porta oferece interaction.open
target = world-object.castle-door
requirements:
- requirement.has-castle-key
- requirement.door-not-locked-by-quest

Affordance:
- rejeita requirement IDs duplicados;
- ordena requirements por ID;
- supports(intent) verifica InteractionId + target;
- snapshot é determinístico.

InteractionRequirement.ts

InteractionRequirement é propositalmente opaco nesta etapa.

Ele possui somente:
- InteractionRequirementId.

A avaliação concreta NÃO está embutida no requirement.

Motivo:
a Etapa 50 já possui Conditions/Predicates, mas a conexão formal
Interaction -> Conditions está planejada para a Etapa 62 — Cross-domain
integration.

A Etapa 54 NÃO:
- duplica ConditionExpression;
- importa ConditionEvaluator;
- inventa um segundo sistema de predicates;
- executa callbacks/scripts.

InteractionRequirementResolution
Representa o resultado já calculado:
- requirementId;
- satisfied boolean.

Na Etapa 62, um adapter/composição de domínio pode transformar ConditionResult
em InteractionRequirementResolution.

InteractionOutcome.ts
resolveInteractionOutcome():
1. verifica se affordance suporta intent;
2. valida resolution IDs;
3. detecta requirements sem resolução;
4. detecta requirements não satisfeitos;
5. retorna accepted quando todos estão satisfeitos.

Reasons:
- unsupported-interaction;
- requirements-unresolved;
- requirements-unsatisfied.

Erros estruturais:
- duplicate-resolution;
- unknown-resolution.

IMPORTANTE
accepted significa:
"esta interação está semanticamente autorizada"

accepted NÃO significa:
"a ação já foi executada"

A Etapa 54 não:
- abre portas;
- remove item do Inventory;
- inicia DialogueGraph;
- muda StateStore;
- move Agent;
- dispara animação;
- toca áudio;
- publica Core EventBus.

Essas ações pertencem a integrações/orquestração superiores.

DIMENSIONALIDADE

2D:
tile/overlap detecta alvo
-> cria InteractionIntent(interaction.open)

2.5D:
trigger/layer detecta alvo
-> cria o mesmo InteractionIntent

3D:
raycast/trigger volume detecta alvo
-> cria o mesmo InteractionIntent

Headless:
teste cria InteractionIntent diretamente.

O modelo de domínio é idêntico.

PERFORMANCE
- refs são pequenos objetos readonly;
- Affordance requirements são ordenados uma vez no construtor;
- supports() é O(1);
- hasRequirement() é O(n requirements), normalmente lista pequena;
- resolution cria Map apenas na operação discreta de resolução;
- nenhuma interação roda automaticamente por frame;
- nenhuma detecção espacial existe nesta camada.

NÃO IMPLEMENTADO NESTA ETAPA
Etapa 55 permanece intacta:
- FactionId;
- FactionRelation;
- FactionMatrix;
- Reputation;
- Relationship.

Também não implementado:
- ConditionEvaluator integration;
- Inventory integration;
- Dialogue integration;
- State mutation;
- DomainEvent emission;
- physics/input detection.

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

PRÓXIMA ETAPA
Etapa 55 — Relations / Factions / Reputation.
