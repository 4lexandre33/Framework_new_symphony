## notas verificadas (comportamento)
- O DOM do UI é montado no `setup` do plugin de UI: declare `dependsOn: game.ui` no jogo.
- `screen-hud` está ativa por padrão; o container `#hud-overlay` começa vazio.
- O HUD genérico usa `data-bind="chave"` e `data-hud-fill="chave"` (max em `data-hud-max` ou `max<Chave>`); o binder varre o DOM no update, não no mount.
