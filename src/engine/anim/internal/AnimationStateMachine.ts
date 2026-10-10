import {
  AnimationState,
} from "./AnimationState";

import type {
  AnimationLoopMode,
  AnimationParamValue,
  AnimationTransition,
} from "../../../contracts/anim/types";

/**
 * Cursor "antes do início": permite que triggers em 0,0 disparem na
 * entrada do estado (a janela de cruzamento é aberta à esquerda).
 */
export const BEFORE_START_CYCLES =
  -1e-9;

/** Limite de cruzamentos por trigger/tick (clips curtíssimos). */
const MAX_CROSSINGS_PER_UPDATE =
  16;

export interface AnimationStateMachineUpdateResult {
  currentState:
    string | null;

  targetState:
    string | null;

  weight: number;

  normalizedTime: number;

  crossFadeDurationSeconds:
    number;

  /**
   * Janela (em ciclos, não normalizada) percorrida pelo estado atual neste
   * update: (windowStartCycles, windowEndCycles]. Usada para triggers e
   * eventos de fim de clip, sem perder 0,0/1,0 nem ciclos repetidos.
   */
  windowStartCycles: number;

  windowEndCycles: number;

  /**
   * Estado que DEIXOU de ser o atual neste update (transição imediata ou
   * fim de crossfade), com a última janela percorrida por ele — para que
   * seus triggers/fim de clip não se percam. null se não houve troca.
   */
  exitedState: string | null;

  exitedWindowStartCycles: number;

  exitedWindowEndCycles: number;
}

/**
 * Quantas vezes o ponto normalizado `t` foi cruzado na janela (a, b] de
 * ciclos, considerando o modo de loop. Puro, sem alocação.
 */
export function countCrossings(
  t: number,
  a: number,
  b: number,
  loopMode: AnimationLoopMode,
): number {
  if (
    !Number.isFinite(t) ||
    !(b > a)
  ) {
    return 0;
  }

  const point =
    Math.min(
      1,
      Math.max(
        0,
        t,
      ),
    );

  if (
    loopMode ===
    "LoopOnce"
  ) {
    return point > a &&
      point <= b
      ? 1
      : 0;
  }

  let count =
    0;

  if (
    loopMode ===
    "LoopPingPong"
  ) {
    // Fase p em [0, 2): posição = p <= 1 ? p : 2 - p.
    // Cruzamentos em 2k + t (ida) e 2k + 2 - t (volta).
    let k =
      Math.max(
        0,
        Math.floor(
          (a - point) /
            2,
        ),
      );

    while (
      count <
      MAX_CROSSINGS_PER_UPDATE
    ) {
      const forward =
        2 * k +
        point;

      if (forward > b) {
        break;
      }

      if (forward > a) {
        count += 1;
      }

      if (
        point > 0 &&
        point < 1
      ) {
        const backward =
          2 * k +
          2 -
          point;

        if (
          backward > a &&
          backward <= b
        ) {
          count += 1;
        }
      }

      k += 1;
    }

    return count;
  }

  // LoopRepeat: cruzamentos em k + t, k >= 0.
  let k =
    Math.max(
      0,
      Math.floor(
        a - point,
      ) +
        1,
    );

  while (
    count <
      MAX_CROSSINGS_PER_UPDATE &&
    k + point <= b
  ) {
    if (k + point > a) {
      count += 1;
    }

    k += 1;
  }

  return count;
}

interface PendingTransition {
  readonly transition:
    AnimationTransition;
}

export class AnimationStateMachine {
  private readonly states =
    new Map<
      string,
      AnimationState
    >();

  private readonly transitions:
    AnimationTransition[] = [];

  /**
   * Transições registradas antes dos estados (G76): ficam aqui até os
   * estados existirem.
   */
  private readonly pendingTransitions:
    PendingTransition[] = [];

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

  private targetStateElapsedSeconds =
    0;

  /** Posição (ciclos) até onde triggers/exit-time já foram avaliados. */
  private cursorCycles =
    BEFORE_START_CYCLES;

  private isCrossFading =
    false;

  private crossFadeDuration =
    0;

  private crossFadeProgress =
    0;

  /** O estado atual foi escolhido automaticamente e o clip ainda não tocou. */
  private visualStartPending =
    false;

  /** O jogo já pediu um estado explicitamente (playAnimation/crossFade). */
  private explicitlyStarted =
    false;

  private enteredDuringUpdate =
    false;

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

      windowStartCycles:
        BEFORE_START_CYCLES,

      windowEndCycles:
        0,

      exitedState:
        null,

      exitedWindowStartCycles:
        0,

