## notas verificadas (comportamento)
- Caminhos do jogo: `/projects/<jogo>/...` (pasta `public/projects/<jogo>/`). A chave de cache é a URL normalizada (`./a`, `a` e `/a` são o mesmo asset; `normalizeUrl`).
- Refcount: cada `load*` retém +1; libere com `releaseAsset(url)` (mesmas opções de textura). Liberar a mais não fica negativo. `clearCache()` só libera o que não tem referência (`{ force: true }` só em teardown).
- `loadGLTF` devolve uma INSTÂNCIA nova (`scene` clonada, compartilha geometria/material/textura com o cache): uma chamada + um `releaseInstance(gltf)` (ou `releaseAsset(url)`) por instância. A GPU compartilhada (de GLTFs e texturas em cache) leva a marca `RENDER_SHARED_RESOURCE`: `removeMeshFromScene(chave)` normal NÃO a libera (só o que o jogo criou/clonou); ela sai quando a última referência deixa o cache — remova as instâncias da cena antes. `getAsset(url)` é o modelo-base (não adicione à cena).
- `loadTexture(url, { colorSpace })`: "srgb" (padrão, cor) ou "linear"/"none" (normal, dados); cada combinação de opções é um asset distinto.
- `loadJSON`/`loadBinary` com cache e refcount. `preloadManifest(manifest)` dá progresso real (`game.assets.manifest-progress`), falhas em `failed` + `game.assets.load-failed`, e acesso por id (`getAsset(id)`); `releaseManifest` libera.
- `loadAudio` não espera o gesto do usuário (decodifica com o áudio bloqueado); sem Web Audio rejeita com erro claro.
- Em vitest/node: mocke `AssetsApi` (fakes parciais, receita 11).
