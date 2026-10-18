## notas verificadas (comportamento)
- Catálogo: começa com 2 SKUs de exemplo; registre o do jogo com `registerCatalog(itens, { replace: true })` ou `registerCatalogItem` (valida; lança se inválido).
- Carteira (`creditCurrency`/`debitCurrency`/`getWalletBalance`) em memória, funciona offline. Valores precisam ser inteiros seguros > 0 (inválido: `debitCurrency` false, crédito ignorado); `debitCurrency` false sem saldo. NÃO persiste: salve o saldo no `game.storage` e recredite no boot.
- Dinheiro real só com um `PurchaseProvider` do SERVIDOR do jogo (`setPurchaseProvider`): sem ele `isPurchaseSupported()` é false, `initPurchase` resolve `null` (+ `purchase-failed` "unsupported") e nada é creditado. Com ele, só o que o recibo verificado concede é entregue (`wallet-updated`, `item-granted`, `getEntitlements()`); `validateReceipt` só aceita recibos aprovados nesta sessão.
- Steam Inventory: itens com `steamItemDefId`; `fetchSteamInventory`, `consumeInventoryItem`, `startInventoryPurchase` (checkout da Steam). Sem Steam: `[]`/`false`. Não verificado com Steam real (GAPS NV).
- `clear()` zera carteira/ordens/inventário em cache (o catálogo fica).