      exitedWindowEndCycles:
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

    const existing =
      this.states.get(
        state.name,
      );

    this.states.set(
      state.name,
      state,
    );

    /*
     * Estado inicial: o primeiro estado registrado. Um estado explícito
     * (registerState) substitui um estado automático (criado por clip do
     * register3DSkeleton) que ainda não foi pedido pelo jogo.
     */
    const current =
      this.getCurrentState();

    const replaceAutoInitial =
      !state.auto &&
      current !== null &&
      current.auto &&
      !this.explicitlyStarted &&
      this.targetStateName ===
        null;

    if (
      this.currentStateName ===
        null ||
      replaceAutoInitial
    ) {
      this.currentStateName =
        state.name;

      this.currentStateElapsedSeconds =
        0;

      this.cursorCycles =
        BEFORE_START_CYCLES;

      this.visualStartPending =
        true;
    } else if (
      existing !==
        undefined &&
      this.currentStateName ===
        state.name
    ) {
      // Re-registro do estado atual: o novo clip precisa tocar.
      this.visualStartPending =
        true;
    }

    this.resolvePendingTransitions();

    return true;
  }

  public hasState(
    stateName: string,
  ): boolean {
    return this.states.has(
      normalizeName(
        stateName,
      ),
    );
  }

  public getState(
    stateName: string,
  ): AnimationState | null {
    return (
      this.states.get(
        normalizeName(
          stateName,
        ),
      ) ??
      null
    );
  }

  public forEachState(
    visitor: (
      state: AnimationState,
    ) => void,
  ): void {
    for (
      const state of
      this.states.values()
    ) {
      visitor(
        state,
      );
    }
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

  /**
   * Registro estrito: falha se os estados não existem (comportamento
   * histórico da FSM). O serviço usa `addTransitionDeferred`.
   */
  public addTransition(
    transition:
      AnimationTransition,
  ): boolean {
    const normalized =
      normalizeTransition(
        transition,
      );

    if (
      !this.states.has(
        normalized.toState,
      )
    ) {
      return false;
    }

    if (
      normalized.fromState !==
        "*" &&
      !this.states.has(
        normalized.fromState,
      )
    ) {
      return false;
    }

    this.transitions.push(
      normalized,
    );

    return true;
  }

  /**
   * Registro independente de ordem (G76): se os estados ainda não existem,
   * a transição fica pendente e entra em vigor quando forem registrados.
   */
  public addTransitionDeferred(
    transition:
      AnimationTransition,
  ): boolean {
    const normalized =
      normalizeTransition(
        transition,
      );

    if (
      normalized.toState.length ===
        0 ||
      normalized.fromState.length ===
        0
    ) {
      return false;
    }

    if (
      this.addTransition(
        normalized,
      )
    ) {
      return true;
    }

    this.pendingTransitions.push({
      transition:
        normalized,
    });

    return true;
  }

  public getPendingTransitionCount():
    number {
    return this.pendingTransitions.length;
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

  public isInCrossFade():
    boolean {
    return this.isCrossFading;
  }

  public getCurrentElapsedSeconds():
    number {
    return this.currentStateElapsedSeconds;
  }

  /** Estado que está na tela (destino do crossfade, se houver). */
  public getVisualStateName():
    string | null {
    return (
      this.targetStateName ??
      this.currentStateName
    );
  }

  public getVisualElapsedSeconds():
    number {
    return this.targetStateName !==
      null
      ? this.targetStateElapsedSeconds
      : this.currentStateElapsedSeconds;
  }

  /** Ciclos decorridos do estado atual (LoopOnce limitado a 1). */
  public getCurrentCycles():
    number {
    const state =
      this.getCurrentState();

    if (!state) {
      return 0;
    }

    const cycles =
      this.currentStateElapsedSeconds /
      state.durationSeconds;

    if (
      state.loopMode ===
      "LoopOnce"
    ) {
      return Math.min(
        1,
        cycles,
      );
    }

    return cycles;
  }

  public isCurrentStateFinished():
    boolean {
    const state =
      this.getCurrentState();

    return (
      state !== null &&
      state.loopMode ===
        "LoopOnce" &&
      this.currentStateElapsedSeconds >=
        state.durationSeconds
    );
  }

  public getCurrentNormalizedTime():
    number {
    const state =
      this.getCurrentState();

    if (!state) {
      return 0;
    }

    return normalizedFromCycles(
      this.currentStateElapsedSeconds /
        state.durationSeconds,
      state.loopMode,
    );
  }

  /**
   * Consome o pedido de "tocar o clip do estado inicial" (G76). Retorna o
   * nome do estado a tocar, ou null.
   */
  public consumeVisualStart():
    string | null {
    if (
      !this.visualStartPending
    ) {
      return null;
    }

    this.visualStartPending =
      false;

    return this.getVisualStateName();
  }

  public hasVisualStartPending():
    boolean {
    return this.visualStartPending;
  }

  public setState(
    stateName: string,
  ): boolean {
    const name =
      normalizeName(
        stateName,
      );

    if (
      !this.states.has(
        name,
      )
    ) {
      return false;
    }

    this.enterState(
      name,
      0,
    );

    this.explicitlyStarted =
      true;

    return true;
  }

  /**
   * Reinicia o estado atual do começo (G74): tempo 0, triggers de novo.
   */
  public restartCurrentState():
    boolean {
    if (
      this.currentStateName ===
      null
    ) {
      return false;
    }

    this.enterState(
      this.currentStateName,
      0,
    );

    this.explicitlyStarted =
      true;

    return true;
  }

  public startCrossFade(
    toStateNameRaw: string,
    durationSeconds: number,
  ): boolean {
    const toStateName =
      normalizeName(
        toStateNameRaw,
      );

    if (
      !this.states.has(
        toStateName,
      )
    ) {
      return false;
    }

    this.explicitlyStarted =
      true;

    this.visualStartPending =
      false;

    if (
      this.currentStateName ===
      toStateName
    ) {
      this.targetStateName =
        null;

      this.targetStateElapsedSeconds =
        0;

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
      this.enterState(
        toStateName,
        0,
      );

      return true;
    }

    this.targetStateName =
      toStateName;

    this.targetStateElapsedSeconds =
      0;

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
        ? Math.min(
            0.25,
            Math.max(
              0,
              deltaSeconds,
            ),
          )
        : 0;

    const windowStart =
      this.cursorCycles;

    this.enteredDuringUpdate =
      false;

    this.advanceTime(
      safeDelta,
    );

    let windowEnd =
      this.getCurrentCycles();

    const stateBeforeTransitions =
      this.currentStateName;

    this.updateResult.exitedState =
      null;

    /*
     * Transições avaliadas DEPOIS de avançar o tempo, para que o tempo de
     * saída (exitTime) veja a janela percorrida neste tick. Uma transição
     * iniciada aqui já progride neste mesmo update.
     */
    if (
      !this.isCrossFading
    ) {
      this.evaluateTransitions(
        windowStart,
        windowEnd,
      );
    }

    // Uma transição com duração 0 trocou o estado agora: janela nova.
    if (
      this.enteredDuringUpdate
    ) {
      this.markExited(
        stateBeforeTransitions,
        windowStart,
        windowEnd,
      );

      this.cursorCycles =
        this.getCurrentCycles();

      return this.writeUpdateResult(
        1,
        BEFORE_START_CYCLES,
        this.cursorCycles,
      );
    }

    this.cursorCycles =
      windowEnd;

    if (
      this.isCrossFading &&
      this.targetStateName
    ) {
      // Um fade iniciado neste update ainda não avançou o destino.
      if (
        this.crossFadeProgress ===
        0
      ) {
        this.targetStateElapsedSeconds +=
          safeDelta *
          this.getTimeScale(
            this.targetStateName,
          );
      }

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
        const carried =
          this.targetStateElapsedSeconds;

        this.markExited(
          this.currentStateName,
          windowStart,
          windowEnd,
        );

        this.enterState(
          this.targetStateName,
          carried,
        );

        windowEnd =
          this.getCurrentCycles();

        this.cursorCycles =
          windowEnd;

        return this.writeUpdateResult(
          1,
          BEFORE_START_CYCLES,
          windowEnd,
        );
      }

      return this.writeUpdateResult(
        weight,
        windowStart,
        windowEnd,
      );
    }

    return this.writeUpdateResult(
      1,
      windowStart,
      windowEnd,
    );
  }

  private markExited(
    stateName: string | null,
    windowStart: number,
    windowEnd: number,
  ): void {
    this.updateResult.exitedState =
      stateName;

    this.updateResult.exitedWindowStartCycles =
      windowStart;

    this.updateResult.exitedWindowEndCycles =
      windowEnd;
  }

  private enterState(
    stateName: string,
    elapsedSeconds: number,
  ): void {
    this.currentStateName =
      stateName;

    this.targetStateName =
      null;

    this.currentStateElapsedSeconds =
      elapsedSeconds;

    this.targetStateElapsedSeconds =
      0;

    this.cursorCycles =
      BEFORE_START_CYCLES;

    this.isCrossFading =
      false;

    this.crossFadeDuration =
      0;

    this.crossFadeProgress =
      0;

    this.visualStartPending =
      false;

    this.enteredDuringUpdate =
      true;
  }

  private advanceTime(
    deltaSeconds: number,
  ): void {
    if (
      this.currentStateName !==
      null
    ) {
      this.currentStateElapsedSeconds +=
        deltaSeconds *
        this.getTimeScale(
          this.currentStateName,
        );
    }

    if (
      this.isCrossFading &&
      this.targetStateName !==
        null &&
      this.crossFadeProgress >
        0
    ) {
      this.targetStateElapsedSeconds +=
        deltaSeconds *
        this.getTimeScale(
          this.targetStateName,
        );
    }
  }

  private getTimeScale(
    stateName: string,
  ): number {
    const state =
      this.states.get(
        stateName,
      );

    if (!state) {
      return 0;
    }

    return Number.isFinite(
      state.timeScale,
    )
      ? Math.max(
          0,
          state.timeScale,
        )
      : 1;
  }

  private resolvePendingTransitions():
    void {
    for (
      let index =
        this.pendingTransitions.length -
        1;
      index >= 0;
      index -= 1
    ) {
      const pending =
        this.pendingTransitions[
          index
        ];

      if (
        pending &&
        this.addTransition(
          pending.transition,
        )
      ) {
        this.pendingTransitions.splice(
          index,
          1,
        );
      }
    }
  }

  private evaluateTransitions(
    windowStart: number,
    windowEnd: number,
  ): void {
    const currentState =
      this.getCurrentState();

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
          currentState.name &&
        transition.fromState !==
          "*"
      ) {
        continue;
      }

      if (
        transition.toState ===
        currentState.name
      ) {
        continue;
      }

      if (
        !this.checkExitTime(
          transition,
          currentState,
          windowStart,
          windowEnd,
        )
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

  private checkExitTime(
    transition:
      AnimationTransition,
    state: AnimationState,
    windowStart: number,
    windowEnd: number,
  ): boolean {
    const exitTime =
      resolveExitTime(
        transition,
      );

    if (
      exitTime ===
      null
    ) {
      return true;
    }

    if (
      state.loopMode ===
      "LoopOnce"
    ) {
      // Clip parado no fim continua elegível (a condição pode virar depois).
      return windowEnd >=
        Math.min(
          1,
          exitTime,
        );
    }

    if (
      exitTime >= 1
    ) {
      return windowEnd >=
        exitTime;
    }

    return (
      countCrossings(
        exitTime,
        windowStart,
        windowEnd,
        "LoopRepeat",
      ) >
      0
    );
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

  private writeUpdateResult(
    weight: number,
    windowStart: number,
    windowEnd: number,
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

    this.updateResult.windowStartCycles =
      windowStart;

    this.updateResult.windowEndCycles =
      windowEnd;

    return this.updateResult;
  }
}

function normalizeName(
  name: string,
): string {
  return typeof name ===
    "string"
    ? name.trim()
    : "";
}

function normalizeTransition(
  transition:
    AnimationTransition,
): AnimationTransition {
  const fromState =
    normalizeName(
      transition.fromState,
    );

  const toState =
    normalizeName(
      transition.toState,
    );

  if (
    fromState ===
      transition.fromState &&
    toState ===
      transition.toState
  ) {
    return transition;
  }

  return {
    ...transition,
    fromState,
    toState,
  };
}

function resolveExitTime(
  transition:
    AnimationTransition,
): number | null {
  if (
    transition.hasExitTime ===
    false
  ) {
    return null;
  }

  if (
    typeof transition.exitTime ===
      "number" &&
    Number.isFinite(
      transition.exitTime,
    ) &&
    transition.exitTime >=
      0
  ) {
    return transition.exitTime;
  }

  if (
    transition.hasExitTime ===
      true ||
    !transition.conditionParam
  ) {
    return 1;
  }

  return null;
}

export function normalizedFromCycles(
  cycles: number,
  loopMode:
    AnimationLoopMode,
): number {
  if (
    !Number.isFinite(
      cycles,
    )
  ) {
    return 0;
  }

  switch (
    loopMode
  ) {
    case "LoopOnce":
      return Math.min(
        1,
        Math.max(
          0,
          cycles,
        ),
      );

    case "LoopPingPong": {
      const wrapped =
        (
          (cycles % 2) +
          2
        ) %
        2;

      return wrapped <= 1
        ? wrapped
        : 2 - wrapped;
    }

    case "LoopRepeat":
    default:
      return (
        (cycles % 1) +
        1
      ) %
        1;
  }
}
