import { defineCapability } from "@core";
import type {
  UIScreenId,
  ModalConfig,
  HUDData,
  LocaleDictionary,
  ScreenContent,
} from "../contracts/ui/types";

export interface UIApi {
  readonly currentScreen: UIScreenId;
  readonly activeModalCount: number;
  /** Locale pedido em `setLocale`. */
  readonly currentLocale: string;
  /** false quando não há DOM (node/headless): o estado é mantido sem renderizar. */
  readonly hasDOM: boolean;

  openScreen(screenId: UIScreenId): void;
  /**
   * Abre um modal (ver ModalConfig: templateId, contentText, HTML sanitizado,
   * depth). Reabrir um id existente substitui o anterior.
   */
  pushModal(config: ModalConfig): void;
  /** Fecha o modal `modalId` (ou o do topo sem argumento). false se não havia. */
  popModal(modalId?: string): boolean;
  isModalOpen(modalId: string): boolean;
  /** Fecha todos os modais (do topo para baixo). */
  closeAllModals(): void;

  bindHUDData(data: HUDData): void;
  updateHUD(key: string, value: unknown): void;
  /**
   * Reindexa `data-bind`/`data-hud-fill` (normalmente automático via
   * MutationObserver; chame após montar HUD fora de `#ui-root`).
   */
  refreshHUDBindings(): void;

  /**
   * Troca o idioma. Locale sem dicionário cai para o mesmo idioma
   * (`en-GB` → `en-US`) e depois para o fallback. Vazio é ignorado (false).
   * Só elementos `[data-i18n]` cuja chave EXISTE nos dicionários são
   * reescritos: DOM do jogo com chaves próprias não é apagado.
   */
  setLocale(locale: string): boolean;
  translate(key: string, params?: Record<string, string | number>): string;
  /** Registra/mescla um dicionário do jogo. */
  registerDictionary(locale: string, dictionary: LocaleDictionary): void;
  /** Locale usado quando a chave não existe no idioma atual (padrão "pt-BR"). */
  setFallbackLocale(locale: string): void;
  getAvailableLocales(): string[];
  hasTranslation(key: string): boolean;

  registerTemplate(templateId: string, htmlContent: string): void;
  /** Instancia um template com valores ESCAPADOS (string HTML). */
  renderTemplate(templateId: string, data?: Readonly<Record<string, string | number>>): string;
  /** Substitui o conteúdo de uma tela embutida (as telas padrão são só placeholders). */
  setScreenContent(screenId: UIScreenId, content: ScreenContent): boolean;
}

export const UIToken = defineCapability<UIApi>("game.ui", "1.0.0");
