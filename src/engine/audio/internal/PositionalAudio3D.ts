import type { PositionalAudioOptions, Vector3Audio } from "../../../contracts/audio/types";
import { AudioMixer } from "./AudioMixer";

export class PositionalAudio3D {
  public constructor(private readonly mixer: AudioMixer) {}

  public play(buffer: AudioBuffer, options: PositionalAudioOptions): AudioBufferSourceNode {
    this.mixer.resumeIfSuspended();
    const ctx = this.mixer.audioContext;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = options.loop || false;

    const panner = ctx.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = options.distanceModel || "inverse";
    panner.refDistance = options.refDistance ?? 1.0;
    panner.maxDistance = options.maxDistance ?? 10000.0;
    panner.rolloffFactor = options.rolloffFactor ?? 1.0;
    panner.coneInnerAngle = options.coneInnerAngle ?? 360;
    panner.coneOuterAngle = options.coneOuterAngle ?? 360;
    panner.coneOuterGain = options.coneOuterGain ?? 0;

    this.setPosition(panner, options.position);

    const gainNode = ctx.createGain();
    const vol = options.volume !== undefined ? options.volume : 1.0;
    gainNode.gain.setValueAtTime(vol, ctx.currentTime);

    const sfxChannelGain = this.mixer.getChannelGainNode("sfx");

    source.connect(panner);
    panner.connect(gainNode);
    gainNode.connect(sfxChannelGain);

    source.start(0);

    source.onended = () => {
      source.disconnect();
      panner.disconnect();
      gainNode.disconnect();
    };

    return source;
  }

  public setPosition(panner: PannerNode, pos: Vector3Audio): void {
    const ctx = this.mixer.audioContext;
    if (panner.positionX) {
      panner.positionX.setValueAtTime(pos.x, ctx.currentTime);
      panner.positionY.setValueAtTime(pos.y, ctx.currentTime);
      panner.positionZ.setValueAtTime(pos.z, ctx.currentTime);
    } else {
      panner.setPosition(pos.x, pos.y, pos.z);
    }
  }
}