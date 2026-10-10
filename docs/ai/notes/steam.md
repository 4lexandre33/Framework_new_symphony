## notas verificadas (comportamento)
- `commands.send` devolve `Promise<void>`: não há valor de sucesso. Sem Steam o desbloqueio offline é no-op e nada quebra.
- Sem Steam: `isAvailable` = false; `unlockAchievement`/`setStat` resolvem `false`; `createLobby` resolve `null`. Nada rejeita.
- Nunca bloqueie gameplay esperando a Steam.
