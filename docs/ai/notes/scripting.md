## notas verificadas (comportamento)
- A engine chama `update(dt)` no tick (avança a timeline de cutscene). Não chame `update` no jogo.
- Zonas de gatilho NÃO são verificadas sozinhas: chame `checkEntityInZones(entityId, pos)` no tick para cada entidade que importa; aí saem `game.scripting.trigger-entered/exited`.
- LACUNA: os keyframes de cutscene não executam nada nem emitem evento por keyframe; só `cutscene-started` e `cutscene-finished`. A câmera/áudio da cutscene é feita pelo jogo reagindo a esses dois eventos.
- Quests e diálogos funcionam em memória: `startQuest`, `advanceQuestProgress`, `startDialogue`/`advanceDialogue` (emitem `quest-updated` e `dialogue-changed`).
