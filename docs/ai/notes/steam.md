## notas verificadas (comportamento)
- `commands.send` devolve `Promise<void>`: não há valor de sucesso. Sem Steam o desbloqueio offline é no-op e nada quebra.
- Sem Steam: `isAvailable` = false; `unlockAchievement`/`setStat` resolvem `false`; `createLobby` resolve `null`. Nada rejeita.
- Nunca bloqueie gameplay esperando a Steam.
- `game.steam.net` (SteamNetworkToken) NUNCA é fornecido (G109): NÃO o declare como `optional:false` (o jogo não sobe). Lobby/P2P de sessão: só `SteamApi.createLobby` (sala do host); conexão por SteamID trocado fora do jogo + mensagem "hello" pela `game.net`. Eventos `lobby-*`/`p2p-*` nunca saem (G110).
