## notas verificadas (comportamento)
- O DOM do UI é montado no `setup` do plugin de UI: declare `dependsOn: game.ui` no jogo.
- `screen-hud` está ativa por padrão; o container `#hud-overlay` começa vazio.
- O HUD genérico usa `data-bind="chave"` e `data-hud-fill="chave"` (max em `data-hud-max` ou `max<Chave>`); o binder varre o DOM no update, não no mount.
- As telas embutidas (`main_menu`, `game_over`, `pause_menu`…) são placeholders (só título; o menu diz "Projeto 1"). `openScreen` só alterna visibilidade. Menus do jogo: monte o seu DOM num adapter ou use `pushModal({contentHtml})`.
- `contentHtml` vai direto para `innerHTML` SEM sanitização: escape qualquer texto vindo de jogador/rede (nomes Steam, chat).
- LACUNA: `ModalConfig.templateId` é ignorado (templates registrados nunca são instanciados).
- A engine reage a `[data-action]` dentro de `#ui-root` (ex.: `start-game` carrega `level_01`) e captura ESC (abre `pause_menu` e esconde o HUD) (G96): use atributo próprio (`data-<jogo>-action`) e trate `screen-changed`.
- `setLocale` reescreve `[data-i18n]` em todo o DOM (G97): não use esse atributo no jogo. Comando `pop-modal` fecha sempre o do topo (G98). Registre listeners em `document`, não no canvas (G99).
