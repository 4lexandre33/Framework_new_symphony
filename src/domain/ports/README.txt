PROJETO1 — CAMADA 2 / PORTS

Path: src/domain/ports
Camada arquitetural: Camada 2 — Domínio
Status: implementação iniciada na Etapa 44.0.

FUNÇÃO
Declarar dependências externas como contratos puros, permitindo que domínio e
casos de uso permaneçam independentes das implementações concretas.

REGRA L2-DIMENSION-AGNOSTIC
Ports não expõem tipos de renderer, física ou dimensionalidade concreta. O mesmo
contrato deve poder servir a jogos 2D, 2.5D e 3D.

IMPLEMENTAÇÃO ATUAL
- ClockPort.ts
  Fonte abstrata de epoch time.
- SaveGamePort.ts
  Persistência abstrata de snapshots versionados.
- ModdingPort.ts
  Gestão abstrata de mods sem expor loaders, filesystem, Steam ou Tauri.
- index.ts
  Fachada da área de ports.

DEPENDÊNCIAS PERMITIDAS
- Tipos e contratos puros de src/domain/**.
- Recursos nativos TypeScript/JavaScript sem infraestrutura.

DEPENDÊNCIAS PROIBIDAS
- src/engine/**, src/services/**, src/app/** e src/plugins/**.
- Tauri, Three.js, Babylon.js, Rapier, Steamworks SDK ou qualquer adapter
  nativo/concreto.

OBSERVAÇÃO
InputIntentPort e EntitlementPort continuam adiados até existir requisito
funcional real. A Etapa 44.0 não cria placeholders.
