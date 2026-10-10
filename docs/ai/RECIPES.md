# receitas — trechos reais, compilados pelo tsc em src/projects/_template/recipes

## 01-manifest-and-lifecycle.ts
```ts
// Plugin completo: manifest, consumo de capabilities, boot assíncrono e dispose.
import type { Plugin, PluginContext } from "@core";
import { PhysicsToken } from "../../../tokens/physics";
import { RenderToken } from "../../../tokens/render";

export function createGamePlugin(): Plugin {
  let disposers: Array<() => void> = [];

  return {
    manifest: {
      id: "project.meu-jogo", // único; prefixo "project."
      name: "Meu Jogo",
      version: "1.0.0",
      kind: "preloaded",
      authority: "game",
      // ordem de boot: liste os plugins da engine dos quais depende (ids "game.*")
      dependsOn: [
        { id: "game.render", range: "^1.0.0" },
        { id: "game.physics", range: "^1.0.0" },
      ],
      // todo token usado precisa estar aqui E em permissions.capabilities
      permissions: {
        capabilities: [RenderToken.id, PhysicsToken.id],
        events: [], // eventos que ESTE plugin emite
      },
      capabilities: {
        consumes: [
          { id: RenderToken.id, range: "^1.0.0", optional: false },
          { id: PhysicsToken.id, range: "^1.0.0", optional: false },
        ],
        conflicts: [],
      },
      lifecycleHooks: {
        async onBoot(ctx: PluginContext): Promise<void> {
          const render = ctx.caps.require(RenderToken);
          const physics = ctx.caps.require(PhysicsToken);
          disposers.push(() => render.removeMeshFromScene("meu-jogo"));
          void physics; // use aqui; carregue assets, monte a cena
        },
      },
    },

    setup(ctx: PluginContext): void {
      ctx.lifecycle.onDispose((): void => {
        for (const dispose of disposers.splice(0).reverse()) dispose(); // ordem inversa
        disposers = [];
      });
      ctx.lifecycle.ready(); // sempre chame, senão o boot fica pendente
    },
  };
}
```

## 02-tick-loop.ts
```ts
// Lógica de jogo no tick fixo. A física já avança sozinha no mesmo tick; aqui só a sua lógica.
import type { PluginContext } from "@core";
import type { GameTickPayload } from "../../../contracts/game-loop/types";
import { GameTickEvent } from "../../../contracts/game-loop/types";

export function onFixedTick(ctx: PluginContext, update: (dt: number, total: number) => void): () => void {
  // GameTickEvent.type === "game.loop.tick"; declare-o em permissions.events se o plugin também emitir
  return ctx.events.on<"game.loop.tick", GameTickPayload>(GameTickEvent.type, (env): void => {
    update(env.payload.deltaSeconds, env.payload.totalTimeSeconds);
  });
}
// Não aloque objetos por tick. Pause/retome com ctx.commands.send("game.loop.pause" | "game.loop.resume", {}).
```

## 03-physics-body.ts
```ts
// Corpo rígido + colisão. entityId é qualquer string única do seu jogo.
import type { PluginContext } from "@core";
import { CollisionEnterEvent } from "../../../contracts/physics/types";
import type { CollisionEventPayload } from "../../../contracts/physics/types";
import type { PhysicsApi } from "../../../tokens/physics";

export function spawnCrate(physics: PhysicsApi, id: string): () => void {
  physics.createBody(
    id,
    { bodyType: "dynamic", position: { x: 0, y: 5, z: 0 }, canSleep: true },
    { shapeType: "box", halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, restitution: 0.3, friction: 0.6 },
  );
  physics.applyImpulse(id, { x: 0, y: 3, z: 0 });
  return (): void => {
    physics.removeBody(id); // sempre devolva o dispose
  };
}

export function onCollision(ctx: PluginContext, handler: (a: string, b: string) => void): () => void {
  return ctx.events.on<"game.physics.collision-enter", CollisionEventPayload>(CollisionEnterEvent.type, (env): void => {
    handler(env.payload.entityIdA, env.payload.entityIdB);
  });
}

// baseY = y da BASE do corpo. O raio nasce 0.05 ABAIXO da base (fora do corpo) e desce 0.2: não acerta o próprio corpo.
export function groundCheck(physics: PhysicsApi, x: number, baseY: number, z: number): boolean {
  return physics.castRay({ origin: { x, y: baseY - 0.05, z }, direction: { x: 0, y: -1, z: 0 }, maxDistance: 0.2 }).hit;
}
```

