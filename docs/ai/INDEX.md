# Manual de IA — criar jogos sobre esta engine
versão 1.0.0 · GERADO por `npm run ai-manual:generate` (não edite à mão; `npm run ai-manual:check` falha se divergir do código)

## Como usar (economize tokens)
1. Leia `docs/ai/RULES.md` (regras, obrigatório, curto).
2. Leia `docs/ai/CORE.md` (contrato do plugin: manifest, ctx.caps/events/commands, lifecycle).
3. Leia SÓ os módulos que o jogo usa, em `docs/ai/modules/<chave>.md`, pela tabela abaixo.
4. Copie a estrutura de `src/projects/_template/` e consulte `docs/ai/RECIPES.md`.
5. Não leia `src/engine/**`: o digest já é a API pública.

## Preciso de … → módulo
| preciso de | módulo (chave) | capability / id do plugin (use em dependsOn) | plugin depende de | ~tokens |
|---|---|---|---|---|
| Steamworks & P2P | steam | game.steam | - | 1775 |
| Input Manager | input | game.input | - | 750 |
| Asset Pipeline & VRAM Cache | assets | game.assets | - | 588 |
| Motor de Física (Rapier WASM) | physics | game.physics | - | 1426 |
| Persistência & Banco de Dados | storage | game.storage | - | 894 |
| Gerenciador de Mundo, Cenas & ECS | world | game.world | - | 1110 |
| Interface de Usuário & HUD | ui | game.ui | - | 903 |
| Pipeline de Animações & State Machines | anim | game.anim | game.loop | 1044 |
| Motor 2D, Tilemaps & Pixel Art | sprites | game.sprites | - | 1175 |
| Mixer de Áudio Espacial 3D | audio | game.audio | - | 1029 |
| Câmera Dinâmica & SpringArm | camera | game.camera | game.loop, game.physics, game.render | 1095 |
| Inteligência Artificial & NavMesh | ai | game.ai | game.loop, game.physics, game.world | 1110 |
| Partículas GPU, Decals & Pós-Processamento | vfx | game.vfx | - | 1241 |
| Terreno Procedural, Biomas & Voxels | terrain | game.terrain | game.loop, game.render | 828 |
| Cutscenes, Diálogos & Quests | scripting | game.scripting | game.loop | 1518 |
| Streaming Espacial, LOD & HLOD | streaming | game.streaming | game.loop, game.camera | 1028 |
| Desktop Overlay & Raycast Click Passthrough | overlay | game.overlay | game.loop | 684 |
| Profiler, Anti-cheat & Crash Dumper | security | game.security | game.loop | 786 |
| Steam Workshop, Dynamic Loading & Asset Override | modding | game.modding | - | 984 |
| Microtransações Steam & Steam Inventory Service | monetization | game.monetization | - | 1254 |
| Deterministic Game Loop | game-loop | game.loop | - | 461 |
| Render Runtime | render | game.render | - | 927 |
| Multiplayer Network & State Replication | net | game.net | game.loop | 1259 |

Tamanho: RULES ≈ 992, CORE ≈ 2859, RECIPES ≈ 2932, todos os módulos ≈ 23869 tokens (estimativa: caracteres/3,6).

## Atalhos por tipo de jogo
- 3D com física: render, camera, physics, input, assets, audio, ui, game-loop.
- Persistência: storage. Multiplayer: net (+ steam para lobby/P2P). Steam/conquistas: steam.
- Mundo/IA/roteiro: world, ai, scripting. Efeitos: vfx. Terreno procedural: terrain, streaming.

## Fora deste manual (consulte só se precisar)
- Empacotar/Windows/Steam release: `docs/layer1/native-tauri-steam.md`. Passo a passo humano: `docs/layer1/creating-a-game.md`.
- Ciclo do kernel e recuperação de falhas: `docs/layer1/runtime-lifecycle.md`. Regras permanentes do repositório: `AGENTS.md`.
