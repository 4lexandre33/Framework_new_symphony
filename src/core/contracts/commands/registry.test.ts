import { describe, it, expect } from "vitest";
import { CommandRegistry, defineCommand } from "./registry";

const schema = {
  parse: (raw: unknown) => {
    if (typeof raw !== "object" || raw === null) throw new Error("não é objeto");
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== "string") throw new Error("id ausente");
    return { id: o.id };
  },
};

describe("CommandRegistry", () => {
  it("registra e valida com schema", () => {
    const r = new CommandRegistry();
    r.define("p1", defineCommand("doc.save", { schema }));
    expect(r.validate("doc.save", { id: "1" })).toEqual({ id: "1" });
  });

  it("rejeita payload inválido", () => {
    const r = new CommandRegistry();
    r.define("p1", defineCommand("doc.save", { schema }));
    expect(() => r.validate("doc.save", { id: 1 })).toThrow(/payload inválido/);
  });

  it("no-op quando não há schema", () => {
    const r = new CommandRegistry();
    r.define("p1", defineCommand("doc.save"));
    const payload = { x: 1 };
    expect(r.validate("doc.save", payload)).toBe(payload);
  });

  it("rejeita duplicata", () => {
    const r = new CommandRegistry();
    r.define("p1", defineCommand("doc.save"));
    expect(() => r.define("p2", defineCommand("doc.save"))).toThrow(/já registrado/);
  });

  it("disposePlugin remove definições do owner", () => {
    const r = new CommandRegistry();
    r.define("p1", defineCommand("a"));
    r.define("p2", defineCommand("b"));
    r.disposePlugin("p1");
    expect(r.has("a")).toBe(false);
    expect(r.has("b")).toBe(true);
  });
});