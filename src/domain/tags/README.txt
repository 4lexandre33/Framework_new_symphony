PROJETO1 — CAMADA 2 / TAGS

Path: src/domain/tags
Camada arquitetural: Camada 2 — Domínio
Status: implementação real iniciada na Etapa 61.

FUNÇÃO
Fornecer classificação semântica leve e reutilizável, independente de
renderer, física, engine, plataforma e dos aggregates concretos do jogo.

ARQUIVOS

DomainTag.ts
Tag semântica canônica representada como string branded.

Exemplos de tags canônicas:
- combat.fire;
- item.weapon.melee;
- biome.deep-forest;
- faction.hostile.

A brand existe apenas em compile-time.
Runtime continua sendo string.

NORMALIZAÇÃO

normalizeDomainTagValue(value):
1. aplica Unicode NFKC;
2. trim;
3. lowercase;
4. "_" vira "-";
5. whitespace interno por segmento vira "-";
6. hífens repetidos colapsam;
7. "." preserva separação de segmentos;
8. valida formato canônico.

Exemplos:
" Combat.Fire Damage "
-> "combat.fire-damage"

"ITEM_WEAPON"
-> "item-weapon"

FORMATO CANÔNICO
Cada segmento:
- ASCII lowercase;
- dígitos permitidos;
- "-" permitido internamente;
- precisa iniciar/terminar com alfanumérico.

"." separa segmentos.

Exemplos inválidos:
- ".combat";
- "combat.";
- "combat..fire";
- "-combat";
- "combat-";
- "comb@t";
- string vazia.

Tamanho máximo após normalização:
128 caracteres.

createDomainTag(value):
- normaliza;
- valida;
- retorna DomainTag.

isCanonicalDomainTagValue(value):
- não normaliza silenciosamente;
- retorna true apenas se o valor já estiver na forma canônica.

TagSet.ts
Set runtime de DomainTag.

Storage:
Set<DomainTag>

APIs:
- size;
- isEmpty;
- has();
- hasValue();
- add();
- addValue();
- delete();
- deleteValue();
- clear();
- containsAll();
- containsAny();
- equals();
- union();
- intersection();
- difference();
- forEach();
- toArray();
- snapshot/restore.

TagSet.fromValues(strings):
- normaliza todos os valores;
- rejeita colisões de normalização.

Exemplo:
["Combat.Fire", "combat.fire"]
é rejeitado porque ambos resultam em:
"combat.fire"

MUTAÇÃO
add()/delete()/clear() mutam in-place para caminho runtime simples e barato.

add():
- true se inseriu;
- false se já existia.

delete():
- true se removeu;
- false se não existia.

SET OPERATIONS
union(), intersection() e difference():
- não alteram os operands;
- retornam nova TagSet.

containsAll()/containsAny():
- recebem ReadonlySet<DomainTag>;
- não criam arrays intermediários.

DETERMINISMO
Set mantém ordem de inserção para forEach(), mas essa ordem NÃO é usada como
ordem canônica de serialização.

toArray():
- aloca;
- ordena lexicograficamente.

toSnapshot():
- usa ordem canônica.

fromSnapshot():
- normaliza/valida novamente;
- rejeita duplicatas ou colisões de normalização.

PERFORMANCE
has/add/delete:
- O(1) médio.

containsAll/containsAny:
- O(n) sobre o conjunto consultado;
- sem arrays temporários.

equals:
- O(n).

union/intersection/difference:
- operações discretas que alocam nova TagSet.

Snapshot/toArray:
- O(n log n);
- somente sob demanda;
- nunca devem ser usados por frame sem necessidade.

LIMITES DE RESPONSABILIDADE
A Etapa 61 NÃO adiciona tags automaticamente em:
- Definitions;
- Items;
- Inventory;
- Agents;
- Quests;
- NarrativeState;
- Factions;
- Conditions;
- Gameplay Rules;
- Events.

Também NÃO interpreta tags como comportamento.

Exemplo:
"combat.fire"
não aplica dano, modifier ou status effect.

A integração cross-domain é responsabilidade da Etapa 62.

PORTABILIDADE
Zero dimensionalidade.

Mesmo código:
- 2D;
- 2.5D;
- 3D;
- headless.

DEPENDÊNCIAS PROIBIDAS
- src/core/**
- src/engine/**
- src/services/**
- src/app/**
- src/plugins/**
- Three.js
- Babylon.js
- Rapier
- WebGL
- DOM
- Tauri
- Steamworks SDK
- wall clock;
- RNG global.

PRÓXIMA ETAPA
Etapa 62 — Cross-domain integration.
