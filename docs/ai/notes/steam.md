## notas verificadas (comportamento)
- O plugin `game.steam` fornece DOIS tokens: `game.steam` (SteamApi) e `game.steam.net` (SteamNetworkToken: lobbies + P2P). Consuma `game.steam.net` com `optional: true` se quiser o jogo de pé mesmo num host sem ele.
- Sem Steam (navegador, ou app sem cliente): nada lança. `isAvailable` false; `unlockAchievement`/`setStat`/`joinLobby`… resolvem `false`; `createLobby`/`getLobbyOwner` `null`; `searchLobbies`/`getLobbyMembers`/`readP2PPackets` `[]`. Nunca bloqueie gameplay esperando a Steam.
- Boot: a disponibilidade é resolvida no `onBoot` do plugin e anunciada em `game.steam.availability-changed`; mesmo assim `await steam.checkAvailability()` antes de decidir. Stats/conquistas confiáveis após `game.steam.stats-ready` (`statsReady`).
- Conquistas: `await steam.unlockAchievement(id)` (boolean). Stats: `setStat(nome, v)` = inteiro 32 bits; `setStat(nome, v, { type: "float" })`; `getStat`; depois `storeStats()`.
- Comandos devolvem o retorno do handler (`commands.send("game.steam.create-lobby", …)` resolve com os detalhes), mas prefira os métodos do token.
- Lobby (`game.steam.net`): `createLobby(tipo, max)` → `SteamLobbyDetails`; `setLobbyData`/`getLobbyData`; `searchLobbies({ stringFilters, numberFilters, slotsAvailable, distance })`; `joinLobby`, `leaveLobby`, `getLobbyOwner`, `getLobbyMembers`, `inviteToLobby`, `openInviteDialog`, `setLobbyJoinable`. Eventos: `lobby-created`, `lobby-joined`, `lobby-member-left`, `lobby-data-updated`, `lobby-invite` (convite/"Entrar no jogo"), `p2p-session-request`, `p2p-session-failed`.
- Sessão de jogo: entre no lobby, pegue `getLobbyOwner` e chame `game.net.connect(steamIdDoDono)`; o `game.net` cuida de P2P, handshake e heartbeat.
- Não verificado com cliente Steam real (GAPS NV).
