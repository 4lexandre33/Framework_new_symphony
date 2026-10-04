// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  GameFlowFSM,
  GameFlowFSMError,
} from "../src/app/flows";

function reachPlaying(
  fsm: GameFlowFSM,
): void {
  fsm.dispatch(
    "boot-ready",
  );

  fsm.dispatch(
    "start-game",
  );

  fsm.dispatch(
    "load-succeeded",
  );
}

describe(
  "Etapa 44.7 — GameFlowFSM",
  () => {
    it(
      "executa boot -> menu -> loading -> playing",
      () => {
        const fsm =
          new GameFlowFSM();

        expect(fsm.state).toBe(
          "boot",
        );

        expect(
          fsm.dispatch(
            "boot-ready",
          ),
        ).toEqual({
          previousState:
            "boot",
          event: "boot-ready",
          nextState:
            "main-menu",
        });

        expect(
          fsm.dispatch(
            "start-game",
          ).nextState,
        ).toBe(
          "loading-game",
        );

        expect(
          fsm.dispatch(
            "load-succeeded",
          ).nextState,
        ).toBe("playing");
      },
    );

    it(
      "retorna ao menu quando load falha",
      () => {
        const fsm =
          new GameFlowFSM();

        fsm.dispatch(
          "boot-ready",
        );

        fsm.dispatch(
          "start-game",
        );

        const transition =
          fsm.dispatch(
            "load-failed",
          );

        expect(transition).toEqual({
          previousState:
            "loading-game",
          event: "load-failed",
          nextState:
            "main-menu",
        });
      },
    );

    it(
      "pausa e retoma gameplay",
      () => {
        const fsm =
          new GameFlowFSM();

        reachPlaying(fsm);

        fsm.dispatch("pause");

        expect(fsm.state).toBe(
          "paused",
        );

        fsm.dispatch("resume");

        expect(fsm.state).toBe(
          "playing",
        );
      },
    );

    it(
      "save iniciado em playing retorna para playing",
      () => {
        const fsm =
          new GameFlowFSM();

        reachPlaying(fsm);

        fsm.dispatch(
          "save-requested",
        );

        expect(fsm.state).toBe(
          "saving",
        );

        fsm.dispatch(
          "save-succeeded",
        );

        expect(fsm.state).toBe(
          "playing",
        );
      },
    );

    it(
      "save iniciado em paused retorna para paused inclusive em falha",
      () => {
        const fsm =
          new GameFlowFSM();

        reachPlaying(fsm);

        fsm.dispatch("pause");

        fsm.dispatch(
          "save-requested",
        );

        expect(fsm.state).toBe(
          "saving",
        );

        fsm.dispatch(
          "save-failed",
        );

        expect(fsm.state).toBe(
          "paused",
        );
      },
    );

    it(
      "controla retorno ao menu como estado transitório explícito",
      () => {
        const fsm =
          new GameFlowFSM();

        reachPlaying(fsm);

        fsm.dispatch(
          "return-to-menu",
        );

        expect(fsm.state).toBe(
          "returning-to-menu",
        );

        fsm.dispatch(
          "menu-returned",
        );

        expect(fsm.state).toBe(
          "main-menu",
        );
      },
    );

    it(
      "shutdown é permitido de qualquer estado não terminal",
      () => {
        const boot =
          new GameFlowFSM();

        boot.dispatch(
          "shutdown",
        );

        expect(boot.state).toBe(
          "shutdown",
        );

        expect(
          boot.isTerminal,
        ).toBe(true);

        const loading =
          new GameFlowFSM();

        loading.dispatch(
          "boot-ready",
        );

        loading.dispatch(
          "start-game",
        );

        loading.dispatch(
          "shutdown",
        );

        expect(
          loading.state,
        ).toBe("shutdown");

        const saving =
          new GameFlowFSM();

        reachPlaying(saving);

        saving.dispatch(
          "save-requested",
        );

        saving.dispatch(
          "shutdown",
        );

        expect(
          saving.state,
        ).toBe("shutdown");
      },
    );

    it(
      "rejeita transição inválida sem mutar estado",
      () => {
        const fsm =
          new GameFlowFSM();

        expect(() =>
          fsm.dispatch("pause"),
        ).toThrow(
          GameFlowFSMError,
        );

        expect(fsm.state).toBe(
          "boot",
        );

        fsm.dispatch(
          "boot-ready",
        );

        expect(() =>
          fsm.dispatch(
            "load-succeeded",
          ),
        ).toThrow(
          GameFlowFSMError,
        );

        expect(fsm.state).toBe(
          "main-menu",
        );
      },
    );

    it(
      "expõe canDispatch e allowed events sem alterar estado",
      () => {
        const fsm =
          new GameFlowFSM();

        expect(
          fsm.canDispatch(
            "boot-ready",
          ),
        ).toBe(true);

        expect(
          fsm.canDispatch(
            "start-game",
          ),
        ).toBe(false);

        expect(
          fsm.getAllowedEvents(),
        ).toEqual([
          "boot-ready",
          "shutdown",
        ]);

        expect(fsm.state).toBe(
          "boot",
        );
      },
    );

    it(
      "estado shutdown é terminal e rejeita novos eventos",
      () => {
        const fsm =
          new GameFlowFSM();

        fsm.dispatch(
          "shutdown",
        );

        expect(
          fsm.canDispatch(
            "shutdown",
          ),
        ).toBe(false);

        expect(
          fsm.getAllowedEvents(),
        ).toEqual([]);

        expect(() =>
          fsm.dispatch(
            "shutdown",
          ),
        ).toThrow(
          GameFlowFSMError,
        );
      },
    );
  },
);
