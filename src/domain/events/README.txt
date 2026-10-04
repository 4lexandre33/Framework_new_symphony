PROJETO1 — CAMADA 2 / DOMAIN EVENTS

Path: src/domain/events
Camada arquitetural: Camada 2 — Domínio
Status: implementação real iniciada na Etapa 49.

FUNÇÃO
Representar fatos semânticos que já aconteceram no gameplay, sem acoplamento
a EventBus, transport, listeners, network, UI, plugins ou infraestrutura.

DISTINÇÃO CRÍTICA

DomainEvent:
- dado semântico do domínio;
- serializável;
- determinístico;
- imutável;
- pode representar AgentDamaged, ItemAdded, LocationEntered etc.

Core EventBus:
- mecanismo técnico de distribuição;
- pertence ao Core/infraestrutura;
- NÃO é importado por src/domain/**.

DomainEvent NÃO possui emit(), publish(), subscribe(), listener ou dispatcher.

IMPLEMENTAÇÃO ATUAL

DomainEventId.ts
- branded DomainId<"domain-event">.

DomainEventTypeId.ts
- branded DomainId<"domain-event-type">.
- representa semanticamente o tipo do fato.
- exemplos:
  - event.agent-damaged;
  - event.agent-died;
  - event.item-added;
  - event.quest-goal-completed;
  - event.location-entered;
  - event.state-changed.

DomainEventMetadata.ts
- sequence: inteiro seguro >= 0 fornecido externamente;
- tick: SimulationTick determinístico;
- source: DomainEventSourceRef | null.

DomainEventSourceRef
- referência lógica opaca;
- possui source type ID + source ID;
- não importa Agent, ObjectProp, Quest ou classes concretas;
- evita dependência cruzada desnecessária.

DomainEvent.ts
- id;
- typeId;
- metadata;
- payload tipado.

PAYLOAD
Payload usa a mesma disciplina serializável de StateValue:
- null;
- boolean;
- number finito;
- string;
- arrays;
- objetos simples recursivos.

createDomainEvent():
- deep-clone/deep-freeze do payload;
- congela o envelope;
- não gera ID, tick ou sequence implicitamente.

Nenhum contador global oculto existe no domínio.

DomainEventBatch.ts
- contêiner imutável;
- batch vazio é permitido;
- rejeita DomainEventId duplicado;
- rejeita sequence duplicada;
- ordena deterministicamente por sequence;
- rejeita regressão de SimulationTick após a ordenação;
- permite gaps de sequence;
- não exige que o batch comece em zero;
- não publica eventos.

CONSULTAS
- size / isEmpty;
- first / last;
- at();
- hasEvent();
- forEach();
- filterByType();
- asReadonlyArray().

PERFORMANCE
- criação de DomainEvent aloca somente o envelope/payload necessário;
- payload é normalizado uma única vez;
- batch valida/sort na construção;
- forEach() não aloca array;
- asReadonlyArray() retorna array interno frozen sem cópia;
- filterByType() aloca somente sob demanda;
- nenhuma operação roda automaticamente por fixed tick/render frame.

ORDERING
sequence é a ordem lógica primária.
tick precisa ser monotônico ao longo da sequence.

Exemplo válido:
sequence 10 tick 100
sequence 11 tick 100
sequence 12 tick 101

Exemplo inválido:
sequence 10 tick 100
sequence 11 tick 99

Gaps são válidos:
sequence 10
sequence 20
sequence 50

Isso permite batches que sejam subconjuntos de uma timeline maior.

SOURCE
O produtor decide os IDs lógicos. Exemplos conceituais:
typeId = source.agent
sourceId = agent.player

typeId = source.world-object
sourceId = world-object.door.01

Nenhum desses IDs contém pointer, handle nativo ou referência de renderer.

DIMENSIONALIDADE
Eventos descrevem significado, não detecção física.

2D:
tile overlap -> camada superior cria LocationEntered.

2.5D:
region/layer trigger -> camada superior cria o mesmo LocationEntered.

3D:
trigger volume -> camada superior cria o mesmo LocationEntered.

O DomainEvent produzido é estruturalmente idêntico.

DEPENDÊNCIAS PROIBIDAS
- @core
- Core EventBus
- src/core/**
- src/engine/**
- src/services/**
- src/app/**
- src/plugins/**
- DOM Event / EventTarget
- Three.js
- Babylon.js
- Rapier
- WebGL
- Tauri
- Steamworks SDK
- network transport

PRÓXIMA ETAPA
Etapa 50 — Conditions / Predicates.
