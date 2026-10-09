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
  readonly templateId?: string;
  readonly contentHtml?: string;
  readonly depth?: number;
  readonly closable?: boolean;
  readonly customData?: Record<string, unknown>;
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