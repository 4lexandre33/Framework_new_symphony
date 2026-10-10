// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { Kernel, type Plugin, type PluginContext } from "@core";

import { AudioMixer } from "../src/engine/audio/internal/AudioMixer";
import { AudioService } from "../src/engine/audio/internal/AudioService";
import { createAudioPlugin } from "../src/plugins/audio/plugin";
import { createAssetsPlugin } from "../src/plugins/assets/plugin";
import { AudioToken, type AudioApi } from "../src/tokens/audio";
import type { AssetsApi } from "../src/tokens/assets";

class FakeParam {
  public value: number;
  public lastRampTarget: number | null = null;
  public lastRampTime: number | null = null;

  public constructor(value = 1) {
    this.value = value;
  }

  public setValueAtTime(value: number): void {
    this.value = value;
  }

  public linearRampToValueAtTime(value: number, time: number): void {
    this.value = value;
    this.lastRampTarget = value;
    this.lastRampTime = time;
  }

  public exponentialRampToValueAtTime(value: number, time: number): void {
    this.linearRampToValueAtTime(value, time);
  }

  public cancelScheduledValues(): void {}
}

class FakeNode {
  public connections: unknown[] = [];
  public disconnected = false;

  public connect(node: unknown): unknown {
    this.connections.push(node);
    return node;
  }

  public disconnect(): void {
    this.connections = [];
    this.disconnected = true;
  }
}

class FakeGain extends FakeNode {
  public gain = new FakeParam(1);
}

class FakePanner extends FakeNode {
  public panningModel = "equalpower";
  public distanceModel = "inverse";
  public refDistance = 1;
  public maxDistance = 10000;
  public rolloffFactor = 1;
  public coneInnerAngle = 360;
  public coneOuterAngle = 360;
  public coneOuterGain = 0;
  public positionX = new FakeParam(0);
  public positionY = new FakeParam(0);
  public positionZ = new FakeParam(0);
  public orientationX = new FakeParam(1);
  public orientationY = new FakeParam(0);
  public orientationZ = new FakeParam(0);
}

class FakeSource extends FakeNode {
  public buffer: unknown = null;
  public loop = false;
  public playbackRate = new FakeParam(1);
  public onended: (() => void) | null = null;
  public started = false;
  public stopCalls: Array<number | undefined> = [];

  public start(): void {
    this.started = true;
  }

  public stop(when?: number): void {
    this.stopCalls.push(when);
    const ended = this.onended;
    ended?.();
  }
}

class FakeContext {
  public currentTime = 10;
  public state: AudioContextState = "running";
  public destination = new FakeNode();
  public listener = {
    positionX: new FakeParam(0),
    positionY: new FakeParam(0),
    positionZ: new FakeParam(0),
    forwardX: new FakeParam(0),
    forwardY: new FakeParam(0),
    forwardZ: new FakeParam(-1),
    upX: new FakeParam(0),
    upY: new FakeParam(1),
    upZ: new FakeParam(0),
  };
  public sources: FakeSource[] = [];
  public panners: FakePanner[] = [];
  private stateListeners: Array<() => void> = [];

  public createGain(): FakeGain {
    return new FakeGain();
  }

  public createPanner(): FakePanner {
    const panner = new FakePanner();
    this.panners.push(panner);
    return panner;
  }

  public createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }

  public addEventListener(type: string, listener: () => void): void {
    if (type === "statechange") {
      this.stateListeners.push(listener);
    }
  }

  public removeEventListener(type: string, listener: () => void): void {
    this.stateListeners = this.stateListeners.filter((entry) => entry !== listener);
  }

  public async resume(): Promise<void> {
    this.state = "running";

    for (const listener of this.stateListeners) {
      listener();
    }
  }

  public async close(): Promise<void> {
    this.state = "closed";
  }
}

function fakeAssets(buffers: Record<string, unknown>): AssetsApi & {
  retains: string[];
  releases: string[];
} {
  const retains: string[] = [];
  const releases: string[] = [];

  return {
    retains,
    releases,
    getAsset: <T>(url: string): T | null => (buffers[url] as T | undefined) ?? null,
    retainAsset: (url: string): boolean => {
      retains.push(url);
      return url in buffers;
    },
    releaseAsset: (url: string): void => {
      releases.push(url);
    },
    loadAudio: async (url: string): Promise<AudioBuffer> => {
      if (!(url in buffers)) {
        throw new Error("404");
      }

      return buffers[url] as AudioBuffer;
    },
  } as unknown as AssetsApi & { retains: string[]; releases: string[] };
}

