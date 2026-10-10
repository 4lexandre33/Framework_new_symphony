# game-loop — Deterministic Game Loop
capability: game.loop@1.0.0 | category: runtime | engine plugin id: game.loop
use (from src/projects/<jogo>/**):
  import { GameLoopToken } from "../../tokens/game-loop";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/game-loop.ts
```ts
interface GameLoopStats {
  readonly fps: number;
  readonly targetFps: number; // Limite de FPS de render configurado (0 = sem limite, segue o display).
  readonly tickRate: number;
  readonly isPaused: boolean;
  readonly isHidden: boolean; // true enquanto a página/janela está oculta (simulação suspensa).
  readonly runningTimeSeconds: number;
}
interface GameLoopApi {
  start(): void;
  stop(): void;
  pause(options?: PauseOptions): void; // Congela a simulação (sem `game.loop.tick`).
  resume(): void; // Retoma sem "catch-up" do tempo passado em pausa.
  setTickRate(ticksPerSecond: number): boolean; // Define ticks por segundo (inteiro ou fracionário em [1, 240]).
  setTargetFps(framesPerSecond: number): boolean; // Limita a taxa de frames de render.
  getStats(): GameLoopStats; // Retorna um objeto novo a cada chamada.
}
capability GameLoopToken = "game.loop"@1.0.0 api GameLoopApi
```
## contract src/contracts/game-loop/types.ts
```ts
interface GameTickPayload { // Payload de `game.loop.tick`.
  readonly deltaSeconds: number;
  readonly totalTimeSeconds: number;
  readonly tickCount: number;
}
event GameTickEvent = "game.loop.tick" payload GameTickPayload
interface GameRenderPayload { // Payload de `game.loop.render` (também reutilizado entre frames).
  readonly alphaInterpolation: number;
  readonly deltaSeconds: number; // Delta de simulação visual do frame.
  readonly realDeltaSeconds: number; // Delta de relógio de parede do frame (limitado a 0,25 s), mesmo pausado.
  readonly isPaused: boolean;
}
event GameRenderEvent = "game.loop.render" payload GameRenderPayload
interface PauseOptions {
  readonly freezeRender?: boolean; // true = também para de emitir `game.loop.render` (imagem congelada, sem custo de GPU).
}
command PauseGameCommand = "game.loop.pause" request PauseOptions
command ResumeGameCommand = "game.loop.resume" request Record<string, never>
```
## notas verificadas (comportamento)
- O loop inicia no evento `kernel.booted`; não inicie manualmente.
- O payload do tick é REUTILIZADO entre ticks: não guarde a referência; copie os números que precisar.
- Simulação usa passo fixo; render usa frame variável. Lógica de jogo no tick, visual no frame.
- Padrão: 60 ticks/s (`deltaSeconds` ≈ 1/60). Delta de frame limitado a 0,25 s e no máximo 60 passos fixos por frame (após travadas, a simulação não "recupera" mais que isso).
- `pause()` congela o tick E o evento `game.loop.render` (a imagem fica parada); DOM/menus continuam funcionando. Não pause o loop para telas que precisam de 3D animado (lobby, cutscene): use um estado do próprio jogo.
