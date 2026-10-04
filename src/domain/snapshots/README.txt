PROJETO1 — CAMADA 2 / SNAPSHOTS + RESTORE

Path: src/domain/snapshots
Camada arquitetural: Camada 2 — Domínio
Status: implementação real iniciada na Etapa 63.

OBJETIVO
Padronizar capture e restore de estado mutável runtime sem introduzir I/O,
filesystem, storage, clock, RNG, engine ou plataforma.

A Etapa 63 NÃO substitui os snapshots locais já existentes.
Ela os organiza através de codecs explícitos.

ARQUITETURA

SnapshotIds.ts
- SnapshotTypeId: identifica um codec/schema.
- SnapshotSlotId: identifica uma instância lógica dentro do bundle.

Exemplo:
typeId = "runtime.currency-account"
slotId = "player.wallet.coins"

Vários slots podem usar o mesmo typeId.

SnapshotValue.ts
Payload canônico JSON-safe.

Aceita:
- null;
- boolean;
- string;
- number finito;
- arrays;
- objetos simples.

Rejeita:
- undefined;
- bigint;
- function;
- symbol;
- Date;
- Map;
- Set;
- instâncias de classes;
- ciclos;
- numbers não finitos.

Objetos são clonados profundamente, keys ordenadas e estrutura congelada.

SnapshotCodec.ts
Contrato:
- typeId;
- schemaVersion;
- isAggregate();
- capture();
- restore().

SnapshotCodec<TAggregate, TState, TContext> permite context de restore quando o
estado runtime depende de definições estáticas externas.

O registry usa RuntimeSnapshotCodec type-erased, criado explicitamente por
toRuntimeSnapshotCodec().

DomainSnapshotRegistry.ts
Registry imutável.

- codecs instalados no construtor;
- SnapshotTypeId único;
- lookup por Map;
- type IDs pré-ordenados;
- sem register() dinâmico.

SnapshotBundle.ts
Bundle serializável:
{
  schemaVersion: 1,
  entries: [
    {
      slotId,
      typeId,
      schemaVersion,
      state
    }
  ]
}

Regras:
- slotId único;
- entries ordenadas por slotId;
- payload normalizado como SnapshotValue;
- bundle schema versionado;
- codec schema versionado por entry;
- normalizeSnapshotBundle() valida também objetos vindos de JSON.parse().

SnapshotCoordinator.ts

capture(bindings):
1. resolve codec no registry;
2. valida aggregate via codec;
3. captura state;
4. normaliza payload;
5. cria bundle ordenado.

restore(bundle, contexts):
1. normaliza/valida bundle;
2. resolve codec;
3. valida schemaVersion da entry;
4. fornece context pelo SnapshotSlotId;
5. cria NOVO aggregate via codec;
6. retorna RestoredSnapshotSet.

Restore nunca muta aggregates existentes.
Falha intermediária não deixa estado parcialmente restaurado no chamador.

RestoredSnapshotSet:
- size;
- has();
- get<T>();
- require<T>();
- getSlotIds() ordenado.

CONTEXTOS ESTÁTICOS
Definições estáticas NÃO entram no snapshot runtime.

Inventory:
restore context:
- Map<ItemId, Item>.

LevelProgression:
restore context:
- ProgressionCurve.

NarrativeState:
restore context:
- QuestDefinition[].

Isso evita duplicar definições imutáveis no save state.

CODECS PADRÃO
A Etapa 63 inclui 19 codecs:

1. Agent
2. AbilityAction
3. StateStore
4. SimulationTimer
5. Inventory
6. CurrencyAccount
7. ResourcePool
8. CooldownSet
9. ModifierSet
10. StatusEffectSet
11. FactionMatrix
12. Reputation
13. Relationship
14. ExperiencePool
15. LevelProgression
16. UnlockSet
17. NarrativeState
18. StoryFlagSet
19. TagSet

RESTORE CUSTOMIZADO

Agent
- usa Agent constructor;
- valida alive derivado de health.

AbilityAction
- recria pending/committed/resolved/cancelled através das transições públicas;
- valida cancelReason.

Inventory
- exige Item definitions externas;
- rejeita ItemId duplicado;
- rejeita missing definition;
- valida item.id;
- reexecuta add();
- valida occupiedSlots e totalUnits derivados.

Demais aggregates
- reutilizam seus fromSnapshot() já existentes.

SERIALIZAÇÃO
O domínio NÃO chama JSON.stringify()/JSON.parse() internamente.

SnapshotBundleSnapshot é dado serializável.
Camadas acima escolhem serializer e SaveGamePort.

VERSIONAMENTO
Etapa 63 só aceita schema exato do codec atual.

NÃO há migração automática de schema nesta etapa.

Uma entry com schema diferente falha com:
unsupported-codec-schema.

Migração de versões é responsabilidade futura e explícita; não é inferida.

DETERMINISMO
- registry type IDs ordenados;
- bundle slots ordenados;
- SnapshotValue object keys ordenadas;
- snapshots locais preservam ordenação própria;
- nenhum wall clock;
- nenhum RNG;
- nenhum ID gerado implicitamente.

MEMÓRIA / PERFORMANCE
Snapshot é operação discreta de save/checkpoint/debug.

Não deve rodar por frame.

Hot paths de gameplay não passam pelo coordinator.

Capture aloca:
- snapshots locais;
- payload canônico;
- bundle.

Restore aloca:
- novos aggregates;
- payload normalizado do bundle.

Isso é deliberado para isolamento e atomicidade lógica.

LIMITES
Etapa 64 — Deterministic RNG NÃO é antecipada.

Nenhum:
- RandomSeed;
- deterministic RNG;
- random stream;
- Math.random.

Também não há:
- SaveGamePort call;
- filesystem;
- localStorage;
- Tauri;
- Steamworks;
- engine;
- renderer;
- physics.

PORTABILIDADE
Snapshots persistem somente estado semântico.

Compatível com:
- 2D;
- 2.5D;
- 3D;
- headless.

PRÓXIMA ETAPA
Etapa 64 — Deterministic RNG.
