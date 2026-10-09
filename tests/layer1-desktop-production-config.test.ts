import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Layer 1 Stage 88 desktop production contract", () => {
  it("keeps the Tauri desktop identity and production bundle active", () => {
    const cfg = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
    expect(cfg.productName).toBe("projeto1");
    expect(cfg.identifier).toBe("com.projeto1.game");
    expect(cfg.build.frontendDist).toBe("../dist");
    expect(cfg.bundle.active).toBe(true);
    expect(cfg.bundle.icon.length).toBeGreaterThan(0);
  });

  it("keeps desktop resize and explicit CSP contracts", () => {
    const cfg = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
    expect(cfg.app.windows[0].resizable).toBe(true);
    expect(cfg.app.security.csp.length).toBeGreaterThan(0);
  });

  it("keeps Steam dev AppID and release shutdown contracts explicit", () => {
    expect(fs.readFileSync("src-tauri/steam_appid.txt", "utf8").trim()).toBe("480");
    const main = fs.readFileSync("src-tauri/src/main.rs", "utf8");
    const lib = fs.readFileSync("src-tauri/src/lib.rs", "utf8");
    expect(main).toContain("windows_subsystem");
    expect(lib).toContain("RunEvent::Exit");
    expect(lib).toContain("shutdown");
  });

  it("serializes the full certification test suite", () => {
    const validator = fs.readFileSync("scripts/architecture/stage88-validate-desktop-production.mjs", "utf8");
    expect(validator).toContain('"--no-file-parallelism"');
    expect(validator).toContain('CARGO_BUILD_JOBS: "1"');
  });
});
