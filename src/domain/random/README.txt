PROJETO1 — CAMADA 2 / DETERMINISTIC RNG

Path: src/domain/random
Camada arquitetural: Camada 2 — Domínio
Status: implementação real iniciada na Etapa 64.

OBJETIVO
Fornecer aleatoriedade reproduzível baseada exclusivamente em seed/state
explícitos.

Nenhum fallback para entropia externa existe.

ARQUIVOS

RandomSeed.ts
Seed 128-bit representada por quatro uint32.

Criação:
- createRandomSeedFromUint32();
- createRandomSeedFromString();
- createRandomSeedFromWords().

Seed textual:
- 1..1024 code units;
- hash determinístico sobre UTF-16 code units;
- sem TextEncoder;
- sem locale;
- sem crypto;
- sem plataforma.

O hash textual não é criptográfico.
Sua função é somente produzir seed estável.

deriveRandomSeed(parent, label):
- não consome RNG;
- mesmo parent + mesmo label = mesmo child seed;
- label 1..256 code units.

RandomSeed totalmente zero é proibida.

DeterministicRng.ts
Algoritmo:
xoshiro128** v1

Identificador persistido:
"xoshiro128ss-v1"

Estado:
- quatro uint32;
- drawCount inteiro seguro >= 0.

APIs:
- nextUint32();
- nextFloat();
- nextInt(minInclusive, maxExclusive);
- nextFloatRange(minInclusive, maxExclusive);
- nextBoolean(probabilityTrue);
- clone();
- snapshot/restore.

nextFloat():
- intervalo [0, 1).

nextInt():
- intervalo [minInclusive, maxExclusive);
- inteiros seguros;
- range máximo de 2^32 valores;
- usa rejection sampling;
- sem modulo bias.

O drawCount conta TODAS as leituras uint32 consumidas, incluindo retries de
rejection sampling.

Snapshot:
{
  algorithm,
  state: [u32, u32, u32, u32],
  drawCount
}

Restore exige o algoritmo exato.
A Etapa 64 não implementa migração de algoritmo.

RandomStream.ts
RandomStream associa:
- RandomStreamId;
- seed estável;
- DeterministicRng corrente.

RandomStream é estruturalmente compatível com:
LootRandomSource {
  nextFloat(): number
}

Logo LootTable da Etapa 56 pode receber RandomStream ou DeterministicRng
diretamente, sem acoplamento de Economy ao módulo random.

fork(childId):
- deriva novo stream da seed original do parent;
- não consome o parent;
- não depende do drawCount atual do parent.

Isso é importante para evitar que adicionar uma chamada aleatória em um
sistema altere a sequência de outro subsistema.

RandomStreamFactory
Factory stateless de streams nomeados.

Stream seed:
derive(rootSeed, streamId)

Consequência:
- criar stream "loot" antes/depois de "ai" produz exatamente o mesmo "loot";
- consumir "ai" não altera "loot";
- replay pode reconstruir cada stream independentemente.

RANDOM SNAPSHOT CODECS
RandomSnapshotCodecs.ts integra Stage 64 ao framework da Etapa 63 sem alterar os
19 codecs padrão que pertencem ao gate histórico da Etapa 63.

Codecs adicionais:
- runtime.deterministic-rng;
- runtime.random-stream.

createRandomRuntimeSnapshotCodecs() pode ser composto explicitamente:

DomainSnapshotRegistry([
  ...createStandardRuntimeSnapshotCodecs(),
  ...createRandomRuntimeSnapshotCodecs(),
])

Assim:
- Etapa 63 continua estável;
- RNG pode participar de SnapshotCoordinator;
- continuação após restore preserva a sequência exata.

LOOT INTEGRATION
LootTable já recebe LootRandomSource.

Nenhuma mudança em LootTable é necessária.

Exemplo conceitual:
const rng = new DeterministicRng(seed)
lootTable.roll(rng, policy)

Mesma seed + mesma ordem de calls:
- mesmos entryIds;
- mesmos Reward selections.

DETERMINISMO
Garantido quando:
- algorithm version é a mesma;
- seed/state são os mesmos;
- ordem de calls no mesmo stream é a mesma.

Streams separados existem para minimizar acoplamento entre ordens de calls de
subsistemas diferentes.

PORTABILIDADE
Usa somente:
- uint32;
- Math.imul;
- shifts/bitwise;
- divisão por 2^32.

Mesma lógica:
- browser;
- Tauri;
- Node/headless;
- 2D;
- 2.5D;
- 3D.

NÃO USADO
- Math.random();
- crypto RNG;
- Date.now();
- performance.now();
- sistema operacional;
- filesystem;
- network;
- renderer;
- physics.

PERFORMANCE
nextUint32/nextFloat:
- O(1);
- zero allocation.

nextInt:
- O(1) esperado;
- pode consumir mais de um draw por rejection sampling.

RandomStream:
- forwarding O(1);
- fork aloca novo stream somente sob demanda.

Snapshots:
- operações discretas;
- não devem ser produzidos por frame sem necessidade.

SEGURANÇA
Este RNG NÃO é criptográfico.

Não usar para:
- autenticação;
- tokens;
- chaves;
- segurança;
- gambling/finance.

Ele existe exclusivamente para gameplay determinístico/replay/testes.

LIMITE DE ETAPA
Etapa 65 — Ports Review NÃO é antecipada.

Nenhuma alteração é feita em:
- ClockPort;
- SaveGamePort;
- ModdingPort;
- ports de engine/infrastructure.

PRÓXIMA ETAPA
Etapa 65 — Ports Review.
