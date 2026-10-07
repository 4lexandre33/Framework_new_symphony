---
name: game-runtime
description: Alterar game loop, Three.js, Rapier, streaming, input e ciclo de vida mantendo determinismo, performance e teardown.
---

# Alterações de runtime WebGL

Use apenas para issues de simulação, render, física, cenas, input, streaming e recursos vivos.

1. Localize o owner do sistema com `scripts/architecture/module-map.mjs` e busque somente APIs públicas e testes relevantes.
2. Distinga `fixed tick`, `render frame` e `wall clock`; simulação determinística não depende da taxa de render.
3. Preserve interpolação, lifecycle reverso e as fronteiras `/public`/`/internal`.
4. Evite novos objetos, closures, Promises ou listeners em `update`/`tick`/`render` e crescimento não limitado de estruturas.
5. Reutilize buffers e mantenha ownership de geometries, materials, textures, render targets e alocações Rapier explícito.
6. Trate Pointer Lock, foco, teclado/mouse e gamepads, removendo handlers no teardown.
7. Valide regressão funcional e um cenário de stress quando a issue alterar hot paths; não afirme ausência de alocação sem medição ou revisão apropriada.
