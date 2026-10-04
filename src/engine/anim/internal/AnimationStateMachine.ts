import {
  AnimationState,
} from "./AnimationState";

import type {
  AnimationParamValue,
  AnimationTransition,
} from "../../../contracts/anim/types";

export interface AnimationStateMachineUpdateResult {
  currentState:
    string | null;

  targetState:
    string | null;

  weight: number;

  normalizedTime: number;

  crossFadeDurationSeconds:
    number;
}

export class AnimationStateMachine {
  private readonly states =
    new Map<
      string,
      AnimationState
    >();

  private readonly transitions:
    AnimationTransition[] = [];

  private readonly params =
    new Map<
      string,
      AnimationParamValue
    >();

  private currentStateName:
    string | null = null;

  private targetStateName:
    string | null = null;

  private currentStateElapsedSeconds =
    0;

  private isCrossFading =
    false;

  private crossFadeDuration =
    0;

  private crossFadeProgress =
    0;

  private readonly updateResult:
    AnimationStateMachineUpdateResult = {
      currentState:
        null,

      targetState:
        null,

      weight:
        1,

      normalizedTime:
        0,

      crossFadeDurationSeconds:
        0,
    };

  public addState(
    state: AnimationState,
  ): boolean {
    if (
      state.name.length ===
      0
    ) {
      return false;
    }

    const isFirstState =
      this.states.size ===
      0;

    this.states.set(
      state.name,
      state,
    );

    if (
      isFirstState ||
      this.currentStateName ===
        null
    ) {
      this.currentStateName =
        state.name;

      this.currentStateElapsedSeconds =
        0;
    }

    return true;
  }

  public hasState(
    stateName: string,
  ): boolean {
    return this.states.has(
      stateName,
    );
  }

  public getState(
    stateName: string,
  ): AnimationState | null {
    return (
      this.states.get(
        stateName,
      ) ??
      null
    );
  }

  public getCurrentState():
    AnimationState | null {
    if (
      this.currentStateName ===
      null
    ) {
      return null;
    }

    return (
      this.states.get(
        this.currentStateName,
      ) ??
      null
    );
  }

  public addTransition(
    transition:
      AnimationTransition,
  ): boolean {
    if (
      !this.states.has(
        transition.toState,
      )
    ) {
      return false;
    }

    if (
      transition.fromState !==
        "*" &&
      !this.states.has(
        transition.fromState,
      )
    ) {
      return false;
    }

    this.transitions.push(
      transition,
    );

    return true;
  }

  public setParam(
    paramName: string,
    value:
      AnimationParamValue,
  ): void {
    this.params.set(
      paramName,
      value,
    );
  }

  public getParam(
    paramName: string,
  ): AnimationParamValue | undefined {
    return this.params.get(
      paramName,
    );
  }

  public getCurrentStateName():
    string | null {
    return this.currentStateName;
  }

  public getTargetStateName():
    string | null {
    return this.targetStateName;
  }

  public getCurrentNormalizedTime():
    number {
    const state =
      this.getCurrentState();

    if (!state) {
      return 0;
    }

    const duration =
      state.durationSeconds;

    if (
      !Number.isFinite(
        duration,
      ) ||
      duration <= 0
    ) {
      return 0;
    }

    const rawNormalized =
      this.currentStateElapsedSeconds /
      duration;

    switch (
      state.loopMode
    ) {
      case "LoopOnce": {
        return Math.min(
          1,
          Math.max(
            0,
            rawNormalized,
          ),
        );
      }

      case "LoopPingPong": {
        const wrapped =
          this.positiveModulo(
            rawNormalized,
            2,
          );

        return wrapped <= 1
          ? wrapped
          : 2 - wrapped;
      }

      case "LoopRepeat":
      default: {
        return this.positiveModulo(
          rawNormalized,
          1,
        );
      }
    }
  }

  public setState(
    stateName: string,
  ): boolean {
    if (
      !this.states.has(
        stateName,
      )
    ) {
      return false;
    }

    this.currentStateName =
      stateName;

    this.targetStateName =
      null;

    this.currentStateElapsedSeconds =
      0;

    this.isCrossFading =
      false;

    this.crossFadeDuration =
      0;

    this.crossFadeProgress =
      0;

    return true;
  }

  public startCrossFade(
    toStateName: string,
    durationSeconds: number,
  ): boolean {
    if (
      !this.states.has(
        toStateName,
      )
    ) {
      return false;
    }

    if (
      this.currentStateName ===
      toStateName
    ) {
      this.targetStateName =
        null;

      this.isCrossFading =
        false;

      this.crossFadeDuration =
        0;

      this.crossFadeProgress =
        0;

      return true;
    }

    const safeDuration =
      Number.isFinite(
        durationSeconds,
      )
        ? Math.max(
            0,
            durationSeconds,
          )
        : 0;

    /*
     * CrossFade zero é uma troca imediata.
     */
    if (
      safeDuration ===
      0
    ) {
      this.currentStateName =
        toStateName;

      this.targetStateName =
        null;

      this.currentStateElapsedSeconds =
        0;

      this.isCrossFading =
        false;

      this.crossFadeDuration =
        0;

      this.crossFadeProgress =
        0;

      return true;
    }

    this.targetStateName =
      toStateName;

    this.crossFadeDuration =
      safeDuration;

    this.crossFadeProgress =
      0;

    this.isCrossFading =
      true;

    return true;
  }

