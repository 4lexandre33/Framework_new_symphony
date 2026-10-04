export type SimulationTimerStatus =
  | "idle"
  | "running"
  | "paused"
  | "completed";

export interface TimerSnapshot {
  readonly durationTicks:
    number;
  readonly elapsedTicks:
    number;
  readonly status:
    SimulationTimerStatus;
}
