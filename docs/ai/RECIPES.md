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
// Câmera virtual: registre, ative com blend, siga um alvo.
import type { CameraApi } from "../../../tokens/camera";

export function setupCamera(camera: CameraApi): () => void {
  camera.registerVirtualCamera({
    id: "main",
    priority: 1,
    fov: 60,
    position: { x: 0, y: 5, z: 10 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
  });
  camera.setActiveCamera("main", 0.5);
  return (): void => {
    camera.unregisterVirtualCamera("main");
  };
}
export function follow(camera: CameraApi, x: number, y: number, z: number): void {
  camera.setFollowTarget("main", { x, y, z });
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

