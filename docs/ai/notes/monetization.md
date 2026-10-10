## notas verificadas (comportamento)
- `getCatalog()` devolve 2 SKUs fixos (`gold_pack_small`, `gold_pack_large`); não há API pública para registrar itens. Itens/cosméticos do jogo: mantenha o catálogo no jogo.
- Carteira (`creditCurrency`/`debitCurrency`/`getWalletBalance`) é em memória e funciona offline; `debitCurrency` retorna false sem saldo. Não persiste sozinha: salve o saldo via `game.storage`.
- `initPurchase` offline cria recibo falso pendente (não é compra real); inventário Steam devolve `[]`/false sem Tauri. Não use compra real em testes.
- A compra é falsa também no app nativo e dá ouro sem cobrança (G119). Valide valores antes de `creditCurrency`/`debitCurrency` (G120).
