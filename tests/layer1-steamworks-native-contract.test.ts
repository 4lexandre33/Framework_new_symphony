import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), ...relativePath.split("/")), "utf8");
}

describe("Layer 1 Stage 84 — native Steamworks contract", (): void => {
  it("possui init único, offline fallback e shutdown real do callback pump", (): void => {
    const source = read("src-tauri/src/steam.rs");
    const host = read("src-tauri/src/lib.rs");

    expect(source.match(/steamworks::Client::init\(\)/gu)?.length).toBe(1);
    expect(source).not.toContain("Client::init_app");
    expect(source).toContain("AtomicBool");
    expect(source).toContain("JoinHandle");
    expect(source).toContain("impl Drop for SteamState");
    expect(source).not.toContain("drop(single_client);");
    expect(source).toContain("Aplicação seguirá em modo offline");
    expect(host).not.toContain('std::env::set_var("SteamAppId"');
    expect(host).toContain("app_handle.state::<SteamState>().shutdown()");
  });

  it("usa matchmaking real e bindings P2P que respeitam channel", (): void => {
    const source = read("src-tauri/src/steam.rs");

    expect(source).toContain("matchmaking.create_lobby");
    expect(source).toContain("matchmaking.join_lobby");
    expect(source).not.toContain("mock_lobby");
    expect(source).not.toContain("SystemTime::now()");
    expect(source).toContain("SteamAPI_ISteamNetworking_SendP2PPacket");
    expect(source).toContain("SteamAPI_ISteamNetworking_ReadP2PPacket");
    expect(source).toContain("SteamAPI_ISteamNetworking_GetP2PSessionState");
  });

  it("expõe Cloud, Overlay e Workshop por comandos nativos sem misturar Domain", (): void => {
    const source = read("src-tauri/src/steam.rs");

    expect(source).toContain("pub fn steam_cloud_write_file");
    expect(source).toContain("pub fn steam_cloud_read_file");
    expect(source).toContain("SteamAPI_ISteamFriends_ActivateGameOverlay");
    expect(source).toContain("pub fn steam_workshop_download_item");
    expect(source).not.toContain("src/domain");
  });
});
