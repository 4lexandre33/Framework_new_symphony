import { describe, it, expect } from "vitest";
import { QueryRegistry, defineQuery } from "./registry";

const inputSchema = {
  parse: (raw: unknown) => {
    if (typeof raw !== "object" || raw === null) throw new Error("não é objeto");
    const o = raw as Record<string, unknown>;
    if (typeof o.q !== "string") throw new Error("q ausente");
    return { q: o.q };
  },
};

describe("QueryRegistry", () => {
  it("registra e valida payload", () => {
    const r = new QueryRegistry();
    r.define("p1", defineQuery("doc.search", { schema: inputSchema }));
    expect(r.validate("doc.search", { q: "foo" })).toEqual({ q: "foo" });
  });

  it("rejeita payload inválido", () => {
    const r = new QueryRegistry();
    r.define("p1", defineQuery("doc.search", { schema: inputSchema }));
    expect(() => r.validate("doc.search", { q: 1 })).toThrow(/payload inválido/);
  });

  it("no-op sem schema", () => {
    const r = new QueryRegistry();
    r.define("p1", defineQuery("doc.search"));
    const p = { q: "x" };
    expect(r.validate("doc.search", p)).toBe(p);
  });

  it("rejeita duplicata", () => {
    const r = new QueryRegistry();
    r.define("p1", defineQuery("q"));
    expect(() => r.define("p2", defineQuery("q"))).toThrow(/já registrada/);
  });

  it("disposePlugin remove definições do owner", () => {
    const r = new QueryRegistry();
    r.define("p1", defineQuery("a"));
    r.define("p2", defineQuery("b"));
    r.disposePlugin("p1");
    expect(r.has("a")).toBe(false);
    expect(r.has("b")).toBe(true);
  });
});