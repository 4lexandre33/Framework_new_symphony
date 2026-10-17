// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { PluginContext } from "@core";
import { OverlayService } from "../src/engine/overlay/internal/OverlayService";
import { TauriOverlayDriver } from "../src/engine/overlay/internal/TauriOverlayDriver";
import { createThreeRaycastProvider } from "../src/engine/overlay/internal/ThreeRaycastProvider";

interface NativeWindow {
  alwaysOnTop: boolean;
  decorations: boolean;
  ignore: boolean;
  cursor: { x: number; y: number; inside: boolean };
  failNext?: string;
  taskbar: "ok" | "unsupported";
  calls: string[];
}

function nativeDriver(win: NativeWindow): TauriOverlayDriver {
  return new TauriOverlayDriver(async <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
    win.calls.push(cmd);
    if (win.failNext) {
      const msg = win.failNext;
      win.failNext = undefined;
      throw msg; // Tauri rejeita com string
    }
    switch (cmd) {
      case "overlay_set_ignore_cursor_events": win.ignore = args!.ignore as boolean; return undefined as T;
      case "overlay_set_always_on_top": win.alwaysOnTop = args!.alwaysOnTop as boolean; return undefined as T;
      case "overlay_set_decorations": win.decorations = args!.decorations as boolean; return undefined as T;
      case "overlay_get_window_state":
        return { alwaysOnTop: win.alwaysOnTop, decorations: win.decorations, ignoreCursorEvents: win.ignore, taskbarSupported: win.taskbar === "ok", platform: "linux" } as T;
      case "overlay_get_cursor_position": return win.cursor as T;
      case "overlay_dock_to_taskbar":
      case "overlay_get_taskbar_bounds":
        if (win.taskbar === "unsupported") throw "unsupported: barra de tarefas não detectável neste sistema (linux)";
        return { x: 0, y: 1040, width: 1920, height: 40, position: "bottom" } as T;
      default: throw `comando desconhecido ${cmd}`;
    }
  }, () => true);
}

function makeWin(over: Partial<NativeWindow> = {}): NativeWindow {
  return { alwaysOnTop: false, decorations: true, ignore: false, cursor: { x: 0, y: 0, inside: true }, taskbar: "ok", calls: [], ...over };
}

function ctx(): { ctx: PluginContext; events: Array<{ type: string; payload: unknown }> } {
  const events: Array<{ type: string; payload: unknown }> = [];
  return { ctx: { events: { emit: (type: string, payload: unknown) => events.push({ type, payload }) } } as unknown as PluginContext, events };
}

const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

describe("G15 passthrough: sem update(0,0) por tick, cursor real, raycast 3D", () => {
  it("padrão seguro: manual, sem passthrough; setPassthrough(true) persiste entre ticks", async () => {
    const win = makeWin();
    let now = 0;
    const svc = new OverlayService(ctx().ctx, { driver: nativeDriver(win), pointerTarget: null, now: () => now });
    await svc.initialize();
    expect(svc.passthroughPolicy).toBe("manual");
    expect(svc.isPassthroughActive).toBe(false);
    await svc.setPassthrough(true);
    for (let i = 0; i < 10; i++) { now += 16; svc.onTick(); }
    await flush();
    expect(svc.isPassthroughActive).toBe(true);
    expect(win.ignore).toBe(true);
    expect(win.calls.filter((c) => c === "overlay_set_ignore_cursor_events")).toHaveLength(1);
  });

  it("auto: pointermove real decide pelo DOM; em passthrough faz poll do cursor nativo e volta ao passar sobre UI", async () => {
    document.body.innerHTML = '<button id="menu" style="position:absolute;left:0;top:0;width:100px;height:50px">Menu</button>';
    const button = document.getElementById("menu")!;
    const original = document.elementFromPoint;
    document.elementFromPoint = ((x: number, y: number) => (x < 100 && y < 50 ? button : document.body)) as typeof document.elementFromPoint;
    try {
      const win = makeWin();
      const target = new EventTarget();
      let now = 0;
      const svc = new OverlayService(ctx().ctx, { driver: nativeDriver(win), pointerTarget: target, now: () => now });
      await svc.initialize();
      svc.setPassthroughPolicy("auto");
      const move = (x: number, y: number): void => {
        const ev = new Event("pointermove") as Event & { clientX: number; clientY: number };
        ev.clientX = x; ev.clientY = y;
        target.dispatchEvent(ev);
      };
      move(10, 10);
      await flush();
      expect(svc.isPassthroughActive).toBe(false);
      move(500, 500); // fundo
      await flush();
      expect(svc.isPassthroughActive).toBe(true);
      expect(win.ignore).toBe(true);
      // Janela ignorando o mouse: DOM não recebe eventos → poll nativo no tick.
      win.cursor = { x: 20, y: 20, inside: true };
      now += 100; svc.onTick();
      await flush();
      expect(win.calls).toContain("overlay_get_cursor_position");
      expect(svc.isPassthroughActive).toBe(false);
      expect(win.ignore).toBe(false);
      svc.dispose();
    } finally {
      document.elementFromPoint = original;
    }
  });

  it("raycast 3D ligado: mesh sob o cursor bloqueia o passthrough", async () => {
    document.body.innerHTML = "";
    const canvas = document.createElement("canvas");
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0, toJSON() { return {}; } });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.updateMatrixWorld();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    mesh.userData.entityId = "pet";
    scene.add(mesh);
    scene.updateMatrixWorld(true);
    const provider = createThreeRaycastProvider({ getScene: () => scene, getActiveCamera: () => camera, getCanvas: () => canvas });
    expect(provider(100, 100)).toEqual({ hit: true, entityId: "pet" });
    expect(provider(5, 5).hit).toBe(false);
    mesh.userData.overlayInteractive = false;
    expect(provider(100, 100).hit).toBe(false);
    mesh.userData.overlayInteractive = true;

    const svc = new OverlayService(ctx().ctx, { driver: nativeDriver(makeWin()), pointerTarget: null });
    await svc.initialize();
    svc.setRaycastProvider(provider);
    svc.setSceneCanvas(canvas);
    expect(svc.performHitTest(100, 100)).toMatchObject({ hit: true, targetType: "three_mesh", entityId: "pet" });
    svc.setPassthroughPolicy("auto");
    svc.update(5, 5, 0);
    await flush();
    expect(svc.isPassthroughActive).toBe(true);
    svc.update(100, 100, 0);
    await flush();
    expect(svc.isPassthroughActive).toBe(false);
  });
});

