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

  /**
   * Duração (s) de um ciclo do clip no relógio da FSM. Quando o clip real
   * existe (mixer 3D ou quadros 2D), o serviço sobrescreve com a duração do
   * clip para que FSM e mixer usem o mesmo relógio (G78).
   */
  public durationSeconds:
    number;

  /** true quando o jogo informou `durationSeconds` explicitamente. */
  public readonly durationExplicit:
    boolean;

  /** Estado criado automaticamente por `register3DSkeleton`. */
  public readonly auto:
    boolean;

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
    auto =
      false,
  ) {
    this.auto =
      auto;

    this.durationExplicit =
      Number.isFinite(
        durationSeconds,
      ) &&
      durationSeconds >
        0;

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

  /** Atualiza a duração (ignora valores inválidos). */
  public setDurationSeconds(
    seconds: number,
  ): void {
    if (
      Number.isFinite(
        seconds,
      ) &&
      seconds >
        0
    ) {
      this.durationSeconds =
        seconds;
    }
  }
}
