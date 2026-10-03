import { describe, it, expect } from "vitest";
import { CapabilityRegistry } from "./capability-registry";

const prov = (id: string, version = "1.0.0") => ({ id, version });
const req = (id: string, range = "^1.0.0") => ({ id, range });

describe("CapabilityRegistry — política de camada", () => {
  it("internal consumindo de internal: ok", () => {
    const r = new CapabilityRegistry();
    r.declareProvider("p1", "internal", prov("x"));
    r.declareRequirement("p2", "internal", req("x"));
    expect(r.resolveFor("p2")[0]!.provider?.pluginId).toBe("p1");
  });

  it("internal consumindo de external: recusado por default", () => {
    const r = new CapabilityRegistry();
    r.declareProvider("p1", "external", prov("x"));
    r.declareRequirement("p2", "internal", req("x"));
    expect(() => r.resolveFor("p2")).toThrow(/camada proibida/);
  });

  it("preloaded consumindo de external: recusado por default", () => {
    const r = new CapabilityRegistry();
    r.declareProvider("p1", "external", prov("x"));
    r.declareRequirement("p2", "preloaded", req("x"));
    expect(() => r.resolveFor("p2")).toThrow(/camada proibida/);
  });

  it("external consumindo de internal: ok", () => {
    const r = new CapabilityRegistry();
    r.declareProvider("p1", "internal", prov("x"));
    r.declareRequirement("p2", "external", req("x"));
    expect(r.resolveFor("p2")[0]!.provider?.pluginId).toBe("p1");
  });

  it("allowInternalConsumeExternal=true suspende a regra", () => {
    const r = new CapabilityRegistry({ allowInternalConsumeExternal: true });
    r.declareProvider("p1", "external", prov("x"));
    r.declareRequirement("p2", "internal", req("x"));
    expect(r.resolveFor("p2")[0]!.provider?.pluginId).toBe("p1");
  });

  it("missing capability mantém CAPABILITY_MISSING", () => {
    const r = new CapabilityRegistry();
    r.declareRequirement("p2", "internal", req("x"));
    expect(() => r.resolveFor("p2")).toThrow(/não tem valor|nenhum provider/i);
  });
});