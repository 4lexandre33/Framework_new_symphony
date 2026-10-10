// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Kernel, type Plugin, type PluginContext } from "@core";

import type {
  GamepadConnectionPayload,
  InputActionPayload,
  PointerLockChangedPayload,
} from "../src/contracts/input/types";
import { GameRenderEvent, GameTickEvent } from "../src/contracts/game-loop/types";
import type { InputFrameScheduler } from "../src/engine/input/internal/InputFramePump";
import { InputManager, type InputEventSink } from "../src/engine/input/internal/InputManager";
import { createInputPlugin } from "../src/plugins/input/plugin";
import { InputToken, type InputApi } from "../src/tokens/input";

interface FakeButton {
  pressed: boolean;
  value: number;
}

function pad(
  index: number,
  buttons: readonly (boolean | number)[],
  axes: readonly number[],
  id = `Pad ${String(index)}`,
): Gamepad {
  return {
    index,
    id,
    connected: true,
    mapping: "standard",
    timestamp: 0,
    axes: [...axes],
    buttons: buttons.map((entry): FakeButton => {
      const value = typeof entry === "number" ? entry : entry ? 1 : 0;
      return { pressed: typeof entry === "boolean" ? entry : value >= 0.5, value };
    }),
  } as unknown as Gamepad;
}

let gamepads: Array<Gamepad | null> = [];

