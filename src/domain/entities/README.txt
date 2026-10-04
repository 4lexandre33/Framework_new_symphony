PROJETO1 — CAMADA 2 / ENTITIES

Path: src/domain/entities
Camada arquitetural: Camada 2 — Domínio
Status: implementação real em andamento; Etapa 46 aplicada.

FUNÇÃO
Hospedar entidades, identificadores e referências puras de gameplay,
independentes de engine, renderer, física, plataforma e dimensionalidade visual.

REGRA L2-DIMENSION-AGNOSTIC
Tudo em src/domain/** deve ser reutilizável sem alteração estrutural em jogos:
- 2D;
- 2.5D;
- 3D;
- headless.

Entidades de domínio não armazenam THREE.Vector3, Sprite, Mesh, Object3D,
rigid bodies, transforms de renderer ou handles concretos de física.

IMPLEMENTAÇÃO ATUAL

DomainId.ts
- identificador nominal serializável com zero wrapper runtime.

VersionedSnapshot.ts
- envelope genérico e versionado para snapshots de estado.

Agent.ts
- entidade de gameplay com identidade, nome, saúde e progressão básica.
- não contém posição, orientação, render, física ou input.

WorldObjectId.ts
- identidade nominal de objeto lógico do mundo.

WorldObjectRef.ts
- referência mínima e imutável para WorldObjectId.

ObjectStateRef.ts
- referência opaca para estado lógico futuro.
- NÃO implementa StateStore; isso pertence à Etapa 47.

ObjectProp.ts
- objeto lógico com identidade, nome, location semântica opcional e stateRef
  opcional;
- location pode ser alterada in-place por relocate()/clearLocation();
- não contém representação física ou visual;
- snapshot/restauração são dimension-agnostic.

OBJECT PROP NÃO É RENDER OBJECT
O mesmo ObjectProp pode ser associado externamente a:
- 2D: sprite/tile entity;
- 2.5D: billboard/layer entity;
- 3D: mesh/scene object;
- headless: nenhuma representação visual.

Nenhuma dessas associações entra na Camada 2.

LOCATION
ObjectProp usa somente LocationRef de src/domain/location.
Ele não armazena coordenadas nem valida transforms. A validade topológica da
Location pode ser consultada por LocationGraph por uma camada/orquestração que
possua ambos os objetos.

STATE
ObjectStateRef é propositalmente opaca na Etapa 46. O StateStore real será
implementado na Etapa 47. Isso evita criar placeholders ou acoplamento prematuro.

TAGS / CLASSIFICAÇÃO
Tags e classificação transversal permanecem adiadas para a Etapa 61. Não foram
criadas strings de categoria temporárias nesta etapa.

PERFORMANCE
- WorldObjectRef/ObjectStateRef são objetos mínimos e imutáveis.
- ObjectProp.relocate()/clearLocation() mutam referência in-place.
- toSnapshot() aloca somente quando explicitamente solicitado.
- nenhuma entidade executa update por frame.

DEPENDÊNCIAS PERMITIDAS
- Outros tipos puros de src/domain/**.
- Recursos nativos TypeScript/JavaScript sem I/O ou infraestrutura.

DEPENDÊNCIAS PROIBIDAS
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
Etapa 47 — State foundation.
