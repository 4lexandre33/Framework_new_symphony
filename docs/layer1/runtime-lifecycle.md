# Layer 1 — Runtime e lifecycle

Este documento resume os invariantes de runtime certificados nas Stages 74–87.
Os detalhes e os números exatos estão nos documentos `ETAPA*.txt` citados.

## 1. Kernel como coordenador único

O Kernel é o único dono do lifecycle. Não existe segundo Kernel, segundo
registry de capabilities nem segundo backbone de eventos/comandos/queries. A
fachada pública está em `src/core/index.ts` (alias `@core`); consumidores não
importam `src/core/internal/**` nem `src/core/runtime/**`.

```text
idle -> booting -> running -> stopping -> stopped
```

- **Boot estrito:** se o boot falha, há rollback automático, o erro original é
  preservado, o `status` fica `failed` e a `phase` termina em `stopped`
  (implementação em `src/core/runtime/boot.ts`).
- **Boot tolerante:** plugins que falham são colocados em quarentena e
  descartados; providers inválidos deixam de ser resolvíveis e os consumidores
  são religados quando aplicável.
- **Shutdown:** ordem inversa do boot. Dependências permanecem vivas enquanto
  seus consumidores executam `onStop` e seus disposers.
- **Dispose:** o `AbortController` é sinalizado antes do teardown; disposers,
  scopes, timers e subsistemas são limpos (`src/core/runtime/dispose.ts`).
  Timeouts de operações assíncronas limpam o timer em `finally`
  (`src/core/internal/ttl.ts`).

Referências: `ETAPA73_PLUGIN_MANIFESTS_CAPABILITY_GRAPH.txt`,
`ETAPA74_LAYER1_LIFECYCLE.txt`, `ETAPA87_FAILURE_RECOVERY_RESILIENCE.txt`.

## 2. Game loop

O loop distingue três noções de tempo e não as mistura:

```text
wall clock -> clamp -> accumulator -> 0..N passos fixos de simulação
                                   -> alpha de interpolação -> render
```

- **Simulation tick:** passo fixo. Padrão de 60 ticks/s, faixa permitida de
  1 a 240 ticks/s; valores inválidos (`NaN`, `Infinity`, `<= 0`, fora da faixa)
  são ignorados por `setTickRate()`.
- **Render frame:** variável, com interpolação.
- **Física** (Rapier) avança somente no tick fixo e nunca depende do frame rate.
- Implementação: `src/engine/game-loop/internal/DeterministicGameLoop.ts`.

Em hot paths evita-se alocação por frame, criação de Promise/closure/listener
por tick e crescimento ilimitado de `Map`/`Set`/cache.

Referências: `ETAPA75_DETERMINISTIC_GAME_LOOP.txt`,
`ETAPA77_PHYSICS_RUNTIME.txt`, `ETAPA86_PERFORMANCE_RESOURCE_LIFECYCLE.txt`.

## 3. Ownership de recursos

Todo recurso adquirido tem um dono e um release/dispose correspondente:

| Recurso | Regra |
|---|---|
| Listeners e subscriptions | Removidos no teardown do módulo que os registrou |
| Workers | Terminados no `clear()`; jobs pendentes são rejeitados |
| WebSockets / Steam callbacks / IPC handles | Fechados no shutdown; o Steam encerra sem thread residual |
| GPU (geometries, materials, textures, render targets) | Dispose explícito |
| Física (bodies, colliders, world) | Liberados no unload; `domain` não guarda handles concretos |
| WebAudio, timers, caches, object URLs | Liberados no teardown |

## 4. Recuperação de falhas

A Stage 87 certifica que falhas hostis não deixam a Layer 1 em estado
parcialmente vivo. Cada owner cuida da sua fronteira de falha; não existe
supervisor global.

| Falha | Comportamento | Implementação |
|---|---|---|
| Perda de contexto WebGL | `webglcontextlost` suspende o render; no restore executa `renderer.resetState()` e reaplica o viewport | `src/engine/render/internal/ThreeRenderEngine.ts` |
| Perda de foco / aba oculta | `blur` e `visibilitychange` liberam estado contínuo de input; pointer lock solto não deixa lock fantasma | `src/engine/input/internal/KeyboardMouseDriver.ts` |
| Asset concluído após dispose | `inFlight` é removido em `finally`; o resultado tardio é liberado e rejeitado | `src/engine/assets/internal/AssetsManagerService.ts` |
| Falha de worker | `error`, `messageerror` ou falha de `postMessage` caem em fallback determinístico | `src/engine/terrain/internal/ProceduralWorkerPool.ts` |
| Desconexão de rede | `connectionGeneration` invalida callbacks de sockets antigos; `close` resolve connect pendente como `false` | `src/engine/net/internal/WebSocketTransport.ts` |
| Save corrompido | Payload, container ou checksum inválidos falham como `corrupted` (fail-closed) | `src/engine/storage/internal/SaveRecordCodec.ts` |

Referência: `ETAPA87_FAILURE_RECOVERY_RESILIENCE.txt`.
