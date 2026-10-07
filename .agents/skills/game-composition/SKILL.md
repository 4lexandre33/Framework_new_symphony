---
name: game-composition
description: Criar cena de referência e bootstrap de jogo que consome APIs públicas da engine sem misturar gameplay com internals.
---

# Composição do primeiro jogo sobre a engine

Use para scene/game bootstrap, entidades, assets e sistemas de gameplay do **jogo consumidor**, não para redesenhar a engine.

1. Investigue composition root, services, Domain ports e APIs públicas reais. Defina o owner de dados de jogo/cena sem duplicar Domain ou engine.
2. Construa uma configuração local mínima para habilitar somente os plugins e adapters necessários. Não proclame uma API pública `createApplication` de Stage 98 antes do boundary audit.
3. Conecte uma entidade controlável, câmera, colisores/corpos Rapier e assets locais através de contracts, tokens e facades públicas. Evite import de outro módulo `internal`.
4. Diferencie fixed simulation tick e render frame; nenhum objeto/Promise/listener por frame sem justificativa e medição.
5. Ciclo obrigatório: `create → load → start → pause/resume → unload → dispose` e recuperação de falha com ownership de recursos explícito.
6. Preserve suporte a Tauri em assets/paths, pointer lock e gamepad; Steam só quando requerida e com fallback determinado pelo contrato.
7. Prove em teste de integração e smoke real quando aplicável. É cenário técnico de verificação, **não** é o jogo final nem distribuição de framework.