describe("G121 modos aplicam flags nativas, erros aparecem, clear reverte", () => {
  it("setOverlayMode aplica alwaysOnTop/decorations/política e window volta ao normal", async () => {
    const win = makeWin();
    const svc = new OverlayService(ctx().ctx, { driver: nativeDriver(win), pointerTarget: null });
    await svc.initialize();
    const r = await svc.setOverlayMode("desktop_pet");
    expect(r).toMatchObject({ applied: true, mode: "desktop_pet", passthroughPolicy: "auto", errors: [] });
    expect(win).toMatchObject({ alwaysOnTop: true, decorations: false });
    expect(svc.isAlwaysOnTop).toBe(true);
    const back = await svc.setOverlayMode("window");
    expect(back.applied).toBe(true);
    expect(win).toMatchObject({ alwaysOnTop: false, decorations: true, ignore: false });
  });

  it("dock sem suporte: resultado honesto (docked=false, erro 'unsupported')", async () => {
    const win = makeWin({ taskbar: "unsupported" });
    const svc = new OverlayService(ctx().ctx, { driver: nativeDriver(win), pointerTarget: null });
    await svc.initialize();
    expect(await svc.dockToTaskbar()).toBe(false);
    expect(svc.lastError).toMatch(/^unsupported:/);
    expect(await svc.getTaskbarBounds()).toBeNull();
    const r = await svc.setOverlayMode("taskbar_dock");
    expect(r.docked).toBe(false);
    expect(r.applied).toBe(false);
    expect(r.errors.join()).toMatch(/unsupported/);
  });

  it("erro nativo rejeita o setter e o getter NÃO muda", async () => {
    const win = makeWin();
    const svc = new OverlayService(ctx().ctx, { driver: nativeDriver(win), pointerTarget: null });
    await svc.initialize();
    win.failNext = "Falha ao alterar modo AlwaysOnTop: denied";
    await expect(svc.setAlwaysOnTop(true)).rejects.toThrow(/denied/);
    expect(svc.isAlwaysOnTop).toBe(false);
    expect(svc.lastError).toMatch(/denied/);
    win.failNext = "Falha ao alterar passthrough do mouse: x";
    await expect(svc.setPassthrough(true)).rejects.toThrow(/passthrough/);
    expect(svc.isPassthroughActive).toBe(false);
  });

  it("getters refletem o estado nativo lido no boot e clear/restoreWindow revertem", async () => {
    const win = makeWin({ alwaysOnTop: true, decorations: false }); // ex.: projeto overlay
    const svc = new OverlayService(ctx().ctx, { driver: nativeDriver(win), pointerTarget: null });
    await svc.initialize();
    expect(svc.isAlwaysOnTop).toBe(true);
    await svc.setOverlayMode("window");
    await svc.setPassthrough(true);
    expect(win).toMatchObject({ alwaysOnTop: false, decorations: true, ignore: true });
    const state = await svc.restoreWindow();
    expect(win).toMatchObject({ alwaysOnTop: true, decorations: false, ignore: false });
    expect(state).toMatchObject({ native: true, alwaysOnTop: true, decorations: false, ignoreCursorEvents: false });
    expect(svc.passthroughPolicy).toBe("manual");
  });

  it("sem Tauri: tudo simulado com native=false (não mente sobre a janela)", async () => {
    const driver = new TauriOverlayDriver(async () => { throw new Error("nope"); }, () => false);
    const svc = new OverlayService(ctx().ctx, { driver, pointerTarget: null });
    const s = await svc.initialize();
    expect(s.native).toBe(false);
    expect(await svc.dockToTaskbar()).toBe(false);
    expect(svc.lastError).toMatch(/unsupported: sem host Tauri/);
    const r = await svc.setOverlayMode("always_on_top_hud");
    expect(r.state.native).toBe(false);
  });
});
