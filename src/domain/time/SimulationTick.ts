declare const SIMULATION_TICK_BRAND:
  unique symbol;

export type SimulationTick =
  number & {
    readonly [SIMULATION_TICK_BRAND]:
      "SimulationTick";
  };

export type SimulationTickErrorCode =
  | "invalid-tick"
  | "tick-overflow";

export class SimulationTickError
  extends Error {
  public readonly name =
    "SimulationTickError";

  public constructor(
    public readonly code:
      SimulationTickErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function assertSimulationTickValue(
  value: number,
): void {
  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value < 0
  ) {
    throw new SimulationTickError(
      "invalid-tick",
      "SimulationTick deve ser um inteiro seguro maior ou igual a 0.",
    );
  }
}

export function createSimulationTick(
  value: number,
): SimulationTick {
  assertSimulationTickValue(
    value,
  );

  return value as SimulationTick;
}

export function simulationTickToNumber(
  tick: SimulationTick,
): number {
  return tick;
}

export function addSimulationTicks(
  tick: SimulationTick,
  deltaTicks: number,
): SimulationTick {
  if (
    !Number.isSafeInteger(
      deltaTicks,
    ) ||
    deltaTicks < 0
  ) {
    throw new SimulationTickError(
      "invalid-tick",
      "deltaTicks deve ser um inteiro seguro maior ou igual a 0.",
    );
  }

  const next =
    tick + deltaTicks;

  if (
    !Number.isSafeInteger(next)
  ) {
    throw new SimulationTickError(
      "tick-overflow",
      "SimulationTick excedeu o limite de inteiro seguro.",
    );
  }

  return next as SimulationTick;
}
