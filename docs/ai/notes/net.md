## notas verificadas (comportamento)
- Sem Steam o transporte é WebSocket CLIENTE: `startHost()` resolve `false`; `connect("ws://…")` só conecta a um servidor/relay externo. Não há transporte mock/loopback nem host no navegador. Host P2P real só com Steam (Tauri).
- `sendTo`/`broadcast` resolvem `false` em modo `offline`. Nada lança.
- No tick a engine só faz `pollPackets()`. Snapshots NÃO são enviados sozinhos: o jogo gera (`getStateReplicator().generateWorldSnapshot`), serializa em `Uint8Array` e chama `broadcast`. Recebimento: evento `game.net.packet-received`.
- `registerEntity`/`updateEntityState`/`getInterpolatedState` funcionam em memória, sem conexão.
- Para testar multiplayer no jogo: isole a rede atrás de uma porta do jogo e use um transporte loopback de TESTE (dois "peers" em memória).
- `StateReplicator`: `pushEntitySnapshot` ignora snapshot com `sequence` não mais novo que o último; cria a entidade se não existir (`registerEntity` é opcional). `getInterpolatedState(id, alpha)` interpola entre os DOIS ÚLTIMOS snapshots com `alpha` 0..1 (com 1 snapshot devolve ele). Logo `alpha` deve ser "tempo desde a chegada do último snapshot ÷ intervalo entre snapshots", não o alpha do render. O objeto devolvido é reutilizado: copie os números.
- Steam: só canais 0 e 1 funcionam; pacote não confiável ≤ 1.200 B (G104). Queda de par não é detectada: faça heartbeat (G105). `rttMs` sempre 0 (G108).
