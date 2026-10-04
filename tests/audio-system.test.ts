import { describe, it, expect, beforeEach, vi } from "vitest";
import { AudioMixer } from "../src/engine/audio/internal/AudioMixer";
import { PositionalAudio3D } from "../src/engine/audio/internal/PositionalAudio3D";
import { MusicCrossfader } from "../src/engine/audio/internal/MusicCrossfader";

// ── POLYFILL / MOCK DE WEB AUDIO API PARA AMBIENTE NODE.JS ────────────────
class MockAudioParam {
  public value = 1.0;
  public setValueAtTime(val: number): void {
    this.value = val;
  }
  public linearRampToValueAtTime(val: number): void {
    this.value = val;
  }
  public cancelScheduledValues(): void {}
}

class MockGainNode {
  public gain = new MockAudioParam();
  public connect(): void {}
  public disconnect(): void {}
}

class MockPannerNode {
  public panningModel = "equalpower";
  public distanceModel = "inverse";
  public refDistance = 1;
  public maxDistance = 10000;
  public rolloffFactor = 1;
  public coneInnerAngle = 360;
  public coneOuterAngle = 360;
  public coneOuterGain = 0;
  public positionX = new MockAudioParam();
  public positionY = new MockAudioParam();
  public positionZ = new MockAudioParam();
  public connect(): void {}
  public disconnect(): void {}
  public setPosition(): void {}
}

class MockAudioBufferSourceNode {
  public buffer: any = null;
  public loop = false;
  public onended: (() => void) | null = null;
  public connect(): void {}
  public disconnect(): void {}
  public start(): void {}
  public stop(): void {
    if (this.onended) this.onended();
  }
}

class MockAudioContext {
  public currentTime = 0;
  public state: AudioContextState = "running";
  public destination = {};
  public listener = {
    positionX: new MockAudioParam(),
    positionY: new MockAudioParam(),
    positionZ: new MockAudioParam(),
    forwardX: new MockAudioParam(),
    forwardY: new MockAudioParam(),
    forwardZ: new MockAudioParam(),
    upX: new MockAudioParam(),
    upY: new MockAudioParam(),
    upZ: new MockAudioParam(),
    setPosition(): void {},
    setOrientation(): void {},
  };

  public createGain(): any {
    return new MockGainNode();
  }
  public createPanner(): any {
    return new MockPannerNode();
  }
  public createBufferSource(): any {
    return new MockAudioBufferSourceNode();
  }
  public async resume(): Promise<void> {
    this.state = "running";
  }
  public async close(): Promise<void> {
    this.state = "closed";
  }
}

describe("Camada de Mixer de Áudio Espacial 3D (game.audio)", () => {
  let mockContext: MockAudioContext;
  let mixer: AudioMixer;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockContext = new MockAudioContext();
    mixer = new AudioMixer(mockContext as unknown as AudioContext);
  });

  it("deve gerenciar e ajustar volumes por canais independentes no AudioMixer", () => {
    expect(mixer.getChannelVolume("sfx")).toBe(1.0);
    expect(mixer.isChannelMuted("sfx")).toBe(false);

    mixer.setChannelVolume("sfx", 0.5, false);
    expect(mixer.getChannelVolume("sfx")).toBe(0.5);

    mixer.setChannelVolume("bgm", 0.2, true);
    expect(mixer.isChannelMuted("bgm")).toBe(true);

    mixer.dispose();
  });

  it("deve emitir som posicional 3D conectando panner, gain e canais", () => {
    const positional = new PositionalAudio3D(mixer);
    const mockBuffer = {} as AudioBuffer;

    const source = positional.play(mockBuffer, {
      position: { x: 10, y: 0, z: 5 },
      volume: 0.8,
      refDistance: 2,
    });

    expect(source).toBeDefined();
    mixer.dispose();
  });

  it("deve realizar crossfade suave entre duas faixas de BGM", async () => {
    const crossfader = new MusicCrossfader(mixer);
    const buffer1 = {} as AudioBuffer;
    const buffer2 = {} as AudioBuffer;

    await crossfader.crossfade(buffer1, "music_01.mp3", { durationSeconds: 0.1 });
    expect(crossfader.activeTrackUrl).toBe("music_01.mp3");

    await crossfader.crossfade(buffer2, "music_02.mp3", { durationSeconds: 0.1 });
    expect(crossfader.activeTrackUrl).toBe("music_02.mp3");

    crossfader.stop();
    mixer.dispose();
  });
});