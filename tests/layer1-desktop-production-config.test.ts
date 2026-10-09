// @vitest-environment node
import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Layer 1 Stage 88 — desktop production config", () => {
  it("requires real Stage 86 and Stage 87 certification evidence", () => {
    const stage86 = JSON.parse(fs.readFileSync("ETAPA86_AUTOMATED_PASS.json", "utf8"));
    const stage87 = JSON.parse(fs.readFileSync("ETAPA87_AUTOMATED_PASS.json", "utf8"));
    expect(stage86).toMatchObject({ stage: 86, status: "PASS", violations: 0 });
    expect(stage87).toMatchObject({ stage: 87, status: "PASS", violations: 0 });
  });

  it("keeps Tauri identity, versions, build paths and bundle assets coherent", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const cfg = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
    const cargo = fs.readFileSync("src-tauri/Cargo.toml", "utf8");
    expect(pkg.version).toBe("0.1.0");
    expect(cfg.version).toBe(pkg.version);
    expect(cargo).toContain('version = "0.1.0"');
    expect(cfg.productName).toBe("projeto1");
    expect(cfg.identifier).toBe("com.projeto1.game");
    expect(cfg.build.frontendDist).toBe("../dist");
    expect(cfg.build.beforeBuildCommand).toBe("npm run build");
    expect(cfg.bundle.active).toBe(true);
    for (const icon of cfg.bundle.icon as string[]) {
      expect(fs.existsSync(`src-tauri/${icon}`)).toBe(true);
    }
  });

  it("keeps explicit CSP and intentional desktop window policy", () => {
    const cfg = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
    expect(cfg.app.withGlobalTauri).toBe(false);
    expect(cfg.app.security.csp.length).toBeGreaterThan(0);
    expect(cfg.app.windows[0]).toMatchObject({
      width: 1280,
      height: 720,
      resizable: true,
      transparent: true,
      decorations: false,
      alwaysOnTop: true
    });
  });

  it("separates Steam dev AppID from packaged release while keeping Steam feature explicit", () => {
    const cfg = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
    const cargo = fs.readFileSync("src-tauri/Cargo.toml", "utf8");
    const host = fs.readFileSync("src-tauri/src/lib.rs", "utf8");
    expect(fs.readFileSync("src-tauri/steam_appid.txt", "utf8").trim()).toBe("480");
    expect(host).not.toContain('std::env::set_var("SteamAppId"');
    expect(JSON.stringify(cfg.bundle.resources ?? [])).not.toContain("steam_appid");
    expect(cargo).toContain('default = ["steam"]');
    expect(cargo).toContain('steam = ["dep:steamworks"]');
    expect(cargo).not.toContain("[profile.release]");
  });

  it("serializes certification and disables duplicate frontend build inside Tauri smoke", () => {
    const validator = fs.readFileSync("scripts/architecture/stage88-validate-desktop-production.mjs", "utf8");
    const override = JSON.parse(fs.readFileSync("src-tauri/tauri.stage88.conf.json", "utf8"));
    expect(validator).toContain('"--no-file-parallelism"');
    expect(validator).toContain('CARGO_BUILD_JOBS: "1"');
    expect(override.build.beforeBuildCommand).toBeNull();
  });
});
