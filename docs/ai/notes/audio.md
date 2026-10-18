## notas verificadas (comportamento)
- Toque só sons já carregados (`assets.loadAudio`); som não carregado não toca (handle 0 + warn).
- `playSound`/`playPositionalSound` devolvem `SoundHandle`: `stopSound(h, fade?)`, `setSoundVolume`, `setSoundPosition`, `setSoundOrientation`, `setSoundPlaybackRate`, `isSoundPlaying`. Loop ambiente = `playSound(url, canal, vol, true)` + `stopSound(h, fade)`.
- Desbloqueio: a engine chama `resume()` sozinha no 1º gesto (clique/tecla/toque). One-shots pedidos antes só tocam se o gesto vier em ~250 ms; loops começam ao desbloquear. `state` informa o contexto ("unavailable" = sem Web Audio: tudo mudo, sem lançar).
- Posicional: `options.channel` (padrão "sfx"), `refDistance`, `maxDistance` (+ `maxDistanceMode` "silence"/"clamp"), `distanceModel`, cones apontados por `orientation`.
- Canais: `setChannelVolume(c, v)` mantém o mudo; `setChannelMuted`; `stopChannel(c, fade?)` (não afeta a música).
- Música: `crossfadeMusic(url, { durationSeconds, loop })` resolve e emite `crossfade-completed` só no FIM do fade; mesma faixa = no-op (salvo `restart`). `stopMusic(fade?)` + `music-stopped`; `getCurrentMusicTrack()`.
- Ouvinte: `updateListenerPosition(pos, forward?, up?)` no `game.loop.render`.
- Vozes: limite padrão 32 (rouba o one-shot mais antigo); `setVoiceLimit(max, maxHrtf?)`. `stopAllSounds(fade?)` para tudo.
