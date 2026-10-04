PROJETO1 — CAMADA 2 / STATE

Path: src/domain/state
Camada arquitetural: Camada 2 — Domínio
Status: implementação real iniciada na Etapa 47.

FUNÇÃO
Representar facts/estado compartilhado de gameplay sem depender de world
service, renderer, storage, DOM ou plataforma.

EXEMPLOS DE STATE KEYS
- door.castle.open
- boss.dragon.defeated
- village.power.restored
- quest.intro.accepted
- weather.storm.active
- faction.guild.reputation

Esses valores descrevem estado de gameplay; não descrevem implementação física.

IMPLEMENTAÇÃO ATUAL

StateKey.ts
- branded DomainId<"state-key">;
- pode carregar TValue apenas em compile-time;
- runtime continua sendo string.

StateValue.ts
Valores permitidos:
- null;
- boolean;
- number finito;
- string;
- arrays recursivos;
- objetos simples recursivos.

Valores rejeitados:
- undefined;
- bigint;
- symbol;
- function;
- NaN/Infinity;
- Date;
- Map;
- Set;
- instâncias de classe;
- referências cíclicas.

cloneStateValue():
- valida profundamente;
- copia profundamente;
- congela profundamente;
- ordena keys de objetos ao clonar para comportamento determinístico.

StateStore.ts
- Map<StateKey, StateValue>;
- has();
- read();
- set();
- delete();
- compare();
- clear();
- forEach();
- toSnapshot();
- fromSnapshot().

StateSnapshot.ts
- entries serializáveis;
- snapshot determinístico ordenado por StateKey;
- duplicate keys são rejeitadas no restore.

IMUTABILIDADE DE VALORES
StateStore não mantém referência mutável do chamador.
set() copia e congela o valor antes de armazená-lo.

read() pode retornar diretamente o valor armazenado porque ele já é readonly e
deep-frozen.

PERFORMANCE
- has/read/set/delete: O(1) médio;
- compare: O(tamanho do valor comparado);
- clear: custo do Map;
- forEach não cria array intermediário;
- toSnapshot aloca/sort somente sob demanda;
- nenhuma operação executa por fixed tick/render frame.

DIMENSIONALIDADE
State não conhece:
- x/y/z;
- Vector2/Vector3;
- Sprite/Mesh/Object3D;
- renderer;
- física;
- world transform.

Logo o mesmo StateStore serve a jogos 2D, 2.5D, 3D e headless.

PERSISTÊNCIA
StateStore NÃO salva em disco.
SaveLoadUseCase pode futuramente persistir um StateSnapshot como parte de um
estado maior, mas StateStore não importa serviços nem ports de infraestrutura.

OBJECT STATE
ObjectStateRef da Etapa 46 permanece uma referência opaca. A integração formal
entre ObjectStateRef e StateStore será feita apenas quando a etapa de integração
cross-domain exigir isso; Etapa 47 não introduz coupling artificial.

DEPENDÊNCIAS PROIBIDAS
- src/engine/**
- src/services/**
- src/app/**
- src/plugins/**
- localStorage / IndexedDB
- filesystem
- Three.js
- Babylon.js
- Rapier
- WebGL
- DOM
- Tauri
- Steamworks SDK

PRÓXIMA ETAPA
Etapa 48 — Domain Time.
