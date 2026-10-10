// Harness de verificação em navegador real (Chromium via Playwright) para os
// itens de GAPS de input/audio/assets/ui que dependem do navegador:
// Web Audio (decodificação, política de autoplay/gesto), eventos DOM reais,
// CSS de ponteiro sobre o canvas e forma da Gamepad API.
// Empacotado por tests/browser/engine-gaps.mjs (esbuild) e injetado na página.

import type { PluginContext } from "@core";

import { AssetsManagerService } from "../../src/engine/assets/internal/AssetsManagerService";
import { AudioMixer } from "../../src/engine/audio/internal/AudioMixer";
import { AudioService } from "../../src/engine/audio/internal/AudioService";
import { InputManager } from "../../src/engine/input/internal/InputManager";
import { UIService } from "../../src/engine/ui/internal/UIService";
import type { AssetsApi } from "../../src/tokens/assets";

type Result = Record<string, unknown>;

interface HarnessState {
  assets: AssetsManagerService;
  audio: AudioService | null;
  input: InputManager | null;
  ui: UIService | null;
  emitted: Array<[string, unknown]>;
  handles: Record<string, number>;
}

const state: HarnessState = {
  assets: new AssetsManagerService(undefined, undefined, { fetch: fakeFetch }),
  audio: null,
  input: null,
  ui: null,
  emitted: [],
  handles: {},
};

/** WAV PCM 16-bit mono com um seno (gerado em memória, sem rede). */
function makeWav(seconds: number, sampleRate = 22050): Uint8Array {
  const samples = Math.floor(seconds * sampleRate);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples * 2, true);

  for (let index = 0; index < samples; index += 1) {
    view.setInt16(44 + index * 2, Math.round(Math.sin((index / sampleRate) * 2 * Math.PI * 440) * 8000), true);
  }

  return new Uint8Array(buffer);
}

let pngBytes: Uint8Array | null = null;

async function makePng(): Promise<Uint8Array> {
  if (pngBytes !== null) {
    return pngBytes;
  }

  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 4;
  const context = canvas.getContext("2d");
  context!.fillStyle = "#f00";
  context!.fillRect(0, 0, 8, 4);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
  pngBytes = new Uint8Array(await blob.arrayBuffer());
  return pngBytes;
}

/** fetch sem rede: stream em 4 chunks com content-length (progresso real). */
async function fakeFetch(url: string): Promise<Response> {
  let bytes: Uint8Array;
  let type = "application/octet-stream";

  if (url.endsWith(".wav")) {
    bytes = makeWav(url.includes("long") ? 2 : 0.25);
    type = "audio/wav";
  } else if (url.endsWith(".png")) {
    bytes = await makePng();
    type = "image/png";
  } else {
    return new Response("not found", { status: 404 });
  }

  const chunk = Math.ceil(bytes.byteLength / 4);
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller): void {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }

      controller.enqueue(bytes.slice(offset, offset + chunk));
      offset += chunk;
    },
  });

  return new Response(stream, {
    headers: { "content-length": String(bytes.byteLength), "content-type": type },
  });
}

