import type {
  AnimationLoopMode,
  AnimationEventTrigger,
} from "../../contracts/anim/types";

export class AnimationState {
  public readonly name: string;
  public readonly clipId: string;
  public readonly durationSeconds: number;
  public readonly timeScale: number;
  public readonly loopMode: AnimationLoopMode;
  public readonly triggers: ReadonlyArray<AnimationEventTrigger>;

  public constructor(
    name: string,
    clipId: string,
    durationSeconds = 1.0,
    timeScale = 1.0,
    loopMode: AnimationLoopMode = "LoopRepeat",
    triggers: ReadonlyArray<AnimationEventTrigger> = []
  ) {
    this.name = name;
    this.clipId = clipId;
    this.durationSeconds = durationSeconds;
    this.timeScale = timeScale;
    this.loopMode = loopMode;
    this.triggers = triggers;
  }
}