function setup(state: AudioContextState = "running"): {
  context: FakeContext;
  mixer: AudioMixer;
  service: AudioService;
  emitted: Array<[string, unknown]>;
  assets: ReturnType<typeof fakeAssets>;
} {
  const context = new FakeContext();
  context.state = state;
  const emitted: Array<[string, unknown]> = [];
  const assets = fakeAssets({ "boom.ogg": { id: "boom" }, "a.ogg": { id: "a" }, "b.ogg": { id: "b" } });
  const ctx = {
    events: {
      emit: (type: string, payload: unknown): void => {
        emitted.push([type, payload]);
      },
    },
    caps: { get: () => assets },
  } as unknown as PluginContext;
  const mixer = new AudioMixer(context as unknown as AudioContext);
  const service = new AudioService(ctx, mixer);
  return { context, mixer, service, emitted, assets };
}

afterEach((): void => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("G20 — handles de som", () => {
  it("play devolve handle; stop, volume, posição, orientação e pitch por handle", () => {
    const { context, service } = setup();
    const handle = service.playSound("boom.ogg", "sfx", 0.5, true);
    expect(handle).toBeGreaterThan(0);
    expect(service.isSoundPlaying(handle)).toBe(true);
    expect(service.activeVoiceCount).toBe(1);

    expect(service.setSoundVolume(handle, 0.2, 0.5)).toBe(true);
    expect(service.setSoundPlaybackRate(handle, 1.5)).toBe(true);
    expect(context.sources[0]?.playbackRate.value).toBe(1.5);

    expect(service.stopSound(handle)).toBe(true);
    expect(context.sources[0]?.stopCalls.length).toBe(1);
    expect(service.isSoundPlaying(handle)).toBe(false);
    expect(service.stopSound(handle)).toBe(false);

    const positional = service.playPositionalSound("boom.ogg", { position: { x: 1, y: 2, z: 3 }, loop: true });
    expect(positional).toBeGreaterThan(handle);
    expect(service.setSoundPosition(positional, { x: 5, y: 0, z: -2 })).toBe(true);
    expect(context.panners[0]?.positionX.value).toBe(5);
    expect(service.setSoundOrientation(positional, { x: 0, y: 0, z: -1 })).toBe(true);
    expect(context.panners[0]?.orientationZ.value).toBe(-1);
    expect(context.panners[0]?.orientationX.value).toBe(0);
    expect(service.setSoundPosition(handle, { x: 0, y: 0, z: 0 })).toBe(false);
  });

  it("stopSound com fade rampeia o ganho e agenda o stop", () => {
    const { context, service } = setup();
    const handle = service.playSound("boom.ogg");
    const source = context.sources[0]!;
    source.stop = function (this: FakeSource, when?: number): void {
      this.stopCalls.push(when);
    };
    expect(service.stopSound(handle, 0.5)).toBe(true);
    expect(source.stopCalls).toEqual([10.5]);
    expect(service.isSoundPlaying(handle)).toBe(false);
    source.onended?.();
    expect(service.activeVoiceCount).toBe(0);
  });
});

describe("G27 — canal de sons posicionais", () => {
  it("options.channel conecta a voz ao canal pedido", () => {
    const { mixer, service } = setup();
    const handle = service.playPositionalSound("boom.ogg", { position: { x: 0, y: 0, z: 0 }, channel: "voice" });
    expect(handle).toBeGreaterThan(0);
    const panner = (service as unknown as { voices: { get(id: number): { gainNode: FakeGain } } }).voices.get(handle);
    expect(panner.gainNode.connections[0]).toBe(mixer.getChannelGainNode("voice"));
    service.setChannelVolume("voice", 0, true);
    service.stopChannel("voice");
    expect(service.activeVoiceCount).toBe(0);
  });
});

describe("G84 — crossfade-completed no fim e setChannelVolume sem desmutar", () => {
  it("crossfadeMusic resolve e emite crossfade-completed só após a duração", async () => {
    vi.useFakeTimers();
    const { service, emitted } = setup();
    let resolved = false;
    const promise = service.crossfadeMusic("a.ogg", { durationSeconds: 2 }).then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(resolved).toBe(false);
    expect(emitted.some(([type]) => type === "game.audio.crossfade-completed")).toBe(false);
    await vi.advanceTimersByTimeAsync(1100);
    await promise;
    expect(resolved).toBe(true);
    expect(emitted.filter(([type]) => type === "game.audio.crossfade-completed")).toHaveLength(1);
  });

  it("crossfade substituído não emite completed", async () => {
    vi.useFakeTimers();
    const { service, emitted } = setup();
    const first = service.crossfadeMusic("a.ogg", { durationSeconds: 2 });
    await vi.advanceTimersByTimeAsync(10);
    const second = service.crossfadeMusic("b.ogg", { durationSeconds: 1 });
    await vi.advanceTimersByTimeAsync(3000);
    await Promise.all([first, second]);
    const completed = emitted.filter(([type]) => type === "game.audio.crossfade-completed");
    expect(completed.map(([, payload]) => (payload as { trackUrl: string }).trackUrl)).toEqual(["b.ogg"]);
  });

  it("setChannelVolume sem o 3º argumento mantém o mudo", () => {
    const { service, mixer } = setup();
    service.setChannelVolume("sfx", 0.4, true);
    service.setChannelVolume("sfx", 0.8);
    expect(service.isChannelMuted("sfx")).toBe(true);
    expect(service.getChannelVolume("sfx")).toBe(0.8);
    expect((mixer.getChannelGainNode("sfx") as unknown as FakeGain).gain.value).toBe(0);
    service.setChannelMuted("sfx", false);
    expect((mixer.getChannelGainNode("sfx") as unknown as FakeGain).gain.value).toBe(0.8);
  });
});

describe("G85 — parar música e faixa atual", () => {
  it("getCurrentMusicTrack, mesma faixa não reinicia, stopMusic com fade", async () => {
    const { service, context, emitted } = setup();
    await service.crossfadeMusic("a.ogg", { durationSeconds: 0 });
    expect(service.getCurrentMusicTrack()).toBe("a.ogg");
    const sourcesBefore = context.sources.length;
    await service.crossfadeMusic("a.ogg", { durationSeconds: 0 });
    expect(context.sources.length).toBe(sourcesBefore);
    await service.crossfadeMusic("a.ogg", { durationSeconds: 0, restart: true });
    expect(context.sources.length).toBe(sourcesBefore + 1);

    vi.useFakeTimers();
    const stopping = service.stopMusic(0.5);
    expect(service.getCurrentMusicTrack()).toBeNull();
    await vi.advanceTimersByTimeAsync(600);
    await stopping;
    expect(emitted.some(([type, payload]) => type === "game.audio.music-stopped" && (payload as { trackUrl: string }).trackUrl === "a.ogg")).toBe(true);
  });

  it("stopAllSounds(fade) faz fade em vez de corte seco", () => {
    const { service, context } = setup();
    service.playSound("boom.ogg", "sfx", 1, true);
    const source = context.sources[0]!;
    source.stop = function (this: FakeSource, when?: number): void {
      this.stopCalls.push(when);
    };
    service.stopAllSounds(1);
    expect(source.stopCalls).toEqual([11]);
  });
});

describe("G86 — sem Web Audio, gesto e limite de vozes", () => {
  it("o plugin sobe sem Web Audio (node) e fica mudo sem lançar", async () => {
    expect(typeof (globalThis as { AudioContext?: unknown }).AudioContext).toBe("undefined");
    let audio: AudioApi | undefined;
    const probe: Plugin = {
      manifest: {
        id: "test.audio-probe",
        name: "probe",
        version: "1.0.0",
        kind: "preloaded",
        permissions: { capabilities: [AudioToken.id] },
        capabilities: {
          provides: [],
          consumes: [{ id: AudioToken.id, range: "^1.0.0", optional: false }],
          conflicts: [],
        },
        lifecycleHooks: {
          onBoot(ctx): void {
            audio = ctx.caps.require(AudioToken);
          },
        },
      },
      setup(ctx): void {
        ctx.lifecycle.ready();
      },
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const kernel = new Kernel();
    kernel.register(createAssetsPlugin());
    kernel.register(createAudioPlugin());
    kernel.register(probe);
    await kernel.boot();
    const api = audio!;
    expect(api.state).toBe("unavailable");
    expect(api.playSound("x.ogg")).toBe(0);
    expect(api.playPositionalSound("x.ogg", { position: { x: 0, y: 0, z: 0 } })).toBe(0);
    api.setChannelVolume("bgm", 0.3);
    expect(api.getChannelVolume("bgm")).toBe(0.3);
    await api.crossfadeMusic("x.ogg");
    await api.stopMusic(1);
    expect(await api.resume()).toBe(false);
    api.updateListenerPosition({ x: 1, y: 2, z: 3 });
    api.stopAllSounds();
    await kernel.stop();
    expect(warn).toHaveBeenCalled();
  });

  it("limite de vozes rouba o one-shot mais antigo; HRTF limitado vira equalpower", () => {
    const { service, context } = setup();
    service.setVoiceLimit(2, 1);
    const first = service.playSound("boom.ogg");
    const second = service.playSound("boom.ogg");
    const third = service.playSound("boom.ogg");
    expect(third).toBeGreaterThan(0);
    expect(service.isSoundPlaying(first)).toBe(false);
    expect(service.isSoundPlaying(second)).toBe(true);
    expect(service.activeVoiceCount).toBe(2);

    service.stopAllSounds();
    service.playPositionalSound("boom.ogg", { position: { x: 0, y: 0, z: 0 } });
    service.playPositionalSound("boom.ogg", { position: { x: 0, y: 0, z: 0 } });
    expect(context.panners.map((panner) => panner.panningModel)).toEqual(["HRTF", "equalpower"]);
  });

  it("one-shots pedidos antes do gesto não tocam todos juntos depois", async () => {
    const { service, context } = setup("suspended");
    const now = vi.spyOn(performance, "now");
    now.mockReturnValue(1000);
    const stale = service.playSound("boom.ogg");
    const loop = service.playSound("boom.ogg", "sfx", 1, true);
    now.mockReturnValue(2000);
    const fresh = service.playSound("boom.ogg");
    expect(service.state).toBe("suspended");
    expect(await service.resume()).toBe(true);
    expect(context.state).toBe("running");
    expect(service.isSoundPlaying(stale)).toBe(false);
    expect(service.isSoundPlaying(fresh)).toBe(true);
    expect(service.isSoundPlaying(loop)).toBe(true);
  });
});

describe("G87 — inverse + maxDistance, cones e retenção da música", () => {
  it("inverse com maxDistance silencia fora do alcance e reage ao ouvinte", () => {
    const { service } = setup();
    const handle = service.playPositionalSound("boom.ogg", {
      position: { x: 50, y: 0, z: 0 },
      distanceModel: "inverse",
      maxDistance: 20,
      volume: 0.8,
      loop: true,
    });
    const voice = (service as unknown as { voices: { get(id: number): { gainNode: FakeGain } } }).voices.get(handle);
    expect(voice.gainNode.gain.value).toBe(0);
    service.updateListenerPosition({ x: 45, y: 0, z: 0 });
    expect(voice.gainNode.gain.value).toBeCloseTo(0.8, 5);
    service.updateListenerPosition({ x: 31, y: 0, z: 0 }); // d = 19 → 50% do fade final
    expect(voice.gainNode.gain.value).toBeCloseTo(0.4, 5);
    service.setSoundPosition(handle, { x: 100, y: 0, z: 0 });
    expect(voice.gainNode.gain.value).toBe(0);

    const clamp = service.playPositionalSound("boom.ogg", {
      position: { x: 500, y: 0, z: 0 },
      maxDistance: 20,
      maxDistanceMode: "clamp",
    });
    const clampVoice = (service as unknown as { voices: { get(id: number): { gainNode: FakeGain } } }).voices.get(clamp);
    expect(clampVoice.gainNode.gain.value).toBe(1);
  });

  it("cone aponta para orientation", () => {
    const { service, context } = setup();
    service.playPositionalSound("boom.ogg", {
      position: { x: 0, y: 0, z: 0 },
      orientation: { x: 0, y: 1, z: 0 },
      coneInnerAngle: 60,
      coneOuterAngle: 120,
    });
    expect(context.panners[0]?.orientationY.value).toBe(1);
    expect(context.panners[0]?.orientationX.value).toBe(0);
  });

  it("a faixa de música fica retida enquanto toca e é liberada ao trocar", async () => {
    const { service, assets } = setup();
    await service.crossfadeMusic("a.ogg", { durationSeconds: 0 });
    expect(assets.retains).toEqual(["a.ogg"]);
    expect(assets.releases).toEqual([]);
    await service.crossfadeMusic("b.ogg", { durationSeconds: 0 });
    expect(assets.releases).toEqual(["a.ogg"]);
    service.dispose();
    expect(assets.releases).toEqual(["a.ogg", "b.ogg"]);
  });
});
