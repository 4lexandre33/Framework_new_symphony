import type {
  AnimationLoopMode,
  AnimationEventTrigger,
} from "../../../contracts/anim/types";

function positiveFiniteOr(
  value:
    number,
  fallback:
    number,
): number {
  return (
    Number.isFinite(
      value,
    ) &&
    value >
      0
  )
    ? value
    : fallback;
}

function nonNegativeFiniteOr(
  value:
    number,
  fallback:
    number,
): number {
  return (
    Number.isFinite(
      value,
    ) &&
    value >=
      0
  )
    ? value
    : fallback;
}

export class AnimationState {
  public readonly name:
    string;

  public readonly clipId:
    string;

  public readonly durationSeconds:
    number;

  public readonly timeScale:
    number;

  public readonly loopMode:
    AnimationLoopMode;

  public readonly triggers:
    ReadonlyArray<
      AnimationEventTrigger
    >;

  public constructor(
    name:
      string,
    clipId:
      string,
    durationSeconds =
      1,
    timeScale =
      1,
    loopMode:
      AnimationLoopMode =
        "LoopRepeat",
    triggers:
      ReadonlyArray<
        AnimationEventTrigger
      > =
        [],
  ) {
    this.name =
      name.trim();

    this.clipId =
      clipId.trim();

    this.durationSeconds =
      positiveFiniteOr(
        durationSeconds,
        1,
      );

    this.timeScale =
      nonNegativeFiniteOr(
        timeScale,
        1,
      );

    this.loopMode =
      loopMode;

    this.triggers =
      triggers;
  }
}
