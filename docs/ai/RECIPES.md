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
        events: [], // allow-list EXATA do que ESTE plugin emite; [] = nenhum (adicione os tipos antes de ctx.events.emit)
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
// Não aloque objetos por tick. Pausa: GameLoopApi.pause() para os ticks (o render continua com isPaused=true); resume() retoma.
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
  render.setInterpolated("meu-jogo:cube", true); // mova no tick; a engine suaviza entre ticks

  return (): void => {
    // Libera geometria/material/texturas que nenhum outro objeto registrado usa.
    // Instâncias de GLTF do cache: removeMeshFromScene(chave) não libera a GPU compartilhada (G81); depois assets.releaseInstance(gltf).
    render.removeMeshFromScene("meu-jogo:cube");
  };
}
// Sincronize mesh↔corpo no tick: physics.syncMeshTransform(id, mesh) (ver 03-physics-body.ts).
```

## 05-input-actions.ts
```ts
// Input por AÇÕES lógicas (não por teclas). Consulte no tick com as variantes *InTick.
// Mapa padrão: ações Jump(Space), Interact(KeyE), Attack(Mouse0); eixos MoveForward(W/S), MoveRight(D/A), LookRight/LookUp (analógico direito).
// Códigos = KeyboardEvent.code ("KeyW", "Space"); mouse "Mouse0..2"; roda "WheelUp/WheelDown"; gamepad "GamepadButtonN"/"GamepadAxisN+".
// setBindingMap SUBSTITUI o mapa inteiro.
import type { InputBindingMap } from "../../../contracts/input/types";
import type { InputApi } from "../../../tokens/input";

const BINDINGS: InputBindingMap = {
  actions: { jump: ["Space", "GamepadButton0"], fire: ["Mouse0", "GamepadButton7"] },
  axes: {
    moveX: { positive: "KeyD", negative: "KeyA", positiveAlt: ["GamepadAxis0+"], negativeAlt: ["GamepadAxis0-"] },
    moveY: { positive: "KeyW", negative: "KeyS", positiveAlt: ["GamepadAxis1-"], negativeAlt: ["GamepadAxis1+"] },
  },
};

export function setupInput(input: InputApi): void {
  input.setBindingMap(BINDINGS);
}

/** Chame dentro de game.loop.tick. Escreve em `out` (sem alocar). */
export function pollInput(input: InputApi, out: { jump: boolean; moveX: number; moveY: number }): void {
  out.jump = input.isActionPressedInTick("jump"); // borda vista uma vez por tick
  out.moveX = input.getAxis("moveX");
  out.moveY = input.getAxis("moveY");
}
// Mouse 3D: await input.requestPointerLock(); no tick some input.getTickMouseDelta() (no render: getMouseDelta()).
```

## 06-assets-audio.ts
```ts
// Assets têm contagem de referências: todo load precisa de release. Sons devolvem handle.
import type { AssetsApi } from "../../../tokens/assets";
import type { AudioApi } from "../../../tokens/audio";

export async function loadAndPlay(assets: AssetsApi, audio: AudioApi): Promise<() => void> {
  const hit = "/projects/meu-jogo/audio/hit.wav"; // arquivo físico em public/projects/meu-jogo/audio/hit.wav
  const rain = "/projects/meu-jogo/audio/rain.wav";
  await Promise.all([assets.loadAudio(hit), assets.loadAudio(rain)]); // não espera gesto; o áudio destrava sozinho no 1º clique/tecla
  audio.playSound(hit, "sfx", 0.8);
  const rainHandle = audio.playSound(rain, "sfx", 0.5, true); // loop controlável pelo handle
  audio.setChannelVolume("bgm", 0.5); // mantém o estado de mudo
  return (): void => {
    audio.stopSound(rainHandle, 0.5); // fade de 0,5 s
    assets.releaseAsset(hit);
    assets.releaseAsset(rain);
  };
}
// Modelos: const gltf = await assets.loadGLTF(url) → gltf.scene é uma instância própria (um releaseAsset por instância).
// JSON: await assets.loadJSON<T>(url). Texturas de dados: assets.loadTexture(url, { colorSpace: "linear" }).
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
// Saves por slot. Backend automático: app Tauri → arquivos; navegador → IndexedDB (senão localStorage);
// node/vitest → memória (veja storage.resolveBackendInfo()). Só dados serializáveis.
import type { StorageApi } from "../../../tokens/storage";

interface SaveData extends Record<string, unknown> {
  level: number;
  hp: number;
}

