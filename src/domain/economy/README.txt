PROJETO1 — CAMADA 2 / ECONOMY

Path: src/domain/economy
Camada arquitetural: Camada 2 — Domínio
Status: implementação real em andamento; Etapas 44.1 e 44.2 aplicadas.

FUNÇÃO
Concentrar regras puras de itens, inventário, economia, recompensas, moedas,
custos e progressão sem conhecimento de loja, plataforma ou persistência
concreta.

REGRA L2-DIMENSION-AGNOSTIC
Item e Inventory são modelos de gameplay. Não contêm posição, sprite, mesh,
modelo 3D, collider, material, texture handle, camera ou qualquer representação
visual. Os mesmos modelos podem ser utilizados por jogos 2D, 2.5D ou 3D.

IMPLEMENTAÇÃO ATUAL
- Item.ts
  Definição imutável com ItemId, nome, descrição opcional e maxStack.
- Inventory.ts
  Inventário por Map<ItemId, entry>, lookup O(1) médio, quantidade agregada,
  capacidade opcional por slots e ocupação calculada através de maxStack.
- index.ts
  Fachada da área economy.

MODELO DE STACK
Inventory não materializa um array de stacks. Para um Item com maxStack=20:
- quantity 1..20 ocupa 1 slot;
- quantity 21..40 ocupa 2 slots;
- quantity 41..60 ocupa 3 slots.

Isso permite respeitar stack size sem criar objetos de stack em cada mutação.

PERFORMANCE
- getQuantity()/has()/getItem(): O(1) médio.
- add()/remove(): O(1) médio.
- occupiedSlots e totalUnits são incrementais.
- adicionar novamente o mesmo ItemId apenas muta a entrada existente.
- toSnapshot() é a operação deliberadamente alocadora e ordena por ItemId para
  serialização determinística; não deve ser chamada por frame.

INVARIANTES
- quantity é inteiro seguro >= 1.
- maxSlots é null ou inteiro seguro >= 1.
- o mesmo ItemId não pode entrar com duas definições conflitantes.
- operações que excedem capacidade falham sem mutar estado.
- remover mais do que existe satura a quantidade em zero.

DEPENDÊNCIAS PERMITIDAS
- Entidades, value objects e ports de src/domain/**.
- Funções e tipos puros sem efeitos de infraestrutura.

DEPENDÊNCIAS PROIBIDAS
- src/engine/**, src/services/**, src/app/** e src/plugins/**.
- Steam MicroTxn, monetização concreta, Tauri, banco de dados, rede, Three.js,
  Babylon.js, Rapier, DOM ou APIs de plataforma.

PRÓXIMA SUBETAPA
AbilityAction e SkillTreeGraph entram somente na Etapa 44.3.
