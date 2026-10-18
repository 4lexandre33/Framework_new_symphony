# overlay — Desktop Overlay & Raycast Click Passthrough
capability: game.overlay@1.0.0 | category: functional | engine plugin id: game.overlay
dependsOn: game.loop, game.render
consumes: RenderToken
use (from src/projects/<jogo>/**):
  import { OverlayToken } from "../../tokens/overlay";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/overlay.ts
```ts
interface OverlayApi {
  readonly currentMode: OverlayMode;
  readonly isPassthroughActive: boolean; // Estado REAL aplicado (só muda quando o nativo confirma).
  readonly isAlwaysOnTop: boolean;
  readonly passthroughPolicy: PassthroughPolicy;
  readonly lastError: string | null; // Último erro nativo (ou "unsupported: …"); null se a última operação deu certo.
  setPassthrough(enabled: boolean): Promise<void>; // Rejeita com o erro nativo (estado não muda).
  setAlwaysOnTop(alwaysOnTop: boolean): Promise<void>; // Rejeita com o erro nativo (estado não muda).
  setPassthroughPolicy(policy: PassthroughPolicy): void; // G15: `manual` (padrão) ou `auto` (rastreamento real do cursor).
  setOverlayMode(mode: OverlayMode): Promise<OverlayModeResult>; // G121: aplica as flags nativas do modo.
  dockToTaskbar(position?: TaskbarDockPosition): Promise<boolean>; // Encaixa na barra de tarefas; false (com `lastError`) se não suportado.
  getTaskbarBounds(): Promise<TaskbarBounds | null>; // null (com `lastError`) quando o SO não informa a barra de tarefas.
  refreshWindowState(): Promise<OverlayWindowState>; // Relê o estado nativo da janela (atualiza os getters).
  setRaycastProvider(provider: OverlayRaycastProvider | null): void; // Raycast 3D usado pelo hit-test (o plugin liga o do `game.render` se houver).
  performHitTest(cursorX: number, cursorY: number): HitTestResult; // Hit-test DOM + raycast 3D no ponto (px CSS da janela).
  update(cursorX: number, cursorY: number, deltaSeconds: number): void; // Informa um cursor EXPLÍCITO (headless/testes/cursor próprio) e, em `auto`, reavalia o passthrough.
  clear(): void; // Desfaz listeners e REVERTE o nativo ao estado do boot (best-effort).
  restoreWindow(): Promise<OverlayWindowState>; // Como `clear`, aguardável, devolvendo o estado final.
}
capability OverlayToken = "game.overlay"@1.0.0 api OverlayApi
```
## contract src/contracts/overlay/types.ts
```ts
export type OverlayMode = "window" | "desktop_pet" | "taskbar_dock" | "always_on_top_hud"; // Modos de janela (G121).
export type PassthroughPolicy = "manual" | "auto"; // G15: `manual` (padrão) = o passthrough só muda por `setPassthrough`, e fica.
export type OverlayRaycastProvider = (cursorX: number, cursorY: number) => { readonly hit: boolean; readonly entityId?: string; }; // Raycast 3D: true se há objeto interativo no pixel (px CSS da janela).
interface OverlayWindowState { // Estado REAL da janela (lido do nativo; `native: false` = simulado no navegador).
  readonly native: boolean;
  readonly alwaysOnTop: boolean;
  readonly decorations: boolean;
  readonly ignoreCursorEvents: boolean;
  readonly taskbarSupported: boolean;
  readonly platform: string;
}
interface OverlayModeResult {
  readonly mode: OverlayMode;
  readonly applied: boolean; // true se TODAS as flags do modo foram aplicadas.
  readonly state: OverlayWindowState;
  readonly passthroughPolicy: PassthroughPolicy;
  readonly docked?: boolean; // Só em `taskbar_dock`: true se a janela foi encaixada.
  readonly errors: readonly string[]; // Erros nativos (ou "unsupported: …") encontrados ao aplicar.
}
export type TaskbarDockPosition = "top" | "bottom" | "left" | "right";
interface TaskbarBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly position: TaskbarDockPosition;
}
interface HitTestResult {
  readonly hit: boolean;
  readonly targetType: "three_mesh" | "dom_ui" | "none";
  readonly entityId?: string;
  readonly elementId?: string;
}
interface PassthroughChangedPayload {
  readonly isIgnoringCursorEvents: boolean;
  readonly mode: OverlayMode;
}
event PassthroughChangedEvent = "game.overlay.passthrough-changed" payload PassthroughChangedPayload
interface TaskbarResizedPayload {
  readonly bounds: TaskbarBounds;
}
event TaskbarResizedEvent = "game.overlay.taskbar-resized" payload TaskbarResizedPayload
interface SetPassthroughPayload {
  readonly ignoreCursorEvents: boolean;
}
command SetPassthroughCommand = "game.overlay.set-passthrough" request SetPassthroughPayload
interface DockToTaskbarPayload {
  readonly position?: TaskbarDockPosition;
}
command DockToTaskbarCommand = "game.overlay.dock-to-taskbar" request DockToTaskbarPayload
interface SetAlwaysOnTopPayload {
  readonly alwaysOnTop: boolean;
}
command SetAlwaysOnTopCommand = "game.overlay.set-always-on-top" request SetAlwaysOnTopPayload
```
## notas verificadas (comportamento)
- A janela do app nasce como janela comum (bordas, não sempre-no-topo, opaca). Cada jogo pode ter `src/projects/<jogo>/desktop.json` (`productName`, `identifier`, `window: { title, width, height, resizable, fullscreen, decorations, alwaysOnTop, transparent }`); janela transparente/sem bordas é opt-in ali (transparência só na criação).
- Passthrough: política `manual` (padrão) — `setPassthrough(true)` vale até você desligar; `auto` (`setPassthroughPolicy("auto")`) segue o cursor real e só ignora cliques onde não há DOM interativo nem malha 3D (raycast do render já ligado; `setRaycastProvider` troca).
- `setOverlayMode("window" | "desktop_pet" | "taskbar_dock" | "always_on_top_hud")` aplica as flags nativas e devolve `{ applied, state, errors }`. `setPassthrough`/`setAlwaysOnTop` REJEITAM com o erro nativo (o estado não muda): use try/catch. Getters (`isAlwaysOnTop`, `isPassthroughActive`) refletem o estado real; `lastError` explica falhas.
- Sem Tauri: tudo simulado com `state.native === false` (não mente sobre a janela); `dockToTaskbar` resolve `false` com `lastError` "unsupported".
- No dispose: `restoreWindow()` (ou `clear()`) reverte a janela ao estado do boot.
- Flags nativas não verificadas numa janela Tauri real (GAPS NV).