/** Uma vez no boot: isola os slots deste jogo e define a versão do schema. */
export function configureSaves(storage: StorageApi): void {
  storage.configureSaves({ namespace: "meu-jogo", schemaVersion: 2, gameVersion: "1.0.0", backupCount: 1 });
  // v1 não tinha hp: a migração roda no load.
  storage.registerMigration(1, (data) => ({ ...data, hp: 100 }));
}

export async function save(storage: StorageApi, data: SaveData, playTimeSeconds: number): Promise<void> {
  await storage.saveGame("slot-1", data, undefined, { playTimeSeconds }); // rejeita em falha (ex.: code "quota-exceeded")
}

/** Nunca rejeita por save corrompido: usa backup ou devolve null. */
export async function load(storage: StorageApi): Promise<SaveData | null> {
  const result = await storage.loadGameDetailed<SaveData>("slot-1");
  return result.status === "ok" || result.status === "recovered" ? result.data : null;
}
```

## 09-steam-achievement.ts
```ts
// Conquistas/stats: a regra "quando" é do jogo. Sem Steam tudo resolve false e nada quebra.
import type { SteamApi } from "../../../tokens/steam";

/** true se a Steam confirmou. Sem Steam (ou stats ainda não carregadas) devolve false: tente de novo depois. */
export async function unlock(steam: SteamApi, achievementId: string): Promise<boolean> {
  if (!steam.isAvailable && !(await steam.checkAvailability())) return false;
  return steam.unlockAchievement(achievementId);
}

export async function addDistance(steam: SteamApi, totalMeters: number): Promise<boolean> {
  const ok = await steam.setStat("distancia_total", Math.floor(totalMeters)); // int 32 bits; float: { type: "float" }
  return ok && (await steam.storeStats());
}
// Alternativa por comando: await ctx.commands.send(UnlockAchievementCommand.type, { achievementId }) também resolve com o retorno do handler.
// O jogo deve funcionar sem Steam: nunca bloqueie gameplay esperando resposta.
```

## 10-camera.ts
```ts
// Câmera: com uma câmera virtual registrada, `game.camera` controla a câmera do render a cada frame.
// Isométrica que segue um alvo: spring-arm + alvo; zoom pela roda = configureSpringArm (mantém o shake).
import type { CameraApi } from "../../../tokens/camera";
import type { InputApi } from "../../../tokens/input";

const ID = "main";

/** Quaternion de yaw (em torno de Y) seguido de pitch (em torno de X), em graus. Sem alocar Three.js. */
export function yawPitchQuaternion(yawDeg: number, pitchDeg: number): { x: number; y: number; z: number; w: number } {
  const hy = (yawDeg * Math.PI) / 360;
  const hp = (pitchDeg * Math.PI) / 360;
  const cy = Math.cos(hy), sy = Math.sin(hy), cp = Math.cos(hp), sp = Math.sin(hp);
  // q = qYaw * qPitch
  return { x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp };
}

/**
 * `followBodyId`: id de um corpo físico para seguir sozinho (lido a cada frame).
 * Sem ele, chame `follow()` quando o alvo mudar (os números são copiados).
 */
export function setupIsometricCamera(camera: CameraApi, yawDeg = 45, armLength = 40, followBodyId?: string): () => void {
  camera.registerVirtualCamera({
    id: ID,
    priority: 10, // a de maior prioridade fica ativa sozinha
    fov: 35,
    position: { x: 0, y: 30, z: 30 },
    rotation: yawPitchQuaternion(yawDeg, -35),
    ...(followBodyId !== undefined ? { followTargetId: followBodyId } : {}),
    springArmConfig: {
      targetArmLength: armLength,
      probeRadius: 0.2,
      socketOffset: { x: 0, y: 0, z: 0 },
      targetOffset: { x: 0, y: 1, z: 0 },
      enableCollision: false, // isométrica estável (sem encurtar o braço em paredes)
    },
    shakeConfig: { maxTrauma: 1, traumaDecayRate: 1.5 },
    blendDurationSeconds: 0,
  });
  return (): void => {
    camera.unregisterVirtualCamera(ID);
  };
}

/** Alvo manual (ex.: posição calculada pelo jogo). */
export function follow(camera: CameraApi, x: number, y: number, z: number): void {
  camera.setFollowTarget(ID, { x, y, z });
}

/** No tick: roda do mouse acumulada desde o tick anterior → comprimento do braço. Devolve o novo comprimento. */
export function zoomByWheel(camera: CameraApi, input: InputApi, armLength: number): number {
  const wheelY = input.getTickWheelDelta().y; // > 0 = afastar
  if (wheelY === 0) return armLength;
  const next = Math.min(80, Math.max(15, armLength + wheelY * 0.02));
  camera.configureSpringArm(ID, { targetArmLength: next });
  return next;
}