function fakeCtx(assets: AssetsApi): PluginContext {
  return {
    events: {
      emit: (type: string, payload: unknown): void => {
        state.emitted.push([type, payload]);
      },
    },
    commands: {
      send: async (type: string, payload: unknown): Promise<void> => {
        state.emitted.push([`command:${type}`, payload]);
      },
    },
    caps: { get: () => assets },
  } as unknown as PluginContext;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const api = {
  /** G80/G82/G83: decodificação antes do gesto, progresso real, textura com colorSpace. */
  async assetsPhase(): Promise<Result> {
    const progress: Array<[number, number]> = [];
    const service = new AssetsManagerService(
      { onProgress: (_url, loaded, total) => progress.push([loaded, total]), onLoaded() {} },
      undefined,
      { fetch: fakeFetch, baseUrl: "http://game.local/" },
    );
    const started = performance.now();
    const buffer = await service.loadAudio("sfx/short.wav");
    const decodeMs = performance.now() - started;
    const texture = await service.loadTexture("img/red.png", { colorSpace: "linear" });
    const image = texture.image as { width?: number; height?: number } | undefined;
    const sameKey = service.normalizeUrl("./img/red.png") === service.normalizeUrl("/img/red.png");
    const manifestEvents: number[] = [];
    const manifestService = new AssetsManagerService(
      { onProgress() {}, onLoaded() {}, onManifestProgress: (p) => manifestEvents.push(p.progress) },
      undefined,
      { fetch: fakeFetch },
    );
    const result = await manifestService.preloadManifest({
      version: "1",
      assets: [
        { id: "music", url: "music/long.wav", type: "audio" },
        { id: "tex", url: "img/red.png", type: "texture" },
      ],
    }, { concurrency: 1 });
    const audioState = new AudioContext().state;
    service.dispose();
    manifestService.dispose();
    return {
      audioContextStateBeforeGesture: audioState,
      decodedDuration: buffer.duration,
      decodeMs: Math.round(decodeMs),
      textureSize: [image?.width, image?.height],
      textureColorSpace: texture.colorSpace,
      progressEvents: progress.length,
      progressPartial: progress.some(([loaded, total]) => total > 0 && loaded < total),
      sameKey,
      manifestLoaded: result.loaded,
      manifestProgress: manifestEvents.map((value) => Math.round(value * 100) / 100),
    };
  },

  /** Prepara áudio real + sons antes do gesto (política padrão). */
  async audioSetup(): Promise<Result> {
    await state.assets.loadAudio("sfx/short.wav");
    await state.assets.loadAudio("sfx/long.wav");
    const mixer = new AudioMixer();
    state.audio = new AudioService(fakeCtx(state.assets), mixer);
    return { state: state.audio.state };
  },

  playBeforeGesture(name: string, loop: boolean): number {
    const handle = state.audio!.playSound("sfx/long.wav", "sfx", 0.2, loop);
    state.handles[name] = handle;
    return handle;
  },

  audioStatus(): Result {
    const audio = state.audio!;
    const status: Result = { state: audio.state, voices: audio.activeVoiceCount };

    for (const [name, handle] of Object.entries(state.handles)) {
      status[name] = audio.isSoundPlaying(handle);
    }

    return status;
  },

  /** G20/G84/G85/G86/G87 com Web Audio real (contexto rodando). */
  async audioRunningChecks(): Promise<Result> {
    const audio = state.audio!;
    const positional = audio.playPositionalSound("sfx/long.wav", {
      position: { x: 100, y: 0, z: 0 },
      maxDistance: 20,
      loop: true,
      channel: "voice",
      orientation: { x: 0, y: 0, z: -1 },
    });
    const moved = audio.setSoundPosition(positional, { x: 5, y: 0, z: 0 });
    const volume = audio.setSoundVolume(positional, 0.5, 0.1);
    const stopped = audio.stopSound(positional, 0.05);
    audio.setChannelVolume("sfx", 0.5, true);
    audio.setChannelVolume("sfx", 0.7);
    const stillMuted = audio.isChannelMuted("sfx");
    audio.setChannelMuted("sfx", false);

    const t0 = performance.now();
    let completedAt = -1;
    const fade = audio.crossfadeMusic("sfx/long.wav", { durationSeconds: 0.4 }).then(() => {
      completedAt = performance.now() - t0;
    });
    await sleep(150);
    const earlyCompleted = state.emitted.some(([type]) => type === "game.audio.crossfade-completed");
    await fade;
    const track = audio.getCurrentMusicTrack();
    const sameTrackStart = performance.now();
    await audio.crossfadeMusic("sfx/long.wav", { durationSeconds: 0.4 });
    const sameTrackMs = performance.now() - sameTrackStart;
    await audio.stopMusic(0.1);

    audio.setVoiceLimit(3);
    const many: number[] = [];

    for (let index = 0; index < 6; index += 1) {
      many.push(audio.playSound("sfx/long.wav", "sfx", 0.05, false));
    }

    const voicesAfterLimit = audio.activeVoiceCount;
    audio.stopAllSounds(0.05);
    await sleep(150);

    return {
      positionalHandle: positional,
      moved,
      volume,
      stopped,
      stillMuted,
      earlyCompleted,
      completedAtMs: Math.round(completedAt),
      track,
      sameTrackMs: Math.round(sameTrackMs),
      currentAfterStop: audio.getCurrentMusicTrack(),
      voicesAfterLimit,
      handlesValid: many.every((handle) => handle > 0),
      voicesAfterStopAll: audio.activeVoiceCount,
      events: state.emitted.map(([type]) => type),
    };
  },

  /** G5/G51/G53/G99: monta canvas + UI real com o CSS da engine. */
  inputSetup(css: string): Result {
    const style = document.createElement("style");
    style.textContent = `${css}\nhtml,body{margin:0;width:100%;height:100%;}\ncanvas{position:absolute;inset:0;width:100%;height:100%;}`;
    document.head.appendChild(style);
    const canvas = document.createElement("canvas");
    canvas.id = "game-canvas";
    document.body.appendChild(canvas);
    state.ui = new UIService(fakeCtx(state.assets));
    state.input = new InputManager();
    state.input.advanceTick();
    const overlay = document.getElementById("hud-overlay")!;
    overlay.innerHTML =
      '<div class="hud-stat-badge" style="position:absolute;right:10px;top:10px;"><span data-bind="hp"></span></div><input id="chat" style="position:absolute;left:10px;bottom:10px;pointer-events:auto;">';
    state.ui.bindHUDData({ hp: 3 });
    const center = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    return {
      elementAtCenter: center === null ? null : center.id || center.tagName,
      gamepadsApi: typeof navigator.getGamepads,
      gamepadsShape: Array.from(navigator.getGamepads()).map((pad) => (pad === null ? null : pad.id)),
    };
  },

  inputFrame(): Result {
    const input = state.input!;
    input.update();
    return {
      attackPressed: input.isActionPressed("Attack"),
      jumpPressed: input.isActionPressed("Jump"),
      wheelY: input.getWheelDelta().y,
    };
  },

  inputTick(): Result {
    const input = state.input!;
    input.advanceTick();
    return {
      attackInTick: input.isActionPressedInTick("Attack"),
      jumpInTick: input.isActionPressedInTick("Jump"),
      tickWheelY: input.getTickWheelDelta().y,
      tickMouseX: input.getTickMouseDelta().x,
      gamepads: input.getConnectedGamepads().length,
    };
  },

  /** G11: HTML hostil não executa no navegador real. */
  async uiSafety(): Promise<Result> {
    const ui = state.ui!;
    (window as unknown as { __xss?: number }).__xss = 0;
    ui.pushModal({
      id: "hostile",
      title: "Chat",
      contentHtml:
        '<img src="nope.png" onerror="window.__xss=1"><svg onload="window.__xss=2"></svg><a href="javascript:window.__xss=3">x</a>',
    });
    (document.querySelector('[data-modal-id="hostile"] a') as HTMLAnchorElement | null)?.click();
    await sleep(300);
    const modalHasIgnore = document.querySelector('[data-modal-id="hostile"]')?.hasAttribute("data-input-ignore");
    ui.popModal("hostile");
    return { xss: (window as unknown as { __xss?: number }).__xss, modalHasIgnore };
  },
};

(window as unknown as { gaps: typeof api }).gaps = api;

/**
 * Fase B sem nenhum `page.evaluate` antes do gesto (o Playwright marca
 * evaluate como gesto do usuário, o que liberaria o autoplay).
 */
async function autorunGesturePhase(): Promise<void> {
  const report: Result = {};
  const ctor = new AudioContext();
  report.audioContextStateBeforeGesture = ctor.state;
  void ctor.close();
  const started = performance.now();
  const buffer = await state.assets.loadAudio("sfx/short.wav");
  report.decodedDuration = buffer.duration;
  report.decodeMs = Math.round(performance.now() - started);
  await api.audioSetup();
  report.stateBeforeGesture = state.audio!.state;
  api.playBeforeGesture("stale", false);
  api.playBeforeGesture("loop", true);
  // Som pedido DENTRO do gesto (como um jogo faria no clique). O listener do
  // mixer foi registrado antes, então já chamou resume() aqui.
  window.addEventListener(
    "pointerdown",
    (): void => {
      api.playBeforeGesture("fresh", false);
      report.stateDuringGesture = state.audio!.state;
    },
    { capture: true, once: true },
  );
  (window as unknown as { gestureReport: Result }).gestureReport = report;
}

if ((window as unknown as { __autorunGesture?: boolean }).__autorunGesture === true) {
  void autorunGesturePhase();
}
