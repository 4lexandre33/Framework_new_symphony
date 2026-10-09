# game-loop — Deterministic Game Loop
capability: game.loop@1.0.0 | category: runtime | engine plugin id: game.loop
use (from src/projects/<jogo>/**):
  import { GameLoopToken } from "../../tokens/game-loop";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/game-loop.ts
```ts
interface GameLoopStats {
  readonly fps: number;
  readonly targetFps: number;
  readonly tickRate: number;
  readonly isPaused: boolean;
  readonly runningTimeSeconds: number;
}
interface GameLoopApi {
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  setTickRate(ticksPerSecond: number): void;
  getStats(): GameLoopStats;
}
capability GameLoopToken = "game.loop"@1.0.0 api GameLoopApi
```
## contract src/contracts/game-loop/types.ts
```ts
interface GameTickPayload {
  readonly deltaSeconds: number;
  readonly totalTimeSeconds: number;
  readonly tickCount: number;
}
event GameTickEvent = "game.loop.tick" payload GameTickPayload
interface GameRenderPayload {
  readonly alphaInterpolation: number;
  readonly deltaSeconds: number;
}
event GameRenderEvent = "game.loop.render" payload GameRenderPayload
command PauseGameCommand = "game.loop.pause" request Record<string, never>
command ResumeGameCommand = "game.loop.resume" request Record<string, never>
```
## notas verificadas (comportamento)
- O loop inicia no evento `kernel.booted`; não inicie manualmente.
- O payload do tick é REUTILIZADO entre ticks: não guarde a referência; copie os números que precisar.
- Simulação usa passo fixo; render usa frame variável. Lógica de jogo no tick, visual no frame.