/** Girar 90°: re-registrar o mesmo id troca a rotação e PRESERVA trauma, alvo manual e status de ativa. */
export function rotateTo(camera: CameraApi, yawDeg: number, armLength: number, followBodyId?: string): () => void {
  return setupIsometricCamera(camera, yawDeg, armLength, followBodyId);
}
```

## 11-test-with-mock-context.ts
```ts
// Teste unitário do jogo sem subir o kernel: fakes PARCIAIS dos tokens.
// A API dos tokens cresce com o tempo; implemente só o que o jogo usa e
// deixe o resto lançar erro claro (assim o teste não quebra quando a engine ganha métodos).
import type { PluginContext } from "@core";
import type { PhysicsApi } from "../../../tokens/physics";

/** Cria um fake que implementa só `impl`; qualquer outro método lança "não implementado no fake". */
export function partialFake<T extends object>(name: string, impl: Partial<T>): T {
  return new Proxy(impl as T, {
    get(target, prop, receiver): unknown {
      if (prop in target) return Reflect.get(target, prop, receiver);
      if (prop === "then") return undefined; // não parecer Promise
      return (): never => {
        throw new Error(`${name}.${String(prop)} não implementado no fake`);
      };
    },
  });
}

export function makeFakePhysics(): { api: PhysicsApi; bodies: string[] } {
  const bodies: string[] = [];
  const api = partialFake<PhysicsApi>("PhysicsApi", {
    createBody: (id): boolean => { bodies.push(id); return true; },
    removeBody: (id): boolean => { const i = bodies.indexOf(id); if (i >= 0) bodies.splice(i, 1); return i >= 0; },
    applyImpulse: (): boolean => true,
    getBodyTransform: () => null,
  });
  return { api, bodies };
}

// Passe o fake onde o plugin faria ctx.caps.require(PhysicsToken): extraia a lógica do jogo em funções que recebem PhysicsApi.
export type GameLogic = (ctx: PluginContext, physics: PhysicsApi) => () => void;
```

## 12-input-edge-events.ts
```ts
// Ações de toque único: leia as bordas NO TICK com isActionPressedInTick (vista uma vez por tick,
// mesmo com vários frames por tick ou toques mais curtos que um tick).
// Exceção: com o jogo PAUSADO não há tick — trate "continuar"/menus pelo evento game.input.action.
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
    Pause: ["Escape", "GamepadButton9"], // a UI da engine não captura ESC
  },
  axes: {
    MoveForward: { positive: "KeyW", negative: "KeyS", positiveAlt: ["GamepadAxis1-"], negativeAlt: ["GamepadAxis1+"] },
    MoveRight: { positive: "KeyD", negative: "KeyA", positiveAlt: ["GamepadAxis0+"], negativeAlt: ["GamepadAxis0-"] },
  },
};

export interface TickInput {
  x: number;
  z: number;
  sprint: boolean;
  interactPressed: boolean;
  interactReleased: boolean;
  jump: boolean;
  useTool: boolean;
  drop: boolean;
}

/** Chame dentro de game.loop.tick. Escreve em `out` (sem alocar). */
export function readTick(input: InputApi, out: TickInput): void {
  out.x = input.getAxis("MoveRight");
  out.z = input.getAxis("MoveForward");
  out.sprint = input.isActionHeld("Sprint");
  out.interactPressed = input.isActionPressedInTick("Interact");
  out.interactReleased = input.isActionReleasedInTick("Interact");
  out.jump = input.isActionPressedInTick("Jump");
  out.useTool = input.isActionPressedInTick("UseTool");
  out.drop = input.isActionPressedInTick("Drop");
}

/** Pausa/menus: funciona com o loop pausado. Filtre `pressed` (o evento também sai com "held" a cada frame). */
export function onPausePressed(ctx: PluginContext, toggle: () => void): () => void {
  return ctx.events.on<"game.input.action", InputActionPayload>(InputActionEvent.type, (env): void => {
    if (env.payload.action === "Pause" && env.payload.state === "pressed") toggle();
  });
}
```

## 13-terrain-chunks.ts
```ts
// Terreno: chunks de 16x256x16. Opção A (mais simples): streaming da engine em volta da câmera ou de um centro.
// Opção B: ChunkWindow abaixo, para formas próprias (corredor, rota). Chunks pedidos à mão ficam fixos até unloadChunk.
import type { PluginContext } from "@core";
import { ChunkGeneratedEvent } from "../../../contracts/terrain/types";
import type { ChunkGeneratedPayload } from "../../../contracts/terrain/types";
import type { TerrainApi } from "../../../tokens/terrain";