## 04-render-scene.ts
```ts
// Cena 3D: objetos Three.js entram pela API de render (chave única) e SAEM no dispose.
import * as THREE from "three";
import type { Render3DApi } from "../../../tokens/render";

export function buildScene(render: Render3DApi): () => void {
  render.setAmbientLight({ color: 0xffffff, intensity: 0.6 });
  render.setDirectionalLight({ color: 0xffffff, intensity: 1.2, castShadow: false, position: { x: 5, y: 10, z: 5 } });

  const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x3399ff }));
  render.addMeshToScene("meu-jogo:cube", cube);

  return (): void => {
    render.removeMeshFromScene("meu-jogo:cube");
    cube.geometry.dispose();
    cube.material.dispose(); // GPU não é coletada pelo GC
  };
}
// Sincronize mesh↔corpo: physics.syncMeshTransform(id, mesh) a cada tick (ver 03-physics-body.ts).
```

## 05-input-actions.ts
```ts
// Input por AÇÕES lógicas (não por teclas). Consulte no tick.
// Já existe um mapa padrão: ações Jump(Space), Interact(KeyE), Attack(Mouse0); eixos MoveForward(KeyW/KeyS), MoveRight(KeyD/KeyA).
// Códigos de tecla = KeyboardEvent.code ("KeyW", "Space"); mouse = "Mouse0..2"; gamepad = "GamepadButton0..". setBindingMap SUBSTITUI o mapa.
import type { InputBindingMap } from "../../../contracts/input/types";
import type { InputApi } from "../../../tokens/input";

const BINDINGS: InputBindingMap = {
  actions: { jump: ["Space"], fire: ["Mouse0"] },
  axes: { moveX: { positive: "KeyD", negative: "KeyA" }, moveY: { positive: "KeyW", negative: "KeyS" } },
};

export function setupInput(input: InputApi): void {
  input.setBindingMap(BINDINGS);
}

export function pollInput(input: InputApi): { jump: boolean; moveX: number; moveY: number } {
  return { jump: input.isActionPressed("jump"), moveX: input.getAxis("moveX"), moveY: input.getAxis("moveY") };
}
// Mouse 3D: await input.requestPointerLock(); depois input.getMouseDelta().
```

## 06-assets-audio.ts
```ts
// Assets têm contagem de referências: todo load precisa de release.
import type { AssetsApi } from "../../../tokens/assets";
import type { AudioApi } from "../../../tokens/audio";

export async function loadAndPlay(assets: AssetsApi, audio: AudioApi): Promise<() => void> {
  const url = "/projects/meu-jogo/audio/hit.wav"; // arquivo físico em public/projects/meu-jogo/audio/hit.wav
  await assets.loadAudio(url);
  audio.playSound(url, "sfx", 0.8);
  audio.setChannelVolume("bgm", 0.5);
  return (): void => {
    audio.stopAllSounds();
    assets.releaseAsset(url);
  };
}
// Modelos: await assets.loadGLTF(url) → cena Three; texturas: assets.loadTexture(url).
```

## 07-hud.ts
```ts
// HUD: a engine só fornece #hud-overlay e o binder genérico. Marcação e chaves são do JOGO.
import type { UIApi } from "../../../tokens/ui";

export function mountHud(ui: UIApi, doc: Document = document): () => void {
  const overlay = doc.getElementById("hud-overlay");
  const root = doc.createElement("div");
  root.innerHTML = `
    <div>Vida: <span data-bind="hp">0</span> / <span data-bind="maxHp">0</span></div>
    <div class="bar"><div data-hud-fill="hp"></div></div>`; // largura = hp / maxHp (ou data-hud-max="outraChave")
  overlay?.appendChild(root);
  ui.bindHUDData({ hp: 100, maxHp: 100 });
  return (): void => root.remove();
}
export function damage(ui: UIApi, hp: number): void {
  ui.updateHUD("hp", hp);
}
```

## 08-save-load.ts
```ts
// Saves por slot (driver padrão local). Só dados serializáveis.
import type { StorageApi } from "../../../tokens/storage";

interface SaveData extends Record<string, unknown> {
  level: number;
  hp: number;
}

export async function save(storage: StorageApi, data: SaveData): Promise<void> {
  await storage.saveGame("slot-1", data);
}
export async function load(storage: StorageApi): Promise<SaveData | null> {
  return storage.loadGame<SaveData>("slot-1");
}
```

## 09-steam-achievement.ts
```ts
// Conquistas: a regra "quando" é do jogo. Envie o comando (Promise<void>, sem valor de retorno); sem Steam o desbloqueio é no-op e nada quebra.
import type { PluginContext } from "@core";
import { UnlockAchievementCommand } from "../../../contracts/steam/types";

export async function unlock(ctx: PluginContext, achievementId: string): Promise<void> {
  await ctx.commands.send(UnlockAchievementCommand.type, { achievementId });
}
// O jogo deve funcionar sem Steam: nunca bloqueie gameplay esperando resposta.
```

