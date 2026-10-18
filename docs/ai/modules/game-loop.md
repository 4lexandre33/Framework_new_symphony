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
  stepTicks(n: number): Promise<number>; // Avança a simulação manualmente enquanto o loop está PAUSADO (ferramentas de depuração, ex.: `loop_control ste…
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
interface GameTickSnapshot { // Cópia mutável/guardável de um `GameTickPayload`.
  deltaSeconds: number;
  totalTimeSeconds: number;
  tickCount: number;
}
function copyTickPayload(src: GameTickPayload, out: GameTickSnapshot = { deltaSeconds: 0, totalTimeSeconds: 0, tickCount: 0 }): GameTickSnapshot; // G31: copia os números do payload REUTILIZADO do tick.
event GameTickEvent = "game.loop.tick" payload GameTickPayload
interface GameRenderPayload { // Payload de `game.loop.render` (também reutilizado entre frames).
  readonly alphaInterpolation: number;
  readonly deltaSeconds: number; // Delta de simulação visual do frame.
  readonly realDeltaSeconds: number; // Delta de relógio de parede do frame (limitado a 0,25 s), mesmo pausado.
  readonly isPaused: boolean;
}
interface GameRenderSnapshot { // Cópia mutável/guardável de um `GameRenderPayload`.
  alphaInterpolation: number;
  deltaSeconds: number;
  realDeltaSeconds: number;
  isPaused: boolean;
}
function copyRenderPayload(src: GameRenderPayload, out: GameRenderSnapshot = { alphaInterpolation: 0, deltaSeconds: 0, realDeltaSeconds: 0, isPaused: false }): GameRenderSnapshot; // G31: como `copyTickPayload`, para o payload reutilizado do render.
event GameRenderEvent = "game.loop.render" payload GameRenderPayload
interface PauseOptions {
  readonly freezeRender?: boolean; // true = também para de emitir `game.loop.render` (imagem congelada, sem custo de GPU).
}
command PauseGameCommand = "game.loop.pause" request PauseOptions
command ResumeGameCommand = "game.loop.resume" request Record<string, never>
```
## notas verificadas (comportamento)
- O loop inicia sozinho em `kernel.booted`. Padrão 60 ticks/s; frame limitado a 0,25 s e 60 passos fixos por frame (sem "recuperar" travadas).
- Simulação no `game.loop.tick` (passo fixo); visual no `game.loop.render` (`alphaInterpolation`, `deltaSeconds`, `realDeltaSeconds`, `isPaused`).
- `pause()` para os ticks mas o render CONTINUA (`isPaused: true`, `deltaSeconds: 0`, `realDeltaSeconds` real): menus e lobby animados funcionam. `pause({ freezeRender: true })` congela também a imagem. `resume()` não recupera o tempo pausado.
- Tudo que roda no tick (física, IA, scripting, bordas `*InTick` do input) para durante a pausa: trate a tecla de "continuar" no evento `game.input.action` ou no render.
- Aba/janela oculta: o loop suspende e, na volta, ressincroniza sem catch-up (`getStats().isHidden`). O pump de rede também para (GAPS G130).
- Payloads de tick/render são REUTILIZADOS: leia na hora ou copie com `copyTickPayload`/`copyRenderPayload`; nunca mute (em DEV é detectado e revertido).
- `setTickRate(1..240)` e `setTargetFps(0 | 1..1000)` devolvem `false` para valor inválido. Use `pause/resume`, não `stop/start`.