/** Opção A. Padrões (G133): sem água e sem colliders; ligue colliders quando algo pisa no terreno e água se quiser lagos. */
export function startTerrain(terrain: TerrainApi, seed: number, walkable: boolean, water = false): void {
  terrain.setSeed(seed);
  terrain.configure({
    streaming: { enabled: true, radiusChunks: 4, centerSource: "camera" },
    ...(walkable ? { colliders: { enabled: true } } : {}),
    ...(water ? { generation: { seaLevel: 16 } } : {}),
  });
}

export class ChunkWindow {
  private readonly loaded = new Set<string>();
  public constructor(private readonly terrain: TerrainApi, private readonly radiusChunks: number) {}

  /** Chame quando o centro mudar de chunk (não a cada tick). requestChunk é idempotente. */
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
        this.terrain.unloadChunk({ x, y: 0, z }); // edições persistem e voltam no próximo requestChunk
      }
    }
    this.loaded.clear();
    for (const key of wanted) this.loaded.add(key);
  }

  public dispose(): void {
    for (const key of this.loaded) {
      const [x, z] = key.split(":").map(Number);
      this.terrain.unloadChunk({ x, y: 0, z });
    }
    this.loaded.clear();
  }
}

/** Altura logo acima da superfície. Funciona até para colunas não carregadas (amostra o gerador, determinístico). */
export function surfaceHeight(terrain: TerrainApi, x: number, z: number): number {
  return terrain.getSurfaceHeight(x, z) + 1;
}

/** Muitas edições de uma vez (bomba, escavação): uma remontagem por chunk afetado. */
export function blast(terrain: TerrainApi, cx: number, cy: number, cz: number, radius: number): number {
  const requests: Array<{ worldPosition: { x: number; y: number; z: number }; newBlockId: number }> = [];
  for (let x = -radius; x <= radius; x += 1)
    for (let y = -radius; y <= radius; y += 1)
      for (let z = -radius; z <= radius; z += 1) requests.push({ worldPosition: { x: cx + x, y: cy + y, z: cz + z }, newBlockId: 0 });
  return terrain.modifyVoxelBlocks(requests);
}

export function onChunkReady(ctx: PluginContext, fn: (p: ChunkGeneratedPayload) => void): () => void {
  return ctx.events.on<"game.terrain.chunk-generated", ChunkGeneratedPayload>(ChunkGeneratedEvent.type, (env): void => {
    fn(env.payload);
  });
}
```

## 14-local-frame.ts
```ts
// Referencial local ("ilha"): a física de quem está DENTRO de algo móvel roda num espaço parado, e o desenho aplica a pose.
// Não é mais necessário para mover corpos (use kinematic, receita 15). Use a ilha quando também precisar de:
// - navmesh/IA sobre o objeto móvel (a navmesh do game.ai é estática);
// - coordenadas locais estáveis (rede envia posições relativas ao veículo; partes que se separam divergem sem física extra);
// - forças de curva/frenagem controladas pelo jogo, independentes do atrito.
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

/** Força fictícia de curva/frenagem: aceleração do veículo no referencial local (aplique com applyImpulse(m·a·dt)). */
export function inertialAcceleration(prevSpeed: number, speed: number, yawRate: number, dt: number): { ax: number; az: number } {
  const along = dt > 0 ? (speed - prevSpeed) / dt : 0; // frenagem empurra para frente (+z local se o veículo anda em +z)
  return { ax: -speed * yawRate, az: -along };
}
// Massa para m·a: physics.getBodyMass(id). Velocidade de um corpo: physics.getLinearVelocity(id).
```

## 15-kinematic-platform.ts
```ts
// Plataforma móvel (elevador, balsa, vagão simples): corpo kinematicPositionBased movido a cada tick com
// setNextKinematicTransform — a engine deriva a velocidade e EMPURRA/carrega corpos dinâmicos por contato.
// Personagem: dynamic com rotações travadas (fica em pé); chão por raio que ignora o próprio corpo.
import type { PhysicsApi } from "../../../tokens/physics";

export function createPlatform(physics: PhysicsApi, id: string, x: number, y: number, z: number): () => void {
  physics.createBody(id, { bodyType: "kinematicPositionBased", position: { x, y, z } }, { shapeType: "box", halfExtents: { x: 3, y: 0.25, z: 3 }, friction: 1 });
  // Grade como collider extra do MESMO corpo (move junto, sem joint):
  physics.addCollider(id, { shapeType: "box", halfExtents: { x: 3, y: 0.5, z: 0.05 }, offset: { x: 0, y: 0.75, z: 2.95 } });
  return (): void => {
    physics.removeBody(id);
  };
}

