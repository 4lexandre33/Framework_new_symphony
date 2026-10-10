import { defineEvent, defineCommand } from "@core";

export type UIScreenId =
  | "main_menu"
  | "hud"
  | "inventory"
  | "settings"
  | "dialogue"
  | "game_over"
  | "pause_menu";

export interface ModalConfig {
  readonly id: string;
  readonly title: string;
  /**
   * Template registrado (`registerTemplate`). O corpo do modal é o template
   * com `{{chave}}` trocado pelos valores de `templateData` (ESCAPADOS como
   * texto). O HTML do template é do jogo (confiável).
   */
  readonly templateId?: string;
  readonly templateData?: Readonly<Record<string, string | number>>;
  /**
   * HTML do corpo. É SANITIZADO por padrão (remove script, iframe, atributos on* e URLs javascript:);
   * use `trustedHtml: true` só para HTML 100% do próprio jogo.
   */
  readonly contentHtml?: string;
  /** Corpo como texto puro (seguro para nomes de jogadores, chat etc.). */
  readonly contentText?: string;
  readonly trustedHtml?: boolean;
  /**
   * Camada do modal: maior fica por cima (empate: o mais recente). Padrão 0.
   */
  readonly depth?: number;
  readonly closable?: boolean;
  readonly customData?: Record<string, unknown>;
}

/** Conteúdo de uma tela embutida (`setScreenContent`). */
export interface ScreenContent {
  readonly templateId?: string;
  readonly templateData?: Readonly<Record<string, string | number>>;
  /** Sanitizado por padrão (ver `trustedHtml`). */
  readonly html?: string;
  readonly text?: string;
  readonly trustedHtml?: boolean;
}

export interface UIPluginBehaviorOptions {
  /**
   * ESC alterna `hud` ⇄ `pause_menu`. Padrão false (G96): a engine não
   * captura ESC; o jogo decide a pausa.
   */
  readonly escapeTogglesPauseMenu?: boolean;
  /** ESC fecha o modal do topo se `closable !== false` (padrão true). */
  readonly escapeClosesModals?: boolean;
  /**
   * Comportamento legado de `[data-action]` (start-game carrega "level_01",
   * open-settings, close-modal). Padrão false: só `[data-ui-action]` é tratado
   * e ações desconhecidas viram o evento `game.ui.action`.
   */
  readonly legacyDataActions?: boolean;
}

/** Valor exibível no HUD. As chaves são definidas pelo projeto, não pela engine. */
export type HUDValue = string | number | boolean;

export type HUDData = Readonly<Record<string, HUDValue>>;

export interface HUDStatePayload {
  readonly data: HUDData;
}

export type LocaleDictionary = Record<string, string>;

// ── EVENTOS DE INTERFACE ───────────────────────────────────────────────────

export interface ScreenChangedPayload {
  readonly currentScreen: UIScreenId;
  readonly previousScreen: UIScreenId | null;
}

export const ScreenChangedEvent = defineEvent<"game.ui.screen-changed", ScreenChangedPayload>(
  "game.ui.screen-changed"
);

export interface ModalPushedPayload {
  readonly modalId: string;
  readonly depth: number;
}

export const ModalPushedEvent = defineEvent<"game.ui.modal-pushed", ModalPushedPayload>(
  "game.ui.modal-pushed"
);

export type ModalCloseReason = "pop" | "escape" | "close-button" | "replaced" | "unmount";

export interface ModalClosedPayload {
  readonly modalId: string;
  /** Modais ainda abertos depois deste fechar. */
  readonly remaining: number;
  readonly reason: ModalCloseReason;
}

export const ModalClosedEvent = defineEvent<"game.ui.modal-closed", ModalClosedPayload>(
  "game.ui.modal-closed"
);

export interface UIActionPayload {
  /** Valor de `data-ui-action` (ou do `data-action` legado). */
  readonly action: string;
  /** `data-ui-value` do elemento, se houver. */
  readonly value: string | null;
  /** Modal que contém o elemento, se houver. */
  readonly modalId: string | null;
  readonly screen: UIScreenId;
}

/**
 * Clique em `[data-ui-action]` dentro de `#ui-root` que a engine não trata
 * (ela só trata `close-modal` e `open-screen` com `data-ui-value`).
 */
export const UIActionEvent = defineEvent<"game.ui.action", UIActionPayload>(
  "game.ui.action"
);

export interface LocaleChangedPayload {
  readonly locale: string;
}

export const LocaleChangedEvent = defineEvent<"game.ui.locale-changed", LocaleChangedPayload>(
  "game.ui.locale-changed"
);

export interface HUDUpdatedPayload {
  readonly data: HUDData;
}

export const HUDUpdatedEvent = defineEvent<"game.ui.hud-updated", HUDUpdatedPayload>(
  "game.ui.hud-updated"
);

// ── COMANDOS DE INTERFACE ──────────────────────────────────────────────────

export interface OpenScreenRequest {
  readonly screenId: UIScreenId;
}

export const OpenScreenCommand = defineCommand<"game.ui.open-screen", OpenScreenRequest>(
  "game.ui.open-screen"
);

export interface PushModalRequest {
  readonly config: ModalConfig;
}

export const PushModalCommand = defineCommand<"game.ui.push-modal", PushModalRequest>(
  "game.ui.push-modal"
);

export interface PopModalRequest {
  readonly modalId?: string;
}

export const PopModalCommand = defineCommand<"game.ui.pop-modal", PopModalRequest>(
  "game.ui.pop-modal"
);

export interface SetLocaleRequest {
  readonly locale: string;
}

export const SetLocaleCommand = defineCommand<"game.ui.set-locale", SetLocaleRequest>(
  "game.ui.set-locale"
);

export interface BindHUDValueRequest {
  readonly key: string;
  readonly value: unknown;
}

export const BindHUDValueCommand = defineCommand<"game.ui.bind-hud-value", BindHUDValueRequest>(
  "game.ui.bind-hud-value"
);