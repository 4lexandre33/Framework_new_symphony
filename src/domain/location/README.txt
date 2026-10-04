PROJETO1 — CAMADA 2 / LOCATION

Path: src/domain/location
Camada arquitetural: Camada 2 — Domínio
Status: implementação real iniciada na Etapa 45.

FUNÇÃO
Modelar espaço semântico de gameplay sem acoplamento a coordenadas, renderer,
física, scene graph, tiles ou plataforma.

REGRA L2-DIMENSION-AGNOSTIC
Location representa "onde algo está" em termos semânticos, não "qual é seu
transform".

A mesma LocationId pode ser resolvida externamente como:
- 2D: tile, grid cell, rectangle ou region;
- 2.5D: tile/layer/elevation/region;
- 3D: transform, trigger volume, nav region ou scene node;
- headless: apenas identidade lógica.

Nenhum desses detalhes entra em src/domain/location/**.

IMPLEMENTAÇÃO ATUAL

LocationId.ts
- branded DomainId<"location">.

LocationRef.ts
- referência lógica mínima e imutável para LocationId.
- não contém x/y/z, layer, sceneId ou transform.

LocationZone.ts
- nó semântico imutável com id e name.
- snapshot serializável sob demanda.

LocationRelation.ts
Relações suportadas:
- contains
- connected-to
- parent
- child
- neighbor

connected-to e neighbor são simétricas.
contains, parent e child são direcionais.
Self-relations são rejeitadas.

LocationGraph.ts
- Map<LocationId, LocationZone> para lookup O(1) médio;
- relações validadas na construção;
- relações simétricas A-B e B-A são tratadas como duplicadas;
- contains forma hierarquia acíclica;
- connected-to/neighbor podem possuir ciclos naturais;
- getDirectContents();
- isContainedBy() transitivo;
- hasDirectRelation();
- findPath() por BFS sob demanda.

PATH
findPath() percorre por default:
- connected-to;
- neighbor.

contains/parent/child só entram quando o chamador pede explicitamente
relationKinds adicionais.

PERFORMANCE
- graph é construído/validado uma vez;
- lookup de location: O(1) médio;
- consulta de relation direta usa adjacency pré-calculada;
- nenhuma operação executa por fixed tick/render frame;
- BFS e Set/Map temporários só são criados quando findPath()/containment
  transitivo são explicitamente solicitados.

INVARIANTES
- graph não pode ser vazio;
- LocationId é único;
- relations só referenciam locations existentes;
- self relation é inválida;
- relation duplicada é inválida;
- reverse duplicate de symmetric relation é inválida;
- contains não pode possuir ciclo;
- queries de LocationId desconhecida falham explicitamente.

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
Etapa 46 — World Objects / referências de objetos lógicos.
