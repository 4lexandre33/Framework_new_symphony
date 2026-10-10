import type {
  PositionalAudioOptions,
  Vector3Audio,
} from "../../../contracts/audio/types";

import {
  AudioMixer,
} from "./AudioMixer";

import type {
  AudioVoiceHandle,
} from "./AudioVoiceRegistry";

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(1, Math.max(0, value));
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

export interface PositionalPlayOverrides {
  /** Força o modelo de panning (limite de vozes HRTF). */
  readonly panningModel?: PanningModelType;
  /** Ganho inicial do nó de volume (volume × fator de alcance). */
  readonly initialGain?: number;
}

/**
 * Fonte posicional: source → panner → gain (volume) → canal
 * (`options.channel`, padrão `sfx`).
 */
export class PositionalAudio3D {
  public constructor(private readonly mixer: AudioMixer) {}

  public play(
    buffer: AudioBuffer,
    options: PositionalAudioOptions,
    overrides?: PositionalPlayOverrides,
  ): AudioVoiceHandle {
    const ctx = this.mixer.audioContext;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = options.loop ?? false;

    if (options.playbackRate !== undefined && source.playbackRate !== undefined) {
      source.playbackRate.value = Math.max(0.01, finiteOr(options.playbackRate, 1));
    }

    const panner = ctx.createPanner();
    panner.panningModel = overrides?.panningModel ?? options.panningModel ?? "HRTF";
    panner.distanceModel = options.distanceModel ?? "inverse";
    panner.refDistance = Math.max(0.0001, finiteOr(options.refDistance, 1));
    panner.maxDistance = Math.max(panner.refDistance, finiteOr(options.maxDistance, 10000));
    panner.rolloffFactor = Math.max(0, finiteOr(options.rolloffFactor, 1));
    panner.coneInnerAngle = Math.max(0, finiteOr(options.coneInnerAngle, 360));
    panner.coneOuterAngle = Math.max(0, finiteOr(options.coneOuterAngle, 360));
    panner.coneOuterGain = clampVolume(finiteOr(options.coneOuterGain, 0));
    this.setPosition(panner, options.position);

    if (options.orientation !== undefined) {
      this.setOrientation(panner, options.orientation);
    }

    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(
      overrides?.initialGain ?? clampVolume(options.volume ?? 1),
      ctx.currentTime,
    );

    const channelGain = this.mixer.getChannelGainNode(options.channel ?? "sfx");
    source.connect(panner);
    panner.connect(gainNode);
    gainNode.connect(channelGain);
    source.start(0);

    return {
      source,
      pannerNode: panner,
      gainNode,
    };
  }

  public setPosition(panner: PannerNode, pos: Vector3Audio): void {
    const ctx = this.mixer.audioContext;
    const x = Number.isFinite(pos.x) ? pos.x : 0;
    const y = Number.isFinite(pos.y) ? pos.y : 0;
    const z = Number.isFinite(pos.z) ? pos.z : 0;

    if (panner.positionX) {
      panner.positionX.setValueAtTime(x, ctx.currentTime);
      panner.positionY.setValueAtTime(y, ctx.currentTime);
      panner.positionZ.setValueAtTime(z, ctx.currentTime);
      return;
    }

    panner.setPosition(x, y, z);
  }

  /**
   * Direção para onde o cone aponta (G87: antes ficava sempre +X).
   * Vetores nulos/inválidos são ignorados.
   */
  public setOrientation(panner: PannerNode, dir: Vector3Audio): void {
    const x = Number.isFinite(dir.x) ? dir.x : 0;
    const y = Number.isFinite(dir.y) ? dir.y : 0;
    const z = Number.isFinite(dir.z) ? dir.z : 0;

    if (x === 0 && y === 0 && z === 0) {
      return;
    }

    const ctx = this.mixer.audioContext;

    if (panner.orientationX) {
      panner.orientationX.setValueAtTime(x, ctx.currentTime);
      panner.orientationY.setValueAtTime(y, ctx.currentTime);
      panner.orientationZ.setValueAtTime(z, ctx.currentTime);
      return;
    }

    if (typeof panner.setOrientation === "function") {
      panner.setOrientation(x, y, z);
    }
  }
}
