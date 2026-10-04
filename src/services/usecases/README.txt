PROJETO1 — CAMADA 3 / USE CASES

Path: src/services/usecases
Camada arquitetural: Camada 3 — Serviços de Aplicação
Status: implementação real em andamento; Etapas 44.5 e 44.6 aplicadas.

FUNÇÃO
Implementar casos de uso e serviços de aplicação que orquestram domínio e ports,
coordenando contratos públicos sem incorporar detalhes de infraestrutura.

IMPLEMENTAÇÃO ATUAL
- SaveLoadUseCase.ts
  Save/load genérico baseado em ClockPort e SaveGamePort.
- ModdingAppService.ts
  Gestão abstrata de mods baseada exclusivamente em ModdingPort.
- index.ts
  Fachada dos serviços/casos de uso atualmente implementados.

MODDING APP SERVICE
ModdingAppService:
- listInstalled();
- refresh();
- enable(modId);
- disable(modId);
- setEnabled(modId, enabled).

VALIDAÇÕES DE ADAPTER
O serviço rejeita:
- ModId duplicado em list/refresh;
- setEnabled() retornando outro ModId;
- setEnabled() retornando estado enabled diferente do solicitado.

Falhas legítimas de infraestrutura são preservadas como:
- code: port-error;
- operation: list | refresh | set-enabled;
- cause: ModdingPortError.

REGRA DE INFRAESTRUTURA
ModdingAppService NÃO pode importar nem conhecer:
- DynamicPluginLoader;
- ScriptSandbox;
- SteamWorkshopDriver;
- TauriModdingDriver;
- filesystem;
- APIs Steam Workshop;
- src/plugins/**;
- src/engine/**/internal/**.

Essas integrações ficam atrás de ModdingPort ou de composição/adapters futuros.

SEGURANÇA E RESPONSABILIDADES
Este serviço apenas expressa intenção de aplicação. Ele não executa código de
mods, não decide sandboxing, não concede permissões nativas e não carrega
bibliotecas dinâmicas. Essas responsabilidades permanecem na infraestrutura e
nos guardrails existentes.

DIMENSIONALIDADE
Mods são tratados por metadados e IDs abstratos. O serviço não conhece renderer,
Sprite, Mesh, Vector2, Vector3, física ou world representation; portanto é
compatível com jogos 2D, 2.5D e 3D.

CICLO DE VIDA
As operações são discretas e assíncronas. ModdingAppService não executa polling
no fixed tick ou no render loop.

DEPENDÊNCIAS PERMITIDAS
- src/domain/**.
- APIs públicas estáveis de engine somente quando algum caso de uso futuro
  realmente exigir contrato técnico publicado.

DEPENDÊNCIAS PROIBIDAS
- src/engine/<module>/internal/**.
- src/plugins/**.
- drivers/adapters concretos.
- dependências técnicas externas diretamente no serviço.

PRÓXIMA SUBETAPA
GameFlowFSM entra somente na Etapa 44.7.
