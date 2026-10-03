import { describe, it, expect } from "vitest";
import { EventBus } from "./event-bus";
import { makeEnvelope, type EventEnvelope } from "../contracts/envelope";
import { createLogger } from "./logger";

function env(type: string, payload: unknown): EventEnvelope {
  return makeEnvelope({ kind: "event", type, payload, source: "test" }) as EventEnvelope;
}

describe("EventBus", () => {
  it("strict: false — handler que lança não derruba o emit", async () => {
    const log = createLogger("test", { sink: () => {} });
    const bus = new EventBus(log, { strict: false });
    bus.on("p1", "x", () => {
      throw new Error("boom");
    });
    await expect(bus.emit(env("x", {}))).resolves.toBeUndefined();
  });

  it("strict: true — handler que lança faz emit rejeitar", async () => {
    const log = createLogger("test", { sink: () => {} });
    const bus = new EventBus(log, { strict: true });
    bus.on("p1", "x", () => {
      throw new Error("boom");
    });
    await expect(bus.emit(env("x", {}))).rejects.toThrow();
  });

  it("disposePlugin remove handlers do plugin", async () => {
    const log = createLogger("test", { sink: () => {} });
    const bus = new EventBus(log);
    let called = 0;
    bus.on("p1", "x", () => {
      called++;
    });
    bus.disposePlugin("p1");
    await bus.emit(env("x", {}));
    expect(called).toBe(0);
  });
});