export type GameFlowState =
  | "boot"
  | "main-menu"
  | "loading-game"
  | "playing"
  | "paused"
  | "saving"
  | "returning-to-menu"
  | "shutdown";

export type GameFlowEvent =
  | "boot-ready"
  | "start-game"
  | "load-succeeded"
  | "load-failed"
  | "pause"
  | "resume"
  | "save-requested"
  | "save-succeeded"
  | "save-failed"
  | "return-to-menu"
  | "menu-returned"
  | "shutdown";

export type GameFlowFSMErrorCode =
  | "invalid-transition"
  | "internal-invariant";

export class GameFlowFSMError
  extends Error {
  public readonly name =
    "GameFlowFSMError";

  public constructor(
    public readonly code:
      GameFlowFSMErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface GameFlowTransition {
  readonly previousState:
    GameFlowState;
  readonly event:
    GameFlowEvent;
  readonly nextState:
    GameFlowState;
}

type SaveReturnState =
  | "playing"
  | "paused";

const ALL_EVENTS =
  Object.freeze<
    readonly GameFlowEvent[]
  >([
    "boot-ready",
    "start-game",
    "load-succeeded",
    "load-failed",
    "pause",
    "resume",
    "save-requested",
    "save-succeeded",
    "save-failed",
    "return-to-menu",
    "menu-returned",
    "shutdown",
  ]);

function isAllowedWithoutShutdown(
  state: GameFlowState,
  event: GameFlowEvent,
): boolean {
  switch (state) {
    case "boot":
      return event === "boot-ready";

    case "main-menu":
      return event === "start-game";

    case "loading-game":
      return (
        event === "load-succeeded" ||
        event === "load-failed"
      );

    case "playing":
      return (
        event === "pause" ||
        event === "save-requested" ||
        event === "return-to-menu"
      );

    case "paused":
      return (
        event === "resume" ||
        event === "save-requested" ||
        event === "return-to-menu"
      );

    case "saving":
      return (
        event === "save-succeeded" ||
        event === "save-failed"
      );

    case "returning-to-menu":
      return event === "menu-returned";

    case "shutdown":
      return false;
  }
}

/**
 * FSM de alto nível da aplicação.
 *
 * Propriedades:
 * - estado inicial fixo: boot;
 * - transições explícitas e determinísticas;
 * - mutação in-place somente em dispatch();
 * - nenhuma dependência de renderer, input, física, Tauri, plugins ou engine;
 * - nenhum update por frame.
 *
 * "saving" guarda internamente o estado de retorno para preservar se o save foi
 * iniciado durante gameplay normal ou enquanto o jogo estava pausado.
 *
 * A FSM não executa os side effects de load/save/menu/shutdown. Ela somente
 * expressa e valida o fluxo. O composition root/camada de aplicação dispara os
 * serviços adequados e envia o evento de sucesso/falha correspondente.
 */
export class GameFlowFSM {
  private stateValue:
    GameFlowState = "boot";

  private saveReturnState:
    SaveReturnState | null =
      null;

  public get state():
    GameFlowState {
    return this.stateValue;
  }

  public get isTerminal():
    boolean {
    return (
      this.stateValue ===
      "shutdown"
    );
  }

  /**
   * Consulta sem mutação.
   *
   * shutdown é permitido a partir de qualquer estado ainda não terminal.
   */
  public canDispatch(
    event: GameFlowEvent,
  ): boolean {
    if (
      event === "shutdown"
    ) {
      return (
        this.stateValue !==
        "shutdown"
      );
    }

    return isAllowedWithoutShutdown(
      this.stateValue,
      event,
    );
  }

  /**
   * Lista alocada somente sob demanda para UI/debug/telemetria.
   *
   * Não deve ser consultada por frame.
   */
  public getAllowedEvents():
    readonly GameFlowEvent[] {
    const allowed:
      GameFlowEvent[] = [];

    for (
      const event of
      ALL_EVENTS
    ) {
      if (
        this.canDispatch(event)
      ) {
        allowed.push(event);
      }
    }

    return allowed;
  }

  /**
   * Executa uma transição atômica.
   *
   * Em erro, o estado permanece inalterado.
   */
  public dispatch(
    event: GameFlowEvent,
  ): GameFlowTransition {
    const previousState =
      this.stateValue;

    if (
      !this.canDispatch(event)
    ) {
      throw new GameFlowFSMError(
        "invalid-transition",
        `Evento "${event}" inválido no estado "${previousState}".`,
      );
    }

    if (
      event === "shutdown"
    ) {
      this.stateValue =
        "shutdown";

      this.saveReturnState =
        null;

      return {
        previousState,
        event,
        nextState:
          this.stateValue,
      };
    }

    let nextState:
      GameFlowState;

    switch (previousState) {
      case "boot":
        nextState =
          "main-menu";
        break;

      case "main-menu":
        nextState =
          "loading-game";
        break;

      case "loading-game":
        nextState =
          event ===
          "load-succeeded"
            ? "playing"
            : "main-menu";
        break;

      case "playing":
        if (
          event === "pause"
        ) {
          nextState =
            "paused";
          break;
        }

        if (
          event ===
          "save-requested"
        ) {
          this.saveReturnState =
            "playing";

          nextState =
            "saving";
          break;
        }

        nextState =
          "returning-to-menu";
        break;

      case "paused":
        if (
          event === "resume"
        ) {
          nextState =
            "playing";
          break;
        }

        if (
          event ===
          "save-requested"
        ) {
          this.saveReturnState =
            "paused";

          nextState =
            "saving";
          break;
        }

        nextState =
          "returning-to-menu";
        break;

      case "saving": {
        const returnState =
          this.saveReturnState;

        if (
          returnState === null
        ) {
          throw new GameFlowFSMError(
            "internal-invariant",
            "GameFlowFSM entrou em saving sem saveReturnState.",
          );
        }

        this.saveReturnState =
          null;

        nextState =
          returnState;
        break;
      }

      case "returning-to-menu":
        nextState =
          "main-menu";
        break;

      case "shutdown":
        throw new GameFlowFSMError(
          "internal-invariant",
          "Estado shutdown não deveria possuir transições.",
        );
    }

    this.stateValue =
      nextState;

    return {
      previousState,
      event,
      nextState,
    };
  }
}
