import { describe, it, expect } from "vitest";
import { EventRegistry } from "./registry";
import { defineEvent } from "../typed-event";

const schema = {
  parse: (raw: unknown) => {
    if (typeof raw !== "object" || raw === null) throw new Error("não é objeto");
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== "string") throw new Error("id ausente");
    return { id: o.id };
  },
};

describe("EventRegistry", () => {
  it("registra e valida com schema", () => {
    const r = new EventRegistry();
    r.define("p1", defineEvent("x.saved", { schema }));
    expect(r.validate("x.saved", { id: "1" })).toEqual({ id: "1" });
  });

  it("rejeita payload inválido", () => {
    const r = new EventRegistry();
    r.define("p1", defineEvent("x.saved", { schema }));
    expect(() => r.validate("x.saved", { id: 1 })).toThrow(/payload inválido/);
  });

  it("no-op quando não há schema", () => {
    const r = new EventRegistry();
    r.define("p1", defineEvent("x.saved"));
    const payload = { qualquer: true };
    expect(r.validate("x.saved", payload)).toBe(payload);
  });

  it("rejeita registro duplicado", () => {
    const r = new EventRegistry();
    r.define("p1", defineEvent("x"));
    expect(() => r.define("p2", defineEvent("x"))).toThrow(/já registrado/);
  });

  it("disposePlugin remove só as definições do owner", () => {
    const r = new EventRegistry();
    r.define("p1", defineEvent("a"));
    r.define("p2", defineEvent("b"));
    r.disposePlugin("p1");
    expect(r.has("a")).toBe(false);
    expect(r.has("b")).toBe(true);
  });

  it("ownerOf retorna quem definiu", () => {
    const r = new EventRegistry();
    r.define("p1", defineEvent("x"));
    expect(r.ownerOf("x")).toBe("p1");
  });
});