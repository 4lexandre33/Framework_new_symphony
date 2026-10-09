# ui — Interface de Usuário & HUD
capability: game.ui@1.0.0 | category: functional | engine plugin id: game.ui
use (from src/projects/<jogo>/**):
  import { UIToken } from "../../tokens/ui";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/ui.ts
```ts
interface UIApi {
  readonly currentScreen: UIScreenId;
  readonly activeModalCount: number;
  readonly currentLocale: string;
  openScreen(screenId: UIScreenId): void;
  pushModal(config: ModalConfig): void;
  popModal(): boolean;
  bindHUDData(data: HUDData): void;
  updateHUD(key: string, value: unknown): void;
  setLocale(locale: string): void;
  translate(key: string, params?: Record<string, string | number>): string;
  registerTemplate(templateId: string, htmlContent: string): void;
}
capability UIToken = "game.ui"@1.0.0 api UIApi
```
## contract src/contracts/ui/types.ts
```ts
export type UIScreenId = | "main_menu" | "hud" | "inventory" | "settings" | "dialogue" | "game_over" | "pause_menu";
interface ModalConfig {
  readonly id: string;
  readonly title: string;
  readonly templateId?: string;
  readonly contentHtml?: string;
  readonly depth?: number;
  readonly closable?: boolean;
  readonly customData?: Record<string, unknown>;
}
export type HUDValue = string | number | boolean; // Valor exibível no HUD.
export type HUDData = Readonly<Record<string, HUDValue>>;
interface HUDStatePayload {
  readonly data: HUDData;
}
export type LocaleDictionary = Record<string, string>;
interface ScreenChangedPayload {
  readonly currentScreen: UIScreenId;
  readonly previousScreen: UIScreenId | null;
}
event ScreenChangedEvent = "game.ui.screen-changed" payload ScreenChangedPayload
interface ModalPushedPayload {
  readonly modalId: string;
  readonly depth: number;
}
event ModalPushedEvent = "game.ui.modal-pushed" payload ModalPushedPayload
interface LocaleChangedPayload {
  readonly locale: string;
}
event LocaleChangedEvent = "game.ui.locale-changed" payload LocaleChangedPayload
interface HUDUpdatedPayload {
  readonly data: HUDData;
}
event HUDUpdatedEvent = "game.ui.hud-updated" payload HUDUpdatedPayload
interface OpenScreenRequest {
  readonly screenId: UIScreenId;
}
command OpenScreenCommand = "game.ui.open-screen" request OpenScreenRequest
interface PushModalRequest {
  readonly config: ModalConfig;
}
command PushModalCommand = "game.ui.push-modal" request PushModalRequest
interface PopModalRequest {
  readonly modalId?: string;
}
command PopModalCommand = "game.ui.pop-modal" request PopModalRequest
interface SetLocaleRequest {
  readonly locale: string;
}
command SetLocaleCommand = "game.ui.set-locale" request SetLocaleRequest
interface BindHUDValueRequest {
  readonly key: string;
  readonly value: unknown;
}
command BindHUDValueCommand = "game.ui.bind-hud-value" request BindHUDValueRequest
```
## notas verificadas (comportamento)
- O DOM do UI é montado no `setup` do plugin de UI: declare `dependsOn: game.ui` no jogo.
- `screen-hud` está ativa por padrão; o container `#hud-overlay` começa vazio.
- O HUD genérico usa `data-bind="chave"` e `data-hud-fill="chave"` (max em `data-hud-max` ou `max<Chave>`); o binder varre o DOM no update, não no mount.