/** No tick: vai e volta em X com amplitude `a` e período `period` (s). Rotação opcional em `yaw` (rad). */
export function movePlatform(physics: PhysicsApi, id: string, baseX: number, y: number, z: number, t: number, a: number, period: number, yaw = 0): void {
  const x = baseX + a * Math.sin((2 * Math.PI * t) / period);
  physics.setNextKinematicTransform(id, {
    position: { x, y, z },
    rotation: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) },
  });
}

export function createPlayer(physics: PhysicsApi, id: string, x: number, y: number, z: number): () => void {
  physics.createBody(
    id,
    { bodyType: "dynamic", position: { x, y, z }, lockRotations: true, canSleep: false, linearDamping: 0.5 },
    { shapeType: "capsule", radius: 0.35, halfHeight: 0.5, friction: 1, restitution: 0 },
  );
  return (): void => {
    physics.removeBody(id);
  };
}

/** Chão sob a cápsula (base = y − halfHeight − radius). Ignora o próprio corpo e sensores. */
export function isGrounded(physics: PhysicsApi, id: string, out: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number; w: number } }): boolean {
  if (!physics.getBodyTransformInto(id, out)) return false;
  const p = out.position;
  return physics.castRay({ origin: { x: p.x, y: p.y, z: p.z }, direction: { x: 0, y: -1, z: 0 }, maxDistance: 0.85 + 0.1, excludeEntityId: id, excludeSensors: true }).hit;
}

/** Movimento horizontal: corrige a velocidade atual rumo à desejada (mantém a componente vertical). */
export function steer(physics: PhysicsApi, id: string, desiredX: number, desiredZ: number, gain = 0.25): void {
  const v = physics.getLinearVelocity(id);
  const m = physics.getBodyMass(id);
  if (v === null || m === null) return;
  physics.applyImpulse(id, { x: m * (desiredX - v.x) * gain, y: 0, z: m * (desiredZ - v.z) * gain });
}
// Teleporte (respawn): physics.setBodyTranslation(id, pos) — vale para qualquer tipo de corpo.
```

## 16-scene-document.ts
```ts
// Cena em dados (SceneDocument v1): opcional — spawn à mão continua valendo. Arquivos em
// src/projects/<id>/scenes/*.scene.json e prefabs/*.prefab.json (o MCP cria/valida esses arquivos).
// Mapeamento: id→entityId, type→type, position/rotation/scale iguais, tags→tags, data→customData.
import type { WorldApi } from "../../../tokens/world";
import { validateSceneDocument, type PrefabDocument, type SceneDocument } from "../../../contracts/world/types";

const jogador: PrefabDocument = {
  format: "engine.prefab", version: 1, prefabId: "jogador",
  type: "player", tags: ["player"], data: { vida: 3, velocidade: 5 },
  assets: [{ id: "jogador-modelo", url: "/assets/jogador.glb", type: "gltf" }],
};

const fase1: SceneDocument = {
  format: "engine.scene", version: 1, sceneId: "fase-1", sceneName: "Fase 1",
  assets: [{ id: "chao", url: "/assets/chao.png", type: "texture" }],
  entities: [
    // Campos da entidade vencem o prefab; tags = união; data = merge raso → { vida: 5, velocidade: 5 }.
    { id: "player", prefab: "jogador", position: { x: 0, y: 1, z: 0 }, data: { vida: 5 } },
    { id: "caixa-1", type: "prop", position: { x: 3, y: 0.5, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } },
  ],
};

/** Valida → pré-carrega assets (cena + prefabs usados) → spawna. Falha: false e nada spawnado. */
export async function loadFase1(world: WorldApi): Promise<boolean> {
  const ok = await world.loadSceneDocument(fase1, { prefabs: [jogador], failOnAssetError: false });
  // Os spawns acontecem depois de `scene-loaded`: use a entidade só após o await.
  return ok && world.hasEntity("player");
}

/** Mesma validação usada pela engine e pelo MCP (pura, sem DOM): útil em testes do jogo. */
export function checkFase1(): string[] {
  const result = validateSceneDocument(fase1, { prefabs: [jogador] });
  return result.ok ? [] : result.errors.map((e) => `${e.path} ${e.code}: ${e.message}`);
}

// Erros de carga chegam também como evento (declare em permissions.events do seu plugin):
// ctx.events.on("game.world.scene-document-error", (env) => console.error((env.payload as SceneDocumentErrorPayload).errors /* tipo em contracts/world/types */));
```

