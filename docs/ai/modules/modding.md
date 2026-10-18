# modding — Steam Workshop, Dynamic Loading & Asset Override
capability: game.modding@1.0.0 | category: functional | engine plugin id: game.modding
use (from src/projects/<jogo>/**):
  import { ModdingToken } from "../../tokens/modding";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/modding.ts
```ts
interface ModdingApi {
  getLoadedMods(): ReadonlyArray<ModManifestDescriptor>; // Mods ATIVOS em ordem de carga (dependências primeiro).
  enableMod(modId: string): Promise<boolean>; // Ativa o mod (e dependências): registra overrides, executa o `entryScript` no sandbox e persiste a lista de at…
  disableMod(modId: string): boolean;
  getAssetOverride(virtualPath: string): string | null; // URL do override vencedor (caminho normalizado).
  registerAssetOverride(override: AssetOverrideDescriptor): void;
  downloadWorkshopMod(itemId: string): Promise<boolean>; // Assina + baixa + aguarda instalação do item do Workshop e o registra.
  publishWorkshopMod( localFolderPath: string, title: string, description: string, ): Promise<string>; // Publica no Workshop a pasta de um mod local (precisa estar em `<app_data>/mods`; aceita o modId).
  clear(): void; // Desativa todos os mods (scripts, overrides, URLs) e limpa overrides manuais, SEM esquecer os mods instalados …
  getInstalledMods(): ReadonlyArray<InstalledModInfo>; // Todos os mods conhecidos (instalados/registrados), válidos e inválidos.
  refreshInstalledMods(): Promise<ReadonlyArray<InstalledModInfo>>; // Reescaneia a pasta de mods e os itens do Workshop (Tauri).
  installMod(manifest: unknown, options?: InstallModOptions): InstalledModInfo; // Registra um mod fornecido pelo jogo (empacotado/baixado), inclusive offline.
  resolveAssetUrl(virtualPath: string): Promise<string | null>; // URL utilizável do override (blob: para mods em disco).
  setScriptCapabilities(modId: string, capabilities: ReadonlyArray<ModScriptCapability>): void; // Capacidades do script do mod (padrão: `log` e `messages`).
  postToModScript(modId: string, type: string, payload: unknown): boolean; // Envia uma mensagem ao script do mod (`mod.on(type, handler)`).
  getWorkshopItemState(itemId: string): Promise<WorkshopItemState | null>; // Estado de download/instalação de um item do Workshop (`null` sem Steam).
}
capability ModdingToken = "game.modding"@1.0.0 api ModdingApi
```
## contract src/contracts/modding/types.ts
```ts
interface ModDependencyDescriptor {
  readonly modId: string;
  readonly minVersion: string;
}
interface ModManifestDescriptor {
  readonly modId: string;
  readonly name: string;
  readonly version: string;
  readonly author: string;
  readonly description: string;
  readonly minEngineVersion: string;
  readonly entryScript?: string;
  readonly overrides?: ReadonlyArray<AssetOverrideDescriptor>;
  readonly dependencies?: ReadonlyArray<ModDependencyDescriptor>;
}
interface AssetOverrideDescriptor {
  readonly virtualPath: string;
  readonly realPath: string;
  readonly modId: string;
  readonly priority: number;
}
interface SteamWorkshopItemDTO {
  readonly itemId: string;
  readonly title: string;
  readonly description: string;
  readonly ownerSteamId: string;
  readonly fileSizeBytes: number;
  readonly isSubscribed: boolean;
  readonly isDownloading: boolean;
  readonly downloadProgressPercentage: number;
}
interface ScriptSandboxConfig {
  readonly maxExecutionTimeMs: number;
  readonly allowedCapabilities: ReadonlyArray<string>;
}
interface ModLoadedPayload {
  readonly modId: string;
  readonly manifest: ModManifestDescriptor;
}
event ModLoadedEvent = "game.modding.mod-loaded" payload ModLoadedPayload
interface ModUnloadedPayload {
  readonly modId: string;
}
event ModUnloadedEvent = "game.modding.mod-unloaded" payload ModUnloadedPayload
interface WorkshopDownloadProgressPayload {
  readonly itemId: string;
  readonly progressPercentage: number;
  readonly bytesDownloaded: number;
  readonly totalBytes: number;
}
event WorkshopDownloadProgressEvent = "game.modding.workshop-progress" payload WorkshopDownloadProgressPayload
interface AssetOverriddenPayload {
  readonly virtualPath: string;
  readonly realPath: string;
  readonly modId: string;
}
event AssetOverriddenEvent = "game.modding.asset-overridden" payload AssetOverriddenPayload
interface DownloadWorkshopModPayload {
  readonly itemId: string;
}
command DownloadWorkshopModCommand = "game.modding.download-workshop" request DownloadWorkshopModPayload
interface EnableModPayload {
  readonly modId: string;
}
command EnableModCommand = "game.modding.enable-mod" request EnableModPayload
interface DisableModPayload {
  readonly modId: string;
}
command DisableModCommand = "game.modding.disable-mod" request DisableModPayload
interface PublishModToWorkshopPayload {
  readonly localFolderPath: string;
  readonly title: string;
  readonly description: string;
}
const MODDING_API_VERSION = "1.0.0"; // Versão da API de modding.
export type ModSource = "local" | "workshop" | "game"; // `local`: pasta `<app_data>/mods`; `workshop`: item Steam instalado; `game`: registrado pelo jogo (`installMod…
interface InstalledModInfo {
  readonly modId: string | null; // `null` quando o manifesto é inválido.
  readonly manifest: ModManifestDescriptor | null;
  readonly source: ModSource;
  readonly rootPath: string | null; // Pasta canônica em disco (`null` para mods do jogo).
  readonly workshopItemId: string | null;
  readonly enabled: boolean;
  readonly error: string | null; // Motivo da rejeição (manifesto inválido) — o mod não some sem aviso.
}
export type ModScriptCapability = "log" | "messages" | "assets"; // Capacidades do script de mod (sandbox em Worker): - `log`: `mod.log(...)` vai para o log do plugin; - `messag…
interface InstallModOptions {
  readonly scriptSource?: string; // Código do `entryScript` (mods empacotados/baixados pelo jogo).
  readonly baseUrl?: string; // Base para resolver `realPath` relativos dos overrides (ex.: `/mods/hd/`).
  readonly replace?: boolean; // Substitui um mod já instalado com o mesmo `modId` (padrão false).
}
interface WorkshopItemState {
  readonly itemId: string;
  readonly subscribed: boolean;
  readonly installed: boolean;
  readonly downloading: boolean;
  readonly downloadPending: boolean;
  readonly needsUpdate: boolean;
  readonly bytesDownloaded: number;
  readonly bytesTotal: number;
}
interface ModScriptMessagePayload {
  readonly modId: string;
  readonly type: string;
  readonly data: unknown;
}
event ModScriptMessageEvent = "game.modding.script-message" payload ModScriptMessagePayload // Mensagem enviada por um script de mod (`mod.send`) com capacidade `messages`.
interface ModErrorPayload {
  readonly modId: string;
  readonly error: string;
}
event ModErrorEvent = "game.modding.mod-error" payload ModErrorPayload // Falha de script/instalação/ativação de um mod.
command PublishModToWorkshopCommand = "game.modding.publish-workshop" request PublishModToWorkshopPayload
```
## notas verificadas (comportamento)
- Resolva toda URL de asset do jogo por `getAssetOverride(caminho) ?? caminho` (síncrono; caminhos normalizados). Para mods em disco use `await resolveAssetUrl(caminho)` (gera URL utilizável).
- Mods do JOGO (funcionam offline): `installMod(manifesto, { baseUrl?, scriptSource?, replace? })` devolve `InstalledModInfo` (`error` preenchido se inválido; não lança) → `enableMod(modId)` (dependências primeiro, overrides registrados, script executado) / `disableMod(modId)` (remove os overrides do mod). A lista de ativos persiste e é reativada no boot.
- Manifesto: `modId`, `name`, `version`, `author`, `description`, `minEngineVersion` (compare com `MODDING_API_VERSION` = "1.0.0"), `overrides`, `dependencies`, `entryScript`.
- Scripts rodam num Worker isolado (sem rede/carregamento de código) com capacidades `log` e `messages` por padrão (`setScriptCapabilities`; `assets` opcional). Conversa: `postToModScript` ↔ evento `game.modding.script-message`; falhas em `game.modding.mod-error`.
- `registerAssetOverride` manual continua valendo (descritor inválido lança). `getInstalledMods()` lista também os inválidos; `getLoadedMods()` só os ativos. `clear()` desativa tudo sem esquecer os instalados.
- Tauri: mods em `<app_data>/mods` e itens do Workshop (`refreshInstalledMods`, `downloadWorkshopMod`, `getWorkshopItemState`). Publicar exige Tauri + Steam (rejeita fora disso). Workshop não verificado com Steam real (GAPS G14/G116, NV).
