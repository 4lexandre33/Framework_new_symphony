## notas verificadas (comportamento)
- A engine atualiza no tick usando a POSIÇÃO DA CÂMERA ativa (`game.camera`) como centro; `updateStreamingCenter` é sobrescrito por isso quando há câmera.
- Setores: `registerSector` (bounds definem o centro). Ao entrar/sair do raio, saem `game.streaming.sector-loaded`/`sector-unloaded`. `assetUrls` é ignorado (nada é baixado): o jogo reage aos eventos e cria/remove o conteúdo do setor (ex.: pedir chunks de terreno).
- Raio padrão 100 (+15 de histerese). Mudar: comando `game.streaming.set-radius` `{loadRadius, hysteresisMargin}` (não há método no token). A distância inclui Y: com câmera alta use raio maior.
- LOD: `registerLODEntity` + `game.streaming.lod-changed`; `meshUrl` não é carregado, o jogo troca o detalhe ao receber o evento.
