PROJETO1 — CAMADA 2 / NARRATIVE

Path: src/domain/narrative
Camada arquitetural: Camada 2 — Domínio
Status: implementação real iniciada na Etapa 44.4.

FUNÇÃO
Modelar narrativa de alto nível, diálogos, goals de quests e estados narrativos
sem depender de UI, áudio, scripting, renderização, física ou persistência
concretos.

REGRA L2-DIMENSION-AGNOSTIC
DialogueGraph e QuestGoal são idênticos para jogos 2D, 2.5D e 3D.

- speakerId é identidade lógica, não Sprite/Mesh/AudioSource.
- conditionId é identidade lógica, não função de scripting concreta.
- QuestGoal.targetId é referência semântica opaca, não posição/Vector2/Vector3.
- UI, câmera, voz, áudio, cutscene, trigger zone e world objects ficam fora da
  Camada 2.

DIALOGUE GRAPH
DialogueGraph é uma definição imutável formada por quatro tipos de nó:
- line;
- choice;
- branch;
- end.

Validações na construção:
- grafo vazio;
- node id duplicado;
- entry inexistente;
- texto inválido;
- choice node sem opções;
- choice id duplicado dentro do node;
- destino inexistente;
- node inalcançável.

Loops são permitidos intencionalmente. Um diálogo pode voltar a um node anterior;
portanto DialogueGraph NÃO é tratado como DAG.

Branches possuem DialogueConditionId opaco. O grafo apenas seleciona
whenTrueNodeId/whenFalseNodeId a partir de um boolean já avaliado pela camada
superior.

QUEST GOAL
QuestGoal é estado runtime puro com:
- QuestGoalId;
- QuestGoalKindId;
- QuestGoalTargetId opcional;
- requiredProgress;
- progress;
- status.

Lifecycle:
inactive -> active -> completed
inactive -> active -> failed

advance() é event-driven, satura em requiredProgress e completa automaticamente.
complete() e fail() são transições explícitas.

QuestGoal.fromSnapshot() permite reconstrução validada de estado persistido sem
introduzir storage concreto no domínio.

PERFORMANCE
- DialogueGraph usa Map<DialogueNodeId, DialogueNode>.
- definições são clonadas/congeladas uma vez no construtor.
- navegação é O(1) por node mais a busca local de choice.
- QuestGoal muta números/status in-place.
- nenhum componente da Etapa 44.4 exige update por frame.

DEPENDÊNCIAS PERMITIDAS
- Entidades, ports e regras puras de src/domain/**.
- Estruturas de dados determinísticas e serializáveis.

DEPENDÊNCIAS PROIBIDAS
- src/engine/**, src/services/**, src/app/** e src/plugins/**.
- UI concreta, áudio concreto, filesystem, Tauri, Steamworks SDK, Three.js,
  Babylon.js, Rapier, DOM ou bibliotecas de renderização.

PRÓXIMA SUBETAPA
SaveLoadUseCase entra somente na Etapa 44.5.
