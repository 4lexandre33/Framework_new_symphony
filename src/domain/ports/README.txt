PROJETO1 — CAMADA 2 / PORTS REVIEW

Path: src/domain/ports
Camada arquitetural: Camada 2 — Domínio
Status: revisão formal concluída na Etapa 65.

OBJETIVO
Manter ports somente quando existe uma dependência externa real que precisa ser
invertida.

A revisão evita "port explosion": interfaces não são criadas apenas porque um
subsistema possui uma API.

PORTS APROVADOS

1. ClockPort
Contrato:
nowEpochMs(): number

RESPONSABILIDADE
Tempo CIVIL externo para:
- metadata de save;
- timestamp de aplicação;
- casos de uso que realmente necessitem epoch time.

ClockPort NÃO representa:
- SimulationTick;
- DomainDuration;
- game loop;
- fixed tick;
- cooldown;
- timers de gameplay.

Todo tempo de gameplay continua em src/domain/time.

DECISÃO
ClockPort permanece necessário porque epoch time vem do ambiente externo.

Adapters concretos podem usar APIs da plataforma, mas essas APIs nunca entram
em src/domain.

2. SaveGamePort<TState>
Port genérico assíncrono de persistência.

Operações:
- listSlots();
- load();
- save();
- delete().

O contrato continua genérico para preservar:
- SaveLoadUseCase existente;
- testes existentes;
- compatibilidade de consumers;
- liberdade de formatos de estado em outras aplicações.

SaveGamePort NÃO assume:
- filesystem;
- IndexedDB;
- Steam Cloud;
- Tauri;
- JSON;
- formato binário;
- compressão;
- criptografia.

DomainSaveGamePort.ts
Nova especialização canônica para o estado atual da Layer 2:

DomainSaveState =
SnapshotBundleSnapshot

DomainSaveGamePort =
SaveGamePort<SnapshotBundleSnapshot>

DomainSaveGameRecord =
SaveGameRecord<SnapshotBundleSnapshot>

DomainSaveSnapshot =
VersionedSnapshot<SnapshotBundleSnapshot>

DOIS NÍVEIS DE VERSIONAMENTO
Isso é intencional.

VersionedSnapshot.schemaVersion:
- versão do save da aplicação/caso de uso.

SnapshotBundleSnapshot.schemaVersion:
- versão estrutural do bundle runtime.

Cada SnapshotBundle entry ainda possui:
- typeId;
- codec schemaVersion.

Portanto:
save format version
  -> bundle version
     -> individual aggregate codec version

A Etapa 65 NÃO cria migração automática entre versões.

3. ModdingPort
Port assíncrono de gestão abstrata de mods.

Operações:
- listInstalled();
- refresh();
- setEnabled().

RESPONSABILIDADE
Ocultar infraestrutura externa como:
- origem local;
- conteúdo remoto;
- workshop;
- filesystem;
- mecanismos concretos de carregamento.

O descriptor permanece sem detalhes técnicos de plugin/engine.

DECISÃO
ModdingPort continua necessário porque descoberta/enable de mods depende de
infraestrutura externa.

PORTS DELIBERADAMENTE NÃO CRIADOS

RandomPort / RngPort
NÃO necessário.

Motivo:
DeterministicRng e RandomStream da Etapa 64 são domínio puro, seed explícita e
reproduzível. Não existe dependência externa a inverter.

A entropia externa, se algum produto futuro precisar dela para criar uma seed
inicial, pertence à composição/aplicação e não ao algoritmo determinístico.

EventBusPort / EventPublisherPort
NÃO necessário na Camada 2.

DomainEvent é dado puro.
Integrações da Etapa 62 criam events, mas não publicam.

Entrega/pub-sub pertence à aplicação/Core/engine.

InputPort
NÃO pertence à Camada 2.

Input físico pertence aos módulos técnicos.

RendererPort / PhysicsPort / AudioPort
NÃO pertencem à Camada 2.

O domínio é dimension-agnostic e não executa apresentação/física concreta.

DefinitionSourcePort
NÃO necessário.

GameDefinitions recebe definições estáticas por composição.
Carregamento de arquivos é responsabilidade externa.

SnapshotPort
NÃO necessário.

SnapshotCoordinator é lógica pura de capture/restore em memória.
Persistência do bundle já é atendida por DomainSaveGamePort.

TagPort
NÃO necessário.

DomainTag/TagSet são valores/aggregates puros.

LocationPort
NÃO necessário.

LocationGraph é domínio lógico, não consulta mundo físico.

QuestPort / InventoryPort / ProgressionPort
NÃO necessário.

Esses aggregates já vivem dentro do domínio e não representam infraestrutura.

REGRAS DE ERRO
Ports externos continuam retornando DomainResult quando a falha faz parte da
fronteira de infraestrutura.

SaveGamePortError:
- unavailable;
- permission-denied;
- quota-exceeded;
- corrupted;
- operation-failed.

ModdingPortError:
- unavailable;
- not-found;
- invalid-manifest;
- dependency-conflict;
- permission-denied;
- operation-failed.

ClockPort continua interface mínima síncrona.
Validação de epoch/time metadata pertence ao consumer que cria o snapshot.

ASYNC
SaveGamePort e ModdingPort são async porque infraestrutura pode envolver I/O.

ClockPort é sync porque apenas lê a noção corrente de epoch do adapter.

Nenhum gameplay aggregate fica async por causa desses ports.

PORTABILIDADE
Ports não expõem:
- Vector2/Vector3;
- renderer;
- physics;
- DOM;
- Tauri;
- Steamworks SDK;
- filesystem types;
- browser handles;
- engine internals.

Compatível com:
- 2D;
- 2.5D;
- 3D;
- headless.

PERFORMANCE
Ports não são APIs de hot loop.

ClockPort:
- leitura discreta de metadata.

SaveGamePort:
- save/load explícitos.

ModdingPort:
- lifecycle/gestão explícita.

Nenhum port deve ser consultado a cada render frame.

ETAPA 64
DeterministicRng NÃO foi transformado em port.
Essa é uma decisão explícita da revisão.

ETAPA 66
Portability Gate v2 NÃO é implementado aqui.

A Etapa 65 valida somente:
- shape dos ports;
- dependências permitidas dos ports;
- integração do save canônico;
- retrocompatibilidade dos casos de uso existentes.

A auditoria global de toda Camada 2 pertence à Etapa 66.

PRÓXIMA ETAPA
Etapa 66 — Portability Gate v2.
