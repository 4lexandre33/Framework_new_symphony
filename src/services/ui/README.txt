PROJETO1 — ÁREA CONCEITUAL

Path: src/services/ui
Camada arquitetural: Camada 3 — Serviços de Aplicação
Status: reservado para implementação futura; este README não é implementação.

FUNÇÃO FUTURA
Orquestrar casos de aplicação ligados à apresentação e UI através de ports, contratos e APIs públicas, sem acessar implementação privada de engine.

DEPENDÊNCIAS PERMITIDAS
- src/domain/**.
- APIs públicas estáveis de módulos em src/engine/<module>/public quando existirem.
- Contratos e capability tokens publicados que não exponham implementações concretas.

DEPENDÊNCIAS PROIBIDAS
- src/engine/<module>/internal/**.
- Implementações internas de outros módulos, bridges concretas de plugin ou acesso direto a Tauri/Steamworks.
- Three.js, Babylon.js ou Rapier usados diretamente como detalhe de implementação da camada de serviço.

EXEMPLOS DE CLASSES FUTURAS
Os nomes abaixo são apenas exemplos arquiteturais e NÃO são criados nesta etapa:
- HUDProjectionService
- MenuNavigationService
- LocalizationPresentationService
- NotificationService

REGRA DESTA ETAPA
Nenhum arquivo .ts placeholder deve existir aqui apenas para completar a árvore.
Implementações futuras devem ser adicionadas somente quando houver requisito funcional real e devem respeitar as fronteiras acima.