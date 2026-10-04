import type { Vector3Audio } from "../../../contracts/audio/types";
import { AudioMixer } from "./AudioMixer";

export class AudioListenerBridge {
  public constructor(private readonly mixer: AudioMixer) {}

  public updateListenerPosition(
    position: Vector3Audio,
    forward: Vector3Audio = { x: 0, y: 0, z: -1 },
    up: Vector3Audio = { x: 0, y: 1, z: 0 }
  ): void {
    const ctx = this.mixer.audioContext;
    const listener = ctx.listener;

    if (listener.positionX) {
      listener.positionX.setValueAtTime(position.x, ctx.currentTime);
      listener.positionY.setValueAtTime(position.y, ctx.currentTime);
      listener.positionZ.setValueAtTime(position.z, ctx.currentTime);

      listener.forwardX.setValueAtTime(forward.x, ctx.currentTime);
      listener.forwardY.setValueAtTime(forward.y, ctx.currentTime);
      listener.forwardZ.setValueAtTime(forward.z, ctx.currentTime);

      listener.upX.setValueAtTime(up.x, ctx.currentTime);
      listener.upY.setValueAtTime(up.y, ctx.currentTime);
      listener.upZ.setValueAtTime(up.z, ctx.currentTime);
    } else {
      listener.setPosition(position.x, position.y, position.z);
      listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }
}