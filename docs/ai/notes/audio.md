## notas verificadas (comportamento)
- Tocar um som que NÃO foi carregado/cacheado apenas emite warn silencioso (não lança). Carregue antes (assets) e só então toque.
- Caminhos de assets do jogo: `/projects/<jogo>/...` (pasta `public/projects/<jogo>/`).
- LACUNA: `playSound`/`playPositionalSound` não devolvem handle: não dá para parar um som específico nem mover um som posicional. Só `stopAllSounds()` e volume por canal. Contorno: prefira one-shots curtos repetidos (ex.: "clac" do trilho a cada N s na posição atual); para um loop ambiente (chuva) reserve um canal (ex.: `voice`) e use `setChannelVolume` para ligar/desligar; música só por `crossfadeMusic`.
- Ouvinte: chame `updateListenerPosition` no `game.loop.render` com a posição da câmera (`camera.getCurrentCameraSnapshot()`).
- `loadAudio` fica PENDENTE até o primeiro gesto do usuário (G80): mostre "clique para começar" antes de carregar sons. `setChannelVolume(c, v)` sem o 3º argumento desmuta (G84). `crossfade-completed` sai no início (G84).
