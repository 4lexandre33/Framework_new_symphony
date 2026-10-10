# Manual de IA — criar jogos sobre esta engine
versão 1.0.0 · GERADO por `npm run ai-manual:generate` (não edite à mão; `npm run ai-manual:check` falha se divergir do código)

## Como usar (economize tokens)
1. Leia `docs/ai/RULES.md` (regras, obrigatório, curto).
2. Leia `docs/ai/CORE.md` (contrato do plugin: manifest, ctx.caps/events/commands, lifecycle).
3. Leia SÓ os módulos que o jogo usa, em `docs/ai/modules/<chave>.md`, pela tabela abaixo.
4. Copie a estrutura de `src/projects/_template/` e consulte `docs/ai/RECIPES.md`.
5. Leia `docs/ai/GAPS.md` (o que a engine não faz e como contornar) antes de planejar.
6. Não leia `src/engine/**`: o digest + notas verificadas já são a API pública.

## Preciso de … → módulo
| preciso de | módulo (chave) | capability / id do plugin (use em dependsOn) | plugin depende de | ~tokens |
|---|---|---|---|---|
| Steamworks & P2P | steam | game.steam | - | 1895 |
| Input Manager | input | game.input | - | 2212 |
| Asset Pipeline & VRAM Cache | assets | game.assets | - | 1320 |
| Motor de Física (Rapier WASM) | physics | game.physics | - | 4040 |
| Persistência & Banco de Dados | storage | game.storage | - | 1099 |
| Gerenciador de Mundo, Cenas & ECS | world | game.world | - | 2303 |
| Interface de Usuário & HUD | ui | game.ui | - | 1990 |
| Pipeline de Animações & State Machines | anim | game.anim | game.loop | 1213 |
| Motor 2D, Tilemaps & Pixel Art | sprites | game.sprites | game.render, game.assets | 1827 |
| Mixer de Áudio Espacial 3D | audio | game.audio | - | 2110 |
| Câmera Dinâmica & SpringArm | camera | game.camera | game.loop, game.physics, game.render | 1887 |
| Inteligência Artificial & NavMesh | ai | game.ai | game.loop, game.physics, game.world | 1425 |
| Partículas GPU, Decals & Pós-Processamento | vfx | game.vfx | - | 2123 |
| Terreno Procedural, Biomas & Voxels | terrain | game.terrain | game.loop, game.render | 1109 |
| Cutscenes, Diálogos & Quests | scripting | game.scripting | game.loop | 1744 |
| Streaming Espacial, LOD & HLOD | streaming | game.streaming | game.loop, game.camera | 1245 |
| Desktop Overlay & Raycast Click Passthrough | overlay | game.overlay | game.loop | 875 |
| Profiler, Anti-cheat & Crash Dumper | security | game.security | game.loop | 959 |
| Steam Workshop, Dynamic Loading & Asset Override | modding | game.modding | - | 1108 |
| Microtransações Steam & Steam Inventory Service | monetization | game.monetization | - | 1447 |
| Deterministic Game Loop | game-loop | game.loop | - | 825 |
| Render Runtime | render | game.render | - | 2774 |
| Multiplayer Network & State Replication | net | game.net | game.loop | 1652 |

Tamanho: RULES ≈ 1751, CORE ≈ 2859, RECIPES ≈ 4771, todos os módulos ≈ 39182 tokens (estimativa: caracteres/3,6).

## Atalhos por tipo de jogo
- 3D com física: render, camera, physics, input, assets, audio, ui, game-loop.
- Persistência: storage. Multiplayer: net (+ steam para lobby/P2P). Steam/conquistas: steam.
- Mundo/IA/roteiro: world, ai, scripting. Efeitos: vfx. Terreno procedural: terrain, streaming.

## Fora deste manual (consulte só se precisar)
- Empacotar/Windows/Steam release: `docs/layer1/native-tauri-steam.md`. Passo a passo humano: `docs/layer1/creating-a-game.md`.
- Ciclo do kernel e recuperação de falhas: `docs/layer1/runtime-lifecycle.md`. Regras permanentes do repositório: `AGENTS.md`.