function key(type: "keydown" | "keyup", code: string, target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent(type, { code, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

function mouse(type: "mousedown" | "mouseup", button: number, target: EventTarget = window): void {
  target.dispatchEvent(new MouseEvent(type, { button, bubbles: true }));
}

function move(movementX: number, movementY: number): void {
  const event = new MouseEvent("mousemove", { clientX: 5, clientY: 6 });
  Object.defineProperty(event, "movementX", { value: movementX });
  Object.defineProperty(event, "movementY", { value: movementY });
  window.dispatchEvent(event);
}

function collectingSink(): InputEventSink & {
  actions: InputActionPayload[];
  locks: PointerLockChangedPayload[];
  pads: GamepadConnectionPayload[];
} {
  const actions: InputActionPayload[] = [];
  const locks: PointerLockChangedPayload[] = [];
  const pads: GamepadConnectionPayload[] = [];

  return {
    actions,
    locks,
    pads,
    onAction(payload): void {
      actions.push(payload);
    },
    onDeviceChanged(): void {},
    onPointerLockChanged(payload): void {
      locks.push(payload);
    },
    onGamepadConnection(payload): void {
      pads.push(payload);
    },
  };
}

beforeEach((): void => {
  gamepads = [];
  Object.defineProperty(navigator, "getGamepads", {
    configurable: true,
    value: (): Array<Gamepad | null> => gamepads,
  });
});

afterEach((): void => {
  Reflect.deleteProperty(navigator, "getGamepads");
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("G5 — roda do mouse e bordas por tick fixo", () => {
  it("expõe a roda por frame, por tick e como códigos WheelUp/WheelDown", () => {
    const input = new InputManager();
    input.setBindingMap({ actions: { ZoomIn: ["WheelUp"], ZoomOut: ["WheelDown"] }, axes: {} });
    input.advanceTick(); // sincroniza com o "loop"

    window.dispatchEvent(new WheelEvent("wheel", { deltaY: -120 }));
    window.dispatchEvent(new WheelEvent("wheel", { deltaY: 3, deltaMode: 1 }));
    input.update();

    expect(input.getWheelDelta().y).toBe(-120 + 48);
    expect(input.isActionPressed("ZoomIn")).toBe(true);
    expect(input.isActionReleased("ZoomIn")).toBe(true);
    expect(input.isActionHeld("ZoomIn")).toBe(false);
    expect(input.isActionPressed("ZoomOut")).toBe(true);

    input.advanceTick();
    expect(input.getTickWheelDelta().y).toBe(-72);
    expect(input.isActionPressedInTick("ZoomIn")).toBe(true);

    input.update();
    input.advanceTick();
    expect(input.getWheelDelta().y).toBe(0);
    expect(input.getTickWheelDelta().y).toBe(0);
    expect(input.isActionPressedInTick("ZoomIn")).toBe(false);
    input.dispose();
  });

  it("a borda aparece exatamente uma vez por tick, com vários frames ou vários ticks por frame", () => {
    const input = new InputManager();
    input.advanceTick();

    key("keydown", "Space");
    // 3 frames de render antes do próximo tick (60 Hz de input, 20 Hz de tick).
    input.update();
    input.update();
    input.update();
    expect(input.isActionPressed("Jump")).toBe(false); // borda de frame já passou

    input.advanceTick();
    expect(input.isActionPressedInTick("Jump")).toBe(true);
    // segundo tick no mesmo frame (catch-up): não repete
    input.advanceTick();
    expect(input.isActionPressedInTick("Jump")).toBe(false);
    expect(input.isActionHeld("Jump")).toBe(true);

    key("keyup", "Space");
    input.advanceTick();
    expect(input.isActionReleasedInTick("Jump")).toBe(true);
    input.advanceTick();
    expect(input.isActionReleasedInTick("Jump")).toBe(false);
    input.dispose();
  });

  it("toque mais curto que um tick gera pressed E released no mesmo tick", () => {
    const input = new InputManager();
    input.advanceTick();
    key("keydown", "KeyE");
    key("keyup", "KeyE");
    input.advanceTick();
    expect(input.isActionPressedInTick("Interact")).toBe(true);
    expect(input.isActionReleasedInTick("Interact")).toBe(true);
    expect(input.isActionHeld("Interact")).toBe(false);
    input.dispose();
  });

  it("delta do mouse no tick soma todos os frames desde o tick anterior (G52)", () => {
    const input = new InputManager();
    input.advanceTick();
    move(3, 1);
    input.update();
    move(4, -2);
    input.update();
    expect(input.getMouseDelta().x).toBe(4);
    input.advanceTick();
    expect(input.getTickMouseDelta().x).toBe(7);
    expect(input.getTickMouseDelta().y).toBe(-1);
    input.advanceTick();
    expect(input.getTickMouseDelta().x).toBe(0);
    input.dispose();
  });

  it("no Kernel: o plugin sincroniza com game.loop.tick e descarta bordas durante a pausa", async () => {
    const frames: FrameRequestCallback[] = [];
    const scheduler: InputFrameScheduler = {
      requestFrame(callback): number {
        frames.push(callback);
        return frames.length;
      },
      cancelFrame(): void {},
    };
    let input: InputApi | undefined;
    let ctxRef: PluginContext | undefined;
    const tickPayload = { deltaSeconds: 0.05, totalTimeSeconds: 0, tickCount: 0 };
    const renderPayload = { alphaInterpolation: 0, deltaSeconds: 0, realDeltaSeconds: 0.016, isPaused: true };
    const pressedSeen: boolean[] = [];

    const fakeLoop: Plugin = {
      manifest: {
        id: "test.fake-loop",
        name: "fake loop",
        version: "1.0.0",
        kind: "preloaded",
        permissions: { capabilities: [InputToken.id], events: [GameTickEvent.type, GameRenderEvent.type] },
        capabilities: {
          provides: [],
          consumes: [{ id: InputToken.id, range: "^1.0.0", optional: false }],
          conflicts: [],
        },
        lifecycleHooks: {
          onBoot(ctx): void {
            input = ctx.caps.require(InputToken);
          },
        },
      },
      setup(ctx): void {
        ctxRef = ctx;
        ctx.events.define(GameTickEvent);
        ctx.events.define(GameRenderEvent);
        // handler do "jogo" registrado ANTES do input: lê no mesmo tick.
        ctx.events.on(GameTickEvent.type, (): void => {
          pressedSeen.push(input?.isActionPressedInTick("Jump") === true);
        });
        ctx.lifecycle.ready();
      },
    };

    const kernel = new Kernel();
    kernel.register(fakeLoop);
    kernel.register(createInputPlugin({ frameScheduler: scheduler }));
    await kernel.boot();
    try {
    const api = input!;
    const ctx = ctxRef!;

    // G49: update() pelo jogo é ignorado (não apaga bordas do pump).
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    key("keydown", "Space");
    api.update();
    frames.shift()!(16);
    expect(api.isActionPressed("Jump")).toBe(true);
    api.update();
    expect(api.isActionPressed("Jump")).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);

    // 1º tick (ainda sem sincronia): o jogo lê a borda do frame; ela não se repete.
    await ctx.events.emitAsync(GameTickEvent.type, tickPayload);
    await ctx.events.emitAsync(GameTickEvent.type, tickPayload);
    expect(pressedSeen).toEqual([true, false]);
    // Ordem desfavorável (jogo antes do input): borda vista uma única vez, 1 tick depois.
    key("keyup", "Space");
    key("keydown", "Space");
    await ctx.events.emitAsync(GameTickEvent.type, tickPayload);
    expect(pressedSeen).toEqual([true, false, false]);
    expect(api.isTickSynchronized).toBe(true);

    // Pausa: pressão durante a pausa não vaza para o primeiro tick após retomar.
    key("keyup", "Space");
    key("keydown", "Space");
    await ctx.events.emitAsync(GameRenderEvent.type, renderPayload);
    await ctx.events.emitAsync(GameTickEvent.type, tickPayload);
    await ctx.events.emitAsync(GameTickEvent.type, tickPayload);
    expect(pressedSeen.slice(3)).toEqual([true, false]);

    // fora da pausa a borda volta a valer para o tick
    key("keyup", "Space");
    key("keydown", "Space");
    await ctx.events.emitAsync(GameTickEvent.type, tickPayload);
    await ctx.events.emitAsync(GameTickEvent.type, tickPayload);
    expect(pressedSeen.slice(5)).toEqual([false, true]);
    } finally {
      await kernel.stop();
    }
  });
});

describe("G49 — update() manual", () => {
  it("InputManager sem pump continua avançando por update() (testes/headless)", () => {
    const input = new InputManager();
    key("keydown", "Space");
    input.update();
    expect(input.isActionPressed("Jump")).toBe(true);
    input.update();
    expect(input.isActionPressed("Jump")).toBe(false);
    input.dispose();
  });
});

describe("G50 — eventos de ação", () => {
  it("toque mais curto que 1 frame emite pressed e released; held pode ser desligado", () => {
    const sink = collectingSink();
    const input = new InputManager(sink);
    key("keydown", "Space");
    key("keyup", "Space");
    input.update();
    expect(sink.actions.map((a) => a.state)).toEqual(["pressed", "released"]);

    sink.actions.length = 0;
    input.setActionEventOptions({ emitHeld: false });
    key("keydown", "Space");
    input.update();
    input.update();
    input.update();
    key("keyup", "Space");
    input.update();
    expect(sink.actions.map((a) => a.state)).toEqual(["pressed", "released"]);
    input.dispose();
  });
});

describe("G51 — foco, alvos de UI e preventDefault", () => {
  it("ignora teclas digitadas em campos e cliques em botões/[data-input-ignore]", () => {
    const input = new InputManager();
    const field = document.createElement("input");
    const button = document.createElement("button");
    const panel = document.createElement("div");
    panel.setAttribute("data-input-ignore", "");
    const inner = document.createElement("span");
    panel.appendChild(inner);
    document.body.append(field, button, panel);

    key("keydown", "Space", field);
    mouse("mousedown", 0, button);
    mouse("mousedown", 0, inner);
    input.update();
    expect(input.isActionPressed("Jump")).toBe(false);
    expect(input.isActionPressed("Attack")).toBe(false);

    mouse("mousedown", 0, document.body);
    input.update();
    expect(input.isActionPressed("Attack")).toBe(true);

    input.setFilterOptions({ ignoreEditableTargets: false });
    key("keydown", "KeyE", field);
    input.update();
    expect(input.isActionPressed("Interact")).toBe(true);
    input.dispose();
  });

  it("preventDefault só para teclas mapeadas e sem modificadores", () => {
    const input = new InputManager();
    expect(key("keydown", "Space").defaultPrevented).toBe(true);
    expect(key("keydown", "KeyQ").defaultPrevented).toBe(false);
    const ctrlW = new KeyboardEvent("keydown", { code: "KeyW", ctrlKey: true, cancelable: true });
    window.dispatchEvent(ctrlW);
    expect(ctrlW.defaultPrevented).toBe(false);
    input.setFilterOptions({ preventDefaultForBoundKeys: false });
    expect(key("keydown", "KeyD").defaultPrevented).toBe(false);
    input.dispose();
  });
});

describe("G53 — gamepads, analógicos, gatilhos, d-pad, zona morta, pointer lock", () => {
  it("vários gamepads, analógico direito, gatilhos analógicos e bindings por controle", () => {
    const sink = collectingSink();
    const input = new InputManager(sink);
    input.setBindingMap({
      actions: { Fire: ["GamepadButton7"], P2Jump: ["Gamepad1Button0"] },
      axes: {
        Look: { positive: "GamepadAxis2+", negative: "GamepadAxis2-" },
        P2Move: { positive: "Gamepad1Axis0+", negative: "Gamepad1Axis0-" },
      },
    });

    const buttons = new Array<boolean | number>(17).fill(false);
    const trigger = [...buttons];
    trigger[7] = 0.3;
    gamepads = [pad(0, trigger, [0, 0, 0.8, 0]), pad(1, [true], [-0.6, 0, 0, 0])];
    input.update();

    expect(input.getConnectedGamepads().map((g) => g.index)).toEqual([0, 1]);
    expect(sink.pads.map((p) => p.connected)).toEqual([true, true]);
    expect(input.getGamepadButtonValue(7)).toBeCloseTo(0.3, 5);
    expect(input.getActionValue("Fire")).toBeCloseTo(0.3, 5);
    expect(input.isActionHeld("Fire")).toBe(false); // abaixo do limiar digital
    expect(input.getAxis("Look")).toBeCloseTo((0.8 - 0.15) / 0.85, 5);
    expect(input.getGamepadAxis(2, 0)).toBeCloseTo((0.8 - 0.15) / 0.85, 5);
    expect(input.getGamepadAxis(2, 1)).toBe(0);
    expect(input.isActionPressed("P2Jump")).toBe(true);
    expect(input.getAxis("P2Move")).toBeCloseTo(-(0.6 - 0.15) / 0.85, 5);

    trigger[7] = 0.9;
    gamepads = [pad(0, trigger, [0, 0, 0, 0]), null];
    input.update();
    expect(input.isActionPressed("Fire")).toBe(true);
    const firePressed = sink.actions.find((a) => a.action === "Fire" && a.state === "pressed");
    expect(firePressed?.value).toBeCloseTo(0.9, 5);
    expect(sink.pads.at(-1)).toEqual({ index: 1, id: "Pad 1", connected: false });
    input.dispose();
  });

  it("d-pad e meio-eixos movem os eixos padrão; zona morta configurável", () => {
    const input = new InputManager();
    const buttons = new Array<boolean>(17).fill(false);
    buttons[12] = true; // d-pad cima
    buttons[15] = true; // d-pad direita
    gamepads = [pad(0, buttons, [0, 0, 0, 0])];
    input.update();
    expect(input.getAxis("MoveForward")).toBe(1);
    expect(input.getAxis("MoveRight")).toBe(1);

    gamepads = [pad(0, new Array<boolean>(17).fill(false), [0.2, -0.5, 0.1, -0.9])];
    input.update();
    expect(input.getAxis("MoveRight")).toBeCloseTo((0.2 - 0.15) / 0.85, 5);
    expect(input.getAxis("MoveForward")).toBeCloseTo((0.5 - 0.15) / 0.85, 5);
    expect(input.getAxis("LookUp")).toBeCloseTo((0.9 - 0.15) / 0.85, 5);

    expect(input.setGamepadDeadZone(0.25)).toBe(true);
    expect(input.gamepadDeadZone).toBe(0.25);
    expect(input.getAxis("MoveRight")).toBe(0);
    expect(input.setGamepadDeadZone(1)).toBe(false);
    expect(input.setGamepadDeadZone(Number.NaN)).toBe(false);

    // mapas antigos sem *Alt mantêm o analógico esquerdo em MoveForward/MoveRight
    input.setBindingMap({
      actions: {},
      axes: { MoveForward: { positive: "KeyW", negative: "KeyS" } },
    });
    expect(input.getAxis("MoveForward")).toBeCloseTo((0.5 - 0.25) / 0.75, 5);
    input.dispose();
  });

  it("meio-eixo como ação tem bordas pressed/released", () => {
    const input = new InputManager();
    input.setBindingMap({ actions: { MenuDown: ["GamepadAxis1+"] }, axes: {} });
    input.advanceTick();
    gamepads = [pad(0, [], [0, 0.9])];
    input.update();
    expect(input.isActionPressed("MenuDown")).toBe(true);
    input.update();
    expect(input.isActionPressed("MenuDown")).toBe(false);
    expect(input.isActionHeld("MenuDown")).toBe(true);
    gamepads = [pad(0, [], [0, 0])];
    input.update();
    expect(input.isActionReleased("MenuDown")).toBe(true);
    input.advanceTick();
    expect(input.isActionPressedInTick("MenuDown")).toBe(true);
    expect(input.isActionReleasedInTick("MenuDown")).toBe(true);
    input.dispose();
  });

  it("emite perda de pointer lock (lost) diferente de liberação pedida (released) e solta botões", () => {
    const sink = collectingSink();
    const input = new InputManager(sink);
    let locked: Element | null = null;
    Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => locked });
    Object.defineProperty(document, "exitPointerLock", {
      configurable: true,
      value: (): void => {
        locked = null;
        document.dispatchEvent(new Event("pointerlockchange"));
      },
    });

    locked = document.body;
    document.dispatchEvent(new Event("pointerlockchange"));
    mouse("mousedown", 0);
    input.update();
    expect(input.isActionHeld("Attack")).toBe(true);

    locked = null; // ESC do navegador
    document.dispatchEvent(new Event("pointerlockchange"));
    input.update();
    expect(input.isActionHeld("Attack")).toBe(false);

    locked = document.body;
    document.dispatchEvent(new Event("pointerlockchange"));
    input.exitPointerLock();
    document.dispatchEvent(new Event("pointerlockerror"));

    expect(sink.locks.map((l) => `${String(l.locked)}:${l.reason}`)).toEqual([
      "true:acquired",
      "false:lost",
      "true:acquired",
      "false:released",
      "false:error",
    ]);
    input.dispose();
    Reflect.deleteProperty(document, "pointerLockElement");
    Reflect.deleteProperty(document, "exitPointerLock");
  });

  it("toque vira binding Touch, posições e device touch", () => {
    const input = new InputManager();
    input.setBindingMap({ actions: { Tap: ["Touch"] }, axes: {} });
    const touch = { identifier: 7, clientX: 10, clientY: 20 };
    const touchStart = new Event("touchstart") as Event & { touches: unknown };
    Object.defineProperty(touchStart, "touches", {
      value: { length: 1, item: (i: number) => (i === 0 ? touch : null) },
    });
    window.dispatchEvent(touchStart);
    input.update();
    expect(input.isActionPressed("Tap")).toBe(true);
    expect(input.getTouchCount()).toBe(1);
    expect(input.getTouchPosition(0)).toMatchObject({ x: 10, y: 20 });
    expect(input.activeDevice).toBe("touch");

    const touchEnd = new Event("touchend");
    Object.defineProperty(touchEnd, "touches", { value: { length: 0, item: () => null } });
    window.dispatchEvent(touchEnd);
    input.update();
    expect(input.isActionReleased("Tap")).toBe(true);
    expect(input.getTouchCount()).toBe(0);
    input.dispose();
  });

  it("dispose remove todos os listeners de window/document", () => {
    const addWindow = vi.spyOn(window, "addEventListener");
    const removeWindow = vi.spyOn(window, "removeEventListener");
    const addDocument = vi.spyOn(document, "addEventListener");
    const removeDocument = vi.spyOn(document, "removeEventListener");
    const input = new InputManager();
    input.dispose();
    expect(removeWindow.mock.calls.length).toBe(addWindow.mock.calls.length);
    expect(removeDocument.mock.calls.length).toBe(addDocument.mock.calls.length);
  });
});
