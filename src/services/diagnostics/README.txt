PROJETO1 — ÁREA CONCEITUAL

Path: src/services/diagnostics
Camada arquitetural: Camada 3 — Serviços de Aplicação
Status: reservado para implementação futura; este README não é implementação.

FUNÇÃO FUTURA
Agregar e transformar sinais de diagnóstico através de contratos públicos, mantendo ferramentas e implementação concreta fora da lógica de domínio.

DEPENDÊNCIAS PERMITIDAS
- src/domain/** quando houver modelos de estado relevantes.
- APIs públicas, contratos e tokens publicados pelos módulos da engine.
- Interfaces públicas de observabilidade disponibilizadas pelo Core.

DEPENDÊNCIAS PROIBIDAS
- src/engine/<module>/internal/**.
- Acesso direto a drivers Tauri/Steamworks ou objetos concretos de Three.js, Babylon.js e Rapier.
- Mutação de regras de domínio a partir de código de diagnóstico.

EXEMPLOS DE CLASSES FUTURAS
Os nomes abaixo são apenas exemplos arquiteturais e NÃO são criados nesta etapa:
- DiagnosticsService
- RuntimeHealthService
- PerformanceSnapshotService
- CapabilityStatusService

REGRA DESTA ETAPA
Nenhum arquivo .ts placeholder deve existir aqui apenas para completar a árvore.
Implementações futuras devem ser adicionadas somente quando houver requisito funcional real e devem respeitar as fronteiras acima.