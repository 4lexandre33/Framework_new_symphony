import { defineCapability } from "@core";
import type {
  OverlayMode,
  OverlayModeResult,
  OverlayRaycastProvider,
  OverlayWindowState,
  PassthroughPolicy,
  TaskbarBounds,
  TaskbarDockPosition,
  HitTestResult,
} from "../contracts/overlay/types";

export interface OverlayApi {
  readonly currentMode: OverlayMode;
  /** Estado REAL aplicado (só muda quando o nativo confirma). */
  readonly isPassthroughActive: boolean;
  readonly isAlwaysOnTop: boolean;
  readonly passthroughPolicy: PassthroughPolicy;
  /** Último erro nativo (ou "unsupported: …"); null se a última operação deu certo. */
  readonly lastError: string | null;

  /** Rejeita com o erro nativo (estado não muda). Em `manual`, o valor fica. */
  setPassthrough(enabled: boolean): Promise<void>;
  /** Rejeita com o erro nativo (estado não muda). */
  setAlwaysOnTop(alwaysOnTop: boolean): Promise<void>;
  /** G15: `manual` (padrão) ou `auto` (rastreamento real do cursor). */
  setPassthroughPolicy(policy: PassthroughPolicy): void;
  /** G121: aplica as flags nativas do modo. Nunca rejeita: veja `errors`. */
  setOverlayMode(mode: OverlayMode): Promise<OverlayModeResult>;
  /** Encaixa na barra de tarefas; false (com `lastError`) se não suportado. */
  dockToTaskbar(position?: TaskbarDockPosition): Promise<boolean>;
  /** null (com `lastError`) quando o SO não informa a barra de tarefas. */
  getTaskbarBounds(): Promise<TaskbarBounds | null>;
  /** Relê o estado nativo da janela (atualiza os getters). */
  refreshWindowState(): Promise<OverlayWindowState>;
  /** Raycast 3D usado pelo hit-test (o plugin liga o do `game.render` se houver). */
  setRaycastProvider(provider: OverlayRaycastProvider | null): void;

  /** Hit-test DOM + raycast 3D no ponto (px CSS da janela). */
  performHitTest(cursorX: number, cursorY: number): HitTestResult;
  /**
   * Informa um cursor EXPLÍCITO (headless/testes/cursor próprio) e, em
   * `auto`, reavalia o passthrough. A engine NÃO chama mais isto por tick
   * com (0,0) (G15).
   */
  update(cursorX: number, cursorY: number, deltaSeconds: number): void;
  /** Desfaz listeners e REVERTE o nativo ao estado do boot (best-effort). */
  clear(): void;
  /** Como `clear`, aguardável, devolvendo o estado final. */
  restoreWindow(): Promise<OverlayWindowState>;
}

export const OverlayToken = defineCapability<OverlayApi>("game.overlay", "1.0.0");
