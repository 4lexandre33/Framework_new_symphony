import { describe, it, expect } from "vitest";
import { computeBootOrder } from "./boot-order";
import type { PluginManifest } from "../contracts/plugin-manifest";

function m(
  id: string,
  kind: PluginManifest["kind"],
  dependsOn?: PluginManifest["dependsOn"],
): PluginManifest {
  return { id, version: "1.0.0", name: id, kind, ...(dependsOn ? { dependsOn } : {}) };
}

describe("computeBootOrder", () => {
  it("independentes saem na ordem de camada", () => {
    const order = computeBootOrder([
      m("ext", "external"),
      m("pre", "preloaded"),
      m("int", "internal"),
    ]).map((x) => x.id);
    expect(order).toEqual(["int", "pre", "ext"]);
  });

  it("dependência de camada mais interna reordena o consumidor", () => {
    const order = computeBootOrder([
      m("ext", "external", [{ id: "int", range: "^1.0.0" }]),
      m("int", "internal"),
    ]).map((x) => x.id);
    expect(order).toEqual(["int", "ext"]);
  });

  it("internal não pode depender de preloaded", () => {
    expect(() =>
      computeBootOrder([
        m("a", "internal", [{ id: "b", range: "^1.0.0" }]),
        m("b", "preloaded"),
      ]),
    ).toThrow(/camadas mais internas/);
  });

  it("internal não pode depender de external", () => {
    expect(() =>
      computeBootOrder([
        m("a", "internal", [{ id: "b", range: "^1.0.0" }]),
        m("b", "external"),
      ]),
    ).toThrow(/camadas mais internas/);
  });

  it("preloaded não pode depender de external", () => {
    expect(() =>
      computeBootOrder([
        m("a", "preloaded", [{ id: "b", range: "^1.0.0" }]),
        m("b", "external"),
      ]),
    ).toThrow(/camadas mais internas/);
  });

  it("dependência opcional ausente não bloqueia", () => {
    const order = computeBootOrder([
      m("a", "internal", [{ id: "ghost", range: "^1.0.0", optional: true }]),
    ]).map((x) => x.id);
    expect(order).toEqual(["a"]);
  });

  it("ciclo continua lançando PLUGIN_CYCLE", () => {
    expect(() =>
      computeBootOrder([
        m("a", "internal", [{ id: "b", range: "^1.0.0" }]),
        m("b", "internal", [{ id: "a", range: "^1.0.0" }]),
      ]),
    ).toThrow(/ciclo/);
  });
});