## notas verificadas (comportamento)
- O DOM do UI é montado no `setup` do plugin de UI: declare `dependsOn: game.ui` no jogo.
- `screen-hud` está ativa por padrão; o container `#hud-overlay` começa vazio.
- O HUD genérico usa `data-bind="chave"` e `data-hud-fill="chave"` (max em `data-hud-max` ou `max<Chave>`); o binder varre o DOM no update, não no mount.
- As telas embutidas (`main_menu`, `game_over`, `pause_menu`…) são placeholders (só título; o menu diz "Projeto 1"). `openScreen` só alterna visibilidade. Menus do jogo: monte o seu DOM num adapter ou use `pushModal({contentHtml})`.
- `contentHtml` vai direto para `innerHTML` SEM sanitização: escape qualquer texto vindo de jogador/rede (nomes Steam, chat).
- LACUNA: `ModalConfig.templateId` é ignorado (templates registrados nunca são instanciados).
