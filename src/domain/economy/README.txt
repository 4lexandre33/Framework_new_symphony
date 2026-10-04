PROJETO1 — CAMADA 2 / ECONOMY

Path: src/domain/economy
Camada arquitetural: Camada 2 — Domínio
Status: Item/Inventory desde Etapas 44.1/44.2; economia expandida na Etapa 56.

FUNÇÃO
Modelar economia lógica independente de apresentação e infraestrutura:
- Item;
- Inventory;
- CurrencyId;
- CurrencyAccount;
- Cost;
- Reward;
- RewardPolicy;
- LootEntry;
- LootTable;
- CraftingRecipe.

CurrencyId.ts
Identificador nominal de moeda.

Exemplos:
- currency.gold;
- currency.credits;
- currency.guild-token.

CurrencyAccount.ts
Conta runtime de uma única CurrencyId.

Invariantes:
- balance inteiro seguro >= 0;
- credit estrito;
- tryDebit atômico;
- tryTransferTo valida saldo, CurrencyId e overflow antes de mutar.

Não representa:
- carteira de plataforma;
- pagamento real;
- loja;
- microtransação;
- conta externa.

Cost.ts
Custo imutável composto por uma ou mais moedas.

Invariantes:
- ao menos uma entrada;
- amount >= 1;
- CurrencyId não pode repetir;
- entradas ordenadas por CurrencyId.

Cost.canAfford(accounts):
- valida cobertura sem mutação.

Cost.tryPay(accounts):
- indexa contas por CurrencyId;
- rejeita contas duplicadas;
- verifica TODAS as moedas/saldos primeiro;
- só então executa débitos;
- false = nenhuma mutação.

Portanto, um custo multi-moeda nunca fica parcialmente pago por insuficiência
de saldo.

Reward.ts
Descrição imutável de recompensa.

Pode declarar:
- moedas;
- itens.

Reward NÃO aplica automaticamente nada.

A conexão:
Reward -> CurrencyAccount
Reward -> Inventory
permanece para a Etapa 62 — Cross-domain integration.

RewardPolicy.ts
Política de resolução de tabela ponderada:
- rolls;
- with-replacement;
- without-replacement.

Default:
- 1 roll;
- with-replacement.

A policy não possui RNG e não executa grants.

LootEntry.ts
Entrada ponderada:
- LootEntryId;
- weight inteiro seguro >= 1;
- Reward.

LootTable.ts
Tabela ponderada com:
- LootTableId;
- entradas únicas;
- ordem canônica por LootEntryId;
- soma de pesos validada;
- snapshot/restore.

DETERMINISMO
LootTable nunca acessa uma fonte aleatória global.

A API exige:
LootRandomSource {
  nextFloat(): number
}

Contrato:
- valor finito;
- intervalo [0, 1).

Isso permite:
- testes headless com sequência fixa;
- replay determinístico;
- futuro RNG oficial da Etapa 64;
- mesma LootTable em 2D/2.5D/3D.

A Etapa 56 NÃO implementa o RNG oficial da Etapa 64.
Ela apenas recebe a dependência.

RewardPolicy:
with-replacement:
- cada roll considera todas as entradas.

without-replacement:
- uma entrada selecionada não participa dos próximos rolls;
- solicitar mais rolls que entradas é erro.

CraftingRecipe.ts
Definição imutável:
- CraftingRecipeId;
- ingredientes ItemId + quantity;
- Cost opcional;
- Reward de saída.

Recipe precisa de:
- pelo menos um ingrediente; OU
- um Cost.

CraftingRecipe NÃO:
- consulta Inventory;
- remove ingredientes;
- paga Cost;
- adiciona Reward.

A execução atômica completa de crafting fica para orquestração/integracão
cross-domain posterior.

PERFORMANCE
CurrencyAccount:
- O(1), sem arrays em mutações.

Cost:
- construção ordena uma vez;
- pagamento cria Map apenas na operação discreta;
- valida tudo antes de mutar.

Reward:
- construção normaliza/ordena uma vez;
- getters retornam referências readonly.

LootTable:
- construção ordena uma vez;
- weighted selection O(n);
- with-replacement aloca apenas resultados;
- without-replacement usa Set de selecionados;
- nenhuma execução automática por frame.

CraftingRecipe:
- construção normaliza/ordena ingredientes;
- runtime somente leitura.

LIMITE DE ETAPA
Etapa 57 — Progression NÃO é implementada aqui:
- ProgressionCurve;
- ExperiencePool;
- LevelProgression;
- UnlockSet;
- ProgressionSnapshot.

Também NÃO implementado:
- RNG determinístico oficial;
- tags;
- definitions registry;
- gameplay-rule integration;
- reward grant execution;
- crafting execution.

DEPENDÊNCIAS PROIBIDAS
- src/core/**
- src/engine/**
- src/services/**
- src/app/**
- src/plugins/**
- stack gráfica/física/nativa concreta.

PRÓXIMA ETAPA
Etapa 57 — Progression.
