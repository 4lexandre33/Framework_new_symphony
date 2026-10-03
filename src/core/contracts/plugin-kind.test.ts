import { describe, it, expect } from "vitest";
import {
  PLUGIN_KINDS,
  canDependOn,
  isExternal,
  kindRank,
} from "./plugin-kind";

describe("plugin-kind", () => {
  it("ranks internal < preloaded < external", () => {
    expect(kindRank("internal")).toBeLessThan(kindRank("preloaded"));
    expect(kindRank("preloaded")).toBeLessThan(kindRank("external"));
  });

  it("camadas mais internas não dependem de mais externas", () => {
    expect(canDependOn("internal", "internal")).toBe(true);
    expect(canDependOn("internal", "preloaded")).toBe(false);
    expect(canDependOn("internal", "external")).toBe(false);

    expect(canDependOn("preloaded", "internal")).toBe(true);
    expect(canDependOn("preloaded", "preloaded")).toBe(true);
    expect(canDependOn("preloaded", "external")).toBe(false);

    expect(canDependOn("external", "internal")).toBe(true);
    expect(canDependOn("external", "preloaded")).toBe(true);
    expect(canDependOn("external", "external")).toBe(true);
  });

  it("isExternal só é true para external", () => {
    for (const k of PLUGIN_KINDS) {
      expect(isExternal(k)).toBe(k === "external");
    }
  });
});