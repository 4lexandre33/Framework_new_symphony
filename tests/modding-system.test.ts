import {
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { AssetOverrideRegistry } from "../src/engine/modding/AssetOverrideRegistry";
import { DynamicPluginLoader } from "../src/engine/modding/DynamicPluginLoader";
import { ScriptSandbox } from "../src/engine/modding/ScriptSandbox";
import { SteamWorkshopDriver } from "../src/engine/modding/SteamWorkshopDriver";
import { createModdingPlugin } from "../src/plugins/modding/plugin";
import { ModdingToken } from "../src/tokens/modding";

function createManifest(
  modId: string,
  version = "1.0.0",
) {
  return {
    modId,
    name: modId,
    version,
    author: "Test",
    description: "",
    minEngineVersion: "1.0.0",
  } as const;
}

describe("Camada de Modding & Oficina da Steam (game.modding)", (): void => {
  let registry: AssetOverrideRegistry;
  let loader: DynamicPluginLoader;
  let workshopDriver: SteamWorkshopDriver;

  beforeEach((): void => {
    registry = new AssetOverrideRegistry();
    loader = new DynamicPluginLoader();
    workshopDriver = new SteamWorkshopDriver();
  });

  describe("AssetOverrideRegistry", (): void => {
    it("deve resolver o override com maior prioridade", (): void => {
      registry.registerOverride({
        virtualPath: "vfs://models/hero.glb",
        realPath: "mods/low_res/hero.glb",
        modId: "mod_low",
        priority: 1,
      });

      registry.registerOverride({
        virtualPath: "vfs://models/hero.glb",
        realPath: "mods/hd_skin/hero.glb",
        modId: "mod_hd",
        priority: 10,
      });

      expect(
        registry.resolveOverride("vfs://models/hero.glb"),
      ).toBe("mods/hd_skin/hero.glb");
    });

    it("deve substituir o override anterior do mesmo mod", (): void => {
      registry.registerOverride({
        virtualPath: "vfs://models/hero.glb",
        realPath: "mods/a/hero.glb",
        modId: "mod_a",
        priority: 1,
      });

      registry.registerOverride({
        virtualPath: "vfs://models/hero.glb",
        realPath: "mods/a/hero_v2.glb",
        modId: "mod_a",
        priority: 2,
      });

      expect(registry.getAllOverrides()).toHaveLength(1);
      expect(registry.resolveOverride("vfs://models/hero.glb"))
        .toBe("mods/a/hero_v2.glb");
    });

    it("deve remover overrides quando o mod for desativado", (): void => {
      registry.registerOverride({
        virtualPath: "vfs://textures/grass.png",
        realPath: "mods/hd_grass.png",
        modId: "mod_grass",
        priority: 5,
      });

      registry.removeOverridesForMod("mod_grass");
      expect(registry.resolveOverride("vfs://textures/grass.png")).toBeNull();
    });

    it("deve rejeitar prioridade não finita", (): void => {
      expect((): void => {
        registry.registerOverride({
          virtualPath: "vfs://invalid",
          realPath: "mods/invalid",
          modId: "mod_invalid",
          priority: Number.NaN,
        });
      }).toThrow(/priority/);
    });
  });

  describe("DynamicPluginLoader", (): void => {
    it("deve fazer o parsing de um manifesto mod.json válido", (): void => {
      const rawJson = JSON.stringify({
        modId: "custom_ui",
        name: "Custom UI Pack",
        version: "1.0.0",
        author: "Comunidade",
        description: "Altera o HUD do jogo",
        minEngineVersion: "1.0.0",
      });

      const manifest = loader.parseManifest(rawJson);
      expect(manifest.modId).toBe("custom_ui");
      expect(manifest.name).toBe("Custom UI Pack");
    });

    it("deve rejeitar manifesto estruturalmente inválido", (): void => {
      expect((): void => {
        loader.parseManifest(JSON.stringify({ modId: "broken" }));
      }).toThrow(/name/);
    });

    it("deve resolver a ordem de carregamento baseada em dependências", (): void => {
      loader.registerMod({
        ...createManifest("mod_b"),
        dependencies: [{ modId: "mod_a", minVersion: "1.0" }],
      });
      loader.registerMod(createManifest("mod_a"));

      const order = loader.resolveLoadOrder();
      expect(order[0]?.modId).toBe("mod_a");
      expect(order[1]?.modId).toBe("mod_b");
    });

    it("deve detectar dependência ausente", (): void => {
      loader.registerMod({
        ...createManifest("mod_b"),
        dependencies: [{ modId: "missing", minVersion: "1.0.0" }],
      });

      expect((): void => {
        loader.resolveLoadOrder();
      }).toThrow(/Dependência ausente/);
    });

    it("deve detectar dependência circular", (): void => {
      loader.registerMod({
        ...createManifest("mod_a"),
        dependencies: [{ modId: "mod_b", minVersion: "1.0.0" }],
      });
      loader.registerMod({
        ...createManifest("mod_b"),
        dependencies: [{ modId: "mod_a", minVersion: "1.0.0" }],
      });

      expect((): void => {
        loader.resolveLoadOrder();
      }).toThrow(/cíclica/);
    });

    it("deve validar minVersion semanticamente, não lexicograficamente", (): void => {
      loader.registerMod(createManifest("base", "1.10.0"));
      loader.registerMod({
        ...createManifest("addon"),
        dependencies: [{ modId: "base", minVersion: "1.2.0" }],
      });

      expect(loader.resolveLoadOrder()).toHaveLength(2);
    });

    it("deve rejeitar versão de dependência abaixo do mínimo", (): void => {
      loader.registerMod(createManifest("base", "1.1.0"));
      loader.registerMod({
        ...createManifest("addon"),
        dependencies: [{ modId: "base", minVersion: "1.2.0" }],
      });

      expect((): void => {
        loader.resolveLoadOrder();
      }).toThrow(/Versão incompatível/);
    });
  });

  describe("ScriptSandbox", (): void => {
    it("deve rejeitar timeout inválido", (): void => {
      expect((): ScriptSandbox => new ScriptSandbox({
        maxExecutionTimeMs: 0,
        allowedCapabilities: [],
      })).toThrow(/maxExecutionTimeMs/);
    });

    it("deve respeitar allowlist de capabilities", (): void => {
      const sandbox = new ScriptSandbox({
        maxExecutionTimeMs: 1_000,
        allowedCapabilities: ["game.ui"],
      });

      expect(sandbox.isCapabilityAllowed("game.ui")).toBe(true);
      expect(sandbox.isCapabilityAllowed("game.storage")).toBe(false);
    });
  });

  describe("SteamWorkshopDriver", (): void => {
    it("deve rastrear o progresso de download de itens inscritos", (): void => {
      workshopDriver.registerSubscribedItem({
        itemId: "998877",
        title: "Mapa Customizado",
        description: "Novo mapa procedural",
        ownerSteamId: "76561198000000000",
        fileSizeBytes: 2048,
        isSubscribed: true,
        isDownloading: true,
        downloadProgressPercentage: 0,
      });

      workshopDriver.updateDownloadProgress("998877", 75);
      const item = workshopDriver.getItem("998877");

      expect(item?.downloadProgressPercentage).toBe(75);
      expect(item?.isDownloading).toBe(true);
    });

    it("deve limitar progresso ao intervalo de zero a cem", (): void => {
      workshopDriver.registerSubscribedItem({
        itemId: "1",
        title: "Item",
        description: "",
        ownerSteamId: "1",
        fileSizeBytes: 10,
        isSubscribed: true,
        isDownloading: true,
        downloadProgressPercentage: 0,
      });

      workshopDriver.updateDownloadProgress("1", 150);
      expect(workshopDriver.getItem("1")?.downloadProgressPercentage).toBe(100);
      expect(workshopDriver.getItem("1")?.isDownloading).toBe(false);
    });
  });

  describe("Plugin game.modding", (): void => {
    it("deve fornecer ModdingToken", (): void => {
      const plugin = createModdingPlugin();
      const provides = plugin.manifest.capabilities?.provides ?? [];

      expect(
        provides.some((capability): boolean => capability.id === ModdingToken.id),
      ).toBe(true);
    });
  });
});