  public update(
    deltaSeconds: number,
  ): Readonly<AnimationStateMachineUpdateResult> {
    const safeDelta =
      Number.isFinite(
        deltaSeconds,
      )
        ? Math.max(
            0,
            deltaSeconds,
          )
        : 0;

    /*
     * Primeiro avaliamos a FSM.
     *
     * Se uma condição iniciar uma transição neste tick,
     * ela já deve aparecer no resultado deste mesmo update.
     */
    if (
      !this.isCrossFading
    ) {
      this.evaluateTransitions();
    }

    this.advanceCurrentStateTime(
      safeDelta,
    );

    if (
      this.isCrossFading &&
      this.targetStateName
    ) {
      this.crossFadeProgress +=
        safeDelta;

      const weight =
        Math.min(
          1,
          this.crossFadeProgress /
            this.crossFadeDuration,
        );

      if (
        weight >= 1
      ) {
        this.currentStateName =
          this.targetStateName;

        this.targetStateName =
          null;

        this.currentStateElapsedSeconds =
          0;

        this.isCrossFading =
          false;

        this.crossFadeProgress =
          0;

        this.crossFadeDuration =
          0;

        return this.writeUpdateResult(
          1,
        );
      }

      return this.writeUpdateResult(
        weight,
      );
    }

    return this.writeUpdateResult(
      1,
    );
  }

  private evaluateTransitions():
    void {
    const currentState =
      this.currentStateName;

    if (!currentState) {
      return;
    }

    for (
      let index = 0;
      index <
      this.transitions.length;
      index += 1
    ) {
      const transition =
        this.transitions[
          index
        ];

      if (!transition) {
        continue;
      }

      if (
        transition.fromState !==
          currentState &&
        transition.fromState !==
          "*"
      ) {
        continue;
      }

      if (
        transition.toState ===
        currentState
      ) {
        continue;
      }

      if (
        !this.checkCondition(
          transition,
        )
      ) {
        continue;
      }

      if (
        this.startCrossFade(
          transition.toState,
          transition.durationSeconds,
        )
      ) {
        return;
      }
    }
  }

  private checkCondition(
    transition:
      AnimationTransition,
  ): boolean {
    if (
      !transition.conditionParam
    ) {
      return true;
    }

    const currentValue =
      this.params.get(
        transition.conditionParam,
      );

    if (
      currentValue ===
      undefined
    ) {
      return false;
    }

    const targetValue =
      transition.conditionValue;

    const operator =
      transition.conditionOperator ??
      "==";

    switch (operator) {
      case "==":
        return (
          currentValue ===
          targetValue
        );

      case "!=":
        return (
          currentValue !==
          targetValue
        );

      case ">":
        return (
          typeof currentValue ===
            "number" &&
          typeof targetValue ===
            "number" &&
          currentValue >
            targetValue
        );

      case "<":
        return (
          typeof currentValue ===
            "number" &&
          typeof targetValue ===
            "number" &&
          currentValue <
            targetValue
        );

      case ">=":
        return (
          typeof currentValue ===
            "number" &&
          typeof targetValue ===
            "number" &&
          currentValue >=
            targetValue
        );

      case "<=":
        return (
          typeof currentValue ===
            "number" &&
          typeof targetValue ===
            "number" &&
          currentValue <=
            targetValue
        );

      default:
        return false;
    }
  }

  private advanceCurrentStateTime(
    deltaSeconds: number,
  ): void {
    const state =
      this.getCurrentState();

    if (!state) {
      return;
    }

    const timeScale =
      Number.isFinite(
        state.timeScale,
      )
        ? Math.max(
            0,
            state.timeScale,
          )
        : 1;

    this.currentStateElapsedSeconds +=
      deltaSeconds *
      timeScale;
  }

  private writeUpdateResult(
    weight: number,
  ): Readonly<AnimationStateMachineUpdateResult> {
    this.updateResult.currentState =
      this.currentStateName;

    this.updateResult.targetState =
      this.targetStateName;

    this.updateResult.weight =
      weight;

    this.updateResult.normalizedTime =
      this.getCurrentNormalizedTime();

    this.updateResult.crossFadeDurationSeconds =
      this.isCrossFading
        ? this.crossFadeDuration
        : 0;

    return this.updateResult;
  }

  private positiveModulo(
    value: number,
    divisor: number,
  ): number {
    return (
      (
        value %
        divisor
      ) +
      divisor
    ) %
      divisor;
  }
}