## 10-camera.ts
```ts
// Câmera: `game.camera` controla a câmera do render a cada frame (RenderApi.setCameraMode não tem efeito).
// Isométrica que segue um alvo: spring-arm + setFollowTarget a cada tick; zoom = configureSpringArm (mantém o shake).
import type { CameraApi } from "../../../tokens/camera";

const ID = "main";

/** Quaternion de yaw (em torno de Y) seguido de pitch (em torno de X), em graus. Sem alocar Three.js. */
export function yawPitchQuaternion(yawDeg: number, pitchDeg: number): { x: number; y: number; z: number; w: number } {
  const hy = (yawDeg * Math.PI) / 360;
  const hp = (pitchDeg * Math.PI) / 360;
  const cy = Math.cos(hy), sy = Math.sin(hy), cp = Math.cos(hp), sp = Math.sin(hp);
  // q = qYaw * qPitch
  return { x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp };
}

export function setupIsometricCamera(camera: CameraApi, yawDeg = 45, armLength = 40): () => void {
  camera.registerVirtualCamera({
    id: ID,
    priority: 10,
    fov: 35,
    position: { x: 0, y: 30, z: 30 },
    rotation: yawPitchQuaternion(yawDeg, -35),
    springArmConfig: {
      targetArmLength: armLength,
      probeRadius: 0.2,
      socketOffset: { x: 0, y: 0, z: 0 },
      targetOffset: { x: 0, y: 1, z: 0 },
      enableCollision: false,
    },
    shakeConfig: { maxTrauma: 1, traumaDecayRate: 1.5 },
  });
  camera.setActiveCamera(ID, 0);
  return (): void => {
    camera.unregisterVirtualCamera(ID);
  };
}

/** Chame no tick com a posição atual do alvo. */
export function follow(camera: CameraApi, x: number, y: number, z: number): void {
  camera.setFollowTarget(ID, { x, y, z });
}

/** Zoom contínuo (ex.: roda do mouse via listener DOM no adapter). */
export function zoom(camera: CameraApi, armLength: number): void {
  camera.configureSpringArm(ID, { targetArmLength: Math.min(80, Math.max(15, armLength)) });
}

/** Girar 90°: re-registra (zera o shake, por isso só em giros discretos). */
export function rotateTo(camera: CameraApi, yawDeg: number, armLength: number): () => void {
  return setupIsometricCamera(camera, yawDeg, armLength);
}
```

## 11-test-with-mock-context.ts
```ts
// Teste unitário do jogo sem subir o kernel: monte um ctx falso só com o que o plugin usa.
// (Use em arquivos *.test.ts do seu projeto; aqui só mostra a forma, compilada pelo tsc.)
import type { PluginContext } from "@core";
import type { PhysicsApi } from "../../../tokens/physics";

export function makeFakePhysics(): PhysicsApi & { bodies: string[] } {
  const bodies: string[] = [];
  const zero = { x: 0, y: 0, z: 0 };
  return {
    bodies,
    step: (): void => undefined,
    createBody: (id): boolean => { bodies.push(id); return true; },
    removeBody: (id): boolean => { const i = bodies.indexOf(id); if (i >= 0) bodies.splice(i, 1); return i >= 0; },
    applyImpulse: (): boolean => true,
    applyForce: (): boolean => true,
    castRay: () => ({ hit: false, distance: 0, point: zero, normal: zero }),
    getBodyTransform: () => null,
    syncMeshTransform: (): boolean => false,
    setGravity: (): void => undefined,
    getStats: () => ({ rigidBodyCount: bodies.length, colliderCount: bodies.length, stepTimeMs: 0, isWasmLoaded: true }),
  };
}

// Passe o fake onde o plugin faria ctx.caps.require(PhysicsToken): extraia a lógica do jogo em funções que recebem PhysicsApi.
export type GameLogic = (ctx: PluginContext, physics: PhysicsApi) => () => void;
```

