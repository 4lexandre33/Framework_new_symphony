import type { SteamApi } from "../tokens/steam";
import type { InputApi } from "../tokens/input";
import type { AssetsApi } from "../tokens/assets";
import type { PhysicsApi } from "../tokens/physics";
import type { StorageApi } from "../tokens/storage";
import type { WorldApi } from "../tokens/world";
import type { UIApi } from "../tokens/ui";
import type { AnimationApi } from "../tokens/anim";
import type { SpritesApi } from "../tokens/sprites";
import type { AudioApi } from "../tokens/audio";
import type { CameraApi } from "../tokens/camera";
import type { AiApi } from "../tokens/ai";
import type { VfxApi } from "../tokens/vfx";
import type { TerrainApi } from "../tokens/terrain";
import type { ScriptingApi } from "../tokens/scripting";
import type { StreamingApi } from "../tokens/streaming";
import type { OverlayApi } from "../tokens/overlay";
import type { SecurityApi } from "../tokens/security";
import type { ModdingApi } from "../tokens/modding";
import type { MonetizationApi } from "../tokens/monetization";

export interface EngineServices {
  steam: SteamApi | null;
  input: InputApi | null;
  assets: AssetsApi | null;
  physics: PhysicsApi | null;
  storage: StorageApi | null;
  world: WorldApi | null;
  ui: UIApi | null;
  anim: AnimationApi | null;
  sprites: SpritesApi | null;
  audio: AudioApi | null;
  camera: CameraApi | null;
  ai: AiApi | null;
  vfx: VfxApi | null;
  terrain: TerrainApi | null;
  scripting: ScriptingApi | null;
  streaming: StreamingApi | null;
  overlay: OverlayApi | null;
  security: SecurityApi | null;
  modding: ModdingApi | null;
  monetization: MonetizationApi | null;
}

export function createEngineServices(): EngineServices {
  return {
    steam: null,
    input: null,
    assets: null,
    physics: null,
    storage: null,
    world: null,
    ui: null,
    anim: null,
    sprites: null,
    audio: null,
    camera: null,
    ai: null,
    vfx: null,
    terrain: null,
    scripting: null,
    streaming: null,
    overlay: null,
    security: null,
    modding: null,
    monetization: null,
  };
}

export function clearEngineServices(services: EngineServices): void {
  services.steam = null;
  services.input = null;
  services.assets = null;
  services.physics = null;
  services.storage = null;
  services.world = null;
  services.ui = null;
  services.anim = null;
  services.sprites = null;
  services.audio = null;
  services.camera = null;
  services.ai = null;
  services.vfx = null;
  services.terrain = null;
  services.scripting = null;
  services.streaming = null;
  services.overlay = null;
  services.security = null;
  services.modding = null;
  services.monetization = null;
}