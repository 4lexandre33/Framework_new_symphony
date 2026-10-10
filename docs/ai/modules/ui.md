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
  readonly currentLocale: string; // Locale pedido em `setLocale`.
  readonly hasDOM: boolean; // false quando não há DOM (node/headless): o estado é mantido sem renderizar.
  openScreen(screenId: UIScreenId): void;
  pushModal(config: ModalConfig): void; // Abre um modal (ver ModalConfig: templateId, contentText, HTML sanitizado, depth).
  popModal(modalId?: string): boolean; // Fecha o modal `modalId` (ou o do topo sem argumento).
  isModalOpen(modalId: string): boolean;
  closeAllModals(): void; // Fecha todos os modais (do topo para baixo).
  bindHUDData(data: HUDData): void;
  updateHUD(key: string, value: unknown): void;
  refreshHUDBindings(): void; // Reindexa `data-bind`/`data-hud-fill` (normalmente automático via MutationObserver; chame após montar HUD fora…
  setLocale(locale: string): boolean; // Troca o idioma.
  translate(key: string, params?: Record<string, string | number>): string;
  registerDictionary(locale: string, dictionary: LocaleDictionary): void; // Registra/mescla um dicionário do jogo.
  setFallbackLocale(locale: string): void; // Locale usado quando a chave não existe no idioma atual (padrão "pt-BR").
  getAvailableLocales(): string[];
  hasTranslation(key: string): boolean;
  registerTemplate(templateId: string, htmlContent: string): void;
  renderTemplate(templateId: string, data?: Readonly<Record<string, string | number>>): string; // Instancia um template com valores ESCAPADOS (string HTML).
  setScreenContent(screenId: UIScreenId, content: ScreenContent): boolean; // Substitui o conteúdo de uma tela embutida (as telas padrão são só placeholders).
}
capability UIToken = "game.ui"@1.0.0 api UIApi
```
## contract src/contracts/ui/types.ts
```ts
export type UIScreenId = | "main_menu" | "hud" | "inventory" | "settings" | "dialogue" | "game_over" | "pause_menu";
interface ModalConfig {
  readonly id: string;
  readonly title: string;
  readonly templateId?: string; // Template registrado (`registerTemplate`).
  readonly templateData?: Readonly<Record<string, string | number>>;
  readonly contentHtml?: string; // HTML do corpo.
  readonly contentText?: string; // Corpo como texto puro (seguro para nomes de jogadores, chat etc.).
  readonly trustedHtml?: boolean;
  readonly depth?: number; // Camada do modal: maior fica por cima (empate: o mais recente).
  readonly closable?: boolean;
  readonly customData?: Record<string, unknown>;
}
interface ScreenContent { // Conteúdo de uma tela embutida (`setScreenContent`).
  readonly templateId?: string;
  readonly templateData?: Readonly<Record<string, string | number>>;
  readonly html?: string; // Sanitizado por padrão (ver `trustedHtml`).
  readonly text?: string;
  readonly trustedHtml?: boolean;
}
interface UIPluginBehaviorOptions {
  readonly escapeTogglesPauseMenu?: boolean; // ESC alterna `hud` ⇄ `pause_menu`.
  readonly escapeClosesModals?: boolean; // ESC fecha o modal do topo se `closable !== false` (padrão true).
  readonly legacyDataActions?: boolean; // Comportamento legado de `[data-action]` (start-game carrega "level_01", open-settings, close-modal).
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
export type ModalCloseReason = "pop" | "escape" | "close-button" | "replaced" | "unmount";
interface ModalClosedPayload {
  readonly modalId: string;
  readonly remaining: number; // Modais ainda abertos depois deste fechar.
  readonly reason: ModalCloseReason;
}
event ModalClosedEvent = "game.ui.modal-closed" payload ModalClosedPayload
interface UIActionPayload {
  readonly action: string; // Valor de `data-ui-action` (ou do `data-action` legado).
  readonly value: string | null; // `data-ui-value` do elemento, se houver.
  readonly modalId: string | null; // Modal que contém o elemento, se houver.
  readonly screen: UIScreenId;
}
event UIActionEvent = "game.ui.action" payload UIActionPayload // Clique em `[data-ui-action]` dentro de `#ui-root` que a engine não trata (ela só trata `close-modal` e `open-…
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
- As telas embutidas (`main_menu`, `game_over`, `pause_menu`…) são placeholders (só título; o menu diz "Projeto 1"). `openScreen` só alterna visibilidade. Menus do jogo: monte o seu DOM num adapter ou use `pushModal({contentHtml})`.
- `contentHtml` vai direto para `innerHTML` SEM sanitização: escape qualquer texto vindo de jogador/rede (nomes Steam, chat).
- LACUNA: `ModalConfig.templateId` é ignorado (templates registrados nunca são instanciados).
- A engine reage a `[data-action]` dentro de `#ui-root` (ex.: `start-game` carrega `level_01`) e captura ESC (abre `pause_menu` e esconde o HUD) (G96): use atributo próprio (`data-<jogo>-action`) e trate `screen-changed`.
- `setLocale` reescreve `[data-i18n]` em todo o DOM (G97): não use esse atributo no jogo. Comando `pop-modal` fecha sempre o do topo (G98). Registre listeners em `document`, não no canvas (G99).