## 12-input-edge-events.ts
```ts
// Ações de toque único: o input é bombeado por requestAnimationFrame, não pelo tick.
// Use o evento game.input.action para bordas; eixos/held leia no tick.
import type { PluginContext } from "@core";
import { InputActionEvent } from "../../../contracts/input/types";
import type { InputActionPayload, InputBindingMap } from "../../../contracts/input/types";
import type { InputApi } from "../../../tokens/input";

// setBindingMap SUBSTITUI tudo: inclua os eixos MoveForward/MoveRight.
export const BINDINGS: InputBindingMap = {
  actions: {
    Interact: ["KeyE", "GamepadButton2"],
    Jump: ["Space", "GamepadButton0"],
    Sprint: ["ShiftLeft", "GamepadButton4"],
    UseTool: ["Mouse0", "GamepadButton1"],
    Drop: ["KeyG", "GamepadButton3"],
  },
  axes: {
    MoveForward: { positive: "KeyW", negative: "KeyS" },
    MoveRight: { positive: "KeyD", negative: "KeyA" },
  },
};

export function bindEdges(ctx: PluginContext, onPressed: (action: string) => void): () => void {
  return ctx.events.on<"game.input.action", InputActionPayload>(InputActionEvent.type, (env): void => {
    if (env.payload.state === "pressed") onPressed(env.payload.action);
  });
}

/** Leitura contínua no tick (sem alocar: escreve no objeto recebido). */
export function readMove(input: InputApi, out: { x: number; z: number; sprint: boolean }): void {
  out.x = input.getAxis("MoveRight");
  out.z = input.getAxis("MoveForward");
  out.sprint = input.isActionHeld("Sprint");
}
```

## 13-terrain-chunks.ts
```ts
// Terreno: update() da engine é no-op. O jogo pede/descarrega chunks (16x128x16) ao redor de um ponto.
import type { PluginContext } from "@core";
import { ChunkGeneratedEvent } from "../../../contracts/terrain/types";
import type { ChunkGeneratedPayload } from "../../../contracts/terrain/types";
import type { TerrainApi } from "../../../tokens/terrain";

export class ChunkWindow {
  private readonly loaded = new Set<string>();
  public constructor(private readonly terrain: TerrainApi, private readonly radiusChunks: number) {}

  /** Chame quando o centro mudar de chunk (não a cada tick). */
  public recenter(worldX: number, worldZ: number): void {
    const cx = Math.floor(worldX / 16), cz = Math.floor(worldZ / 16);
    const wanted = new Set<string>();
    for (let dx = -this.radiusChunks; dx <= this.radiusChunks; dx += 1) {
      for (let dz = -this.radiusChunks; dz <= this.radiusChunks; dz += 1) {
        const key = `${cx + dx}:${cz + dz}`;
        wanted.add(key);
        if (!this.loaded.has(key)) this.terrain.requestChunk({ x: cx + dx, y: 0, z: cz + dz });
      }
    }
    for (const key of this.loaded) {
      if (!wanted.has(key)) {
        const [x, z] = key.split(":").map(Number);
        this.terrain.unloadChunk({ x, y: 0, z });
      }
    }
    this.loaded.clear();
    for (const key of wanted) this.loaded.add(key);
  }

  public dispose(): void {
    this.terrain.clear();
    this.loaded.clear();
  }
}

/** Altura da superfície numa coluna (use após chunk-generated; não por tick). */
export function surfaceHeight(terrain: TerrainApi, x: number, z: number): number {
  for (let y = 127; y >= 0; y -= 1) {
    if (terrain.getVoxelBlock({ x, y, z }).id !== 0) return y + 1;
  }
  return 0;
}

export function onChunkReady(ctx: PluginContext, fn: (p: ChunkGeneratedPayload) => void): () => void {
  return ctx.events.on<"game.terrain.chunk-generated", ChunkGeneratedPayload>(ChunkGeneratedEvent.type, (env): void => {
    fn(env.payload);
  });
}
```

## 14-local-frame.ts
```ts
// Referencial local (contorno da lacuna G1): física de quem está "dentro" de algo móvel roda num espaço parado.
// Ex.: o trem fica físico numa ILHA longe da rota; para desenhar, aplique a pose do trem no mundo.
// A ilha fica longe também em X/Z porque `world.querySpatialGrid` é 2D (x,z): evita misturar entidades da ilha com as do mundo.
export interface Pose { x: number; y: number; z: number; yaw: number }

export const ISLAND = { x: -5000, y: -500, z: -5000 } as const;

/** Local (ilha) -> mundo. Escreve em `out` (sem alocar no tick). */
export function islandToWorld(local: { x: number; y: number; z: number }, pose: Pose, out: { x: number; y: number; z: number }): void {
  const lx = local.x - ISLAND.x, ly = local.y - ISLAND.y, lz = local.z - ISLAND.z;
  const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  out.x = pose.x + lx * c + lz * s;
  out.y = pose.y + ly;
  out.z = pose.z - lx * s + lz * c;
}

/** Força fictícia de curva/frenagem: aceleração do trem no referencial local (aplique com applyForce/applyImpulse). */
export function inertialAcceleration(prevSpeed: number, speed: number, yawRate: number, dt: number): { ax: number; az: number } {
  const along = dt > 0 ? (speed - prevSpeed) / dt : 0; // frenagem empurra para frente (+z local se o trem anda em +z)
  return { ax: -speed * yawRate, az: -along };
}
```

