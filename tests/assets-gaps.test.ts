// @vitest-environment node

import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ManifestProgressPayload } from "../src/contracts/assets/types";
import { AssetsManagerService, type AssetLoaderSet } from "../src/engine/assets/internal/AssetsManagerService";
import { AudioLoaderService } from "../src/engine/assets/internal/AudioLoaderService";
import { TextureLoaderService } from "../src/engine/assets/internal/TextureLoaderService";

function response(body: string | Uint8Array, contentType = "application/octet-stream"): Response {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  return new Response(bytes, {
    headers: { "content-length": String(bytes.byteLength), "content-type": contentType },
  });
}

function makeGLTF(): { scene: THREE.Group; scenes: THREE.Group[]; animations: unknown[]; geometry: THREE.BufferGeometry } {
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshBasicMaterial();
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(geometry, material));
  return { scene, scenes: [scene], animations: [], geometry };
}

const noopLoaders: Partial<AssetLoaderSet> = {
  disposeAudio(): void {},
};

afterEach((): void => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("G79 — loadGLTF devolve instâncias independentes", () => {
  it("cada chamada clona a cena, compartilha geometria e retém +1", async () => {
    const gltf = makeGLTF();
    const dispose = vi.spyOn(gltf.geometry, "dispose");
    const service = new AssetsManagerService(undefined, {
      ...noopLoaders,
      loadGLTF: async () => gltf as never,
    });

    const first = await service.loadGLTF("models/hero.glb");
    const second = await service.loadGLTF("./models/hero.glb");
    expect(first.scene).not.toBe(second.scene);
    expect(first.scene).not.toBe(gltf.scene);
    expect(first.scenes[0]).toBe(first.scene);
    expect((first.scene.children[0] as THREE.Mesh).geometry).toBe(gltf.geometry);
    expect(first.animations).toBe(gltf.animations);
    expect(service.getAsset("models/hero.glb")).toBe(gltf);
    expect(service.getRefCount("models/hero.glb")).toBe(2);

    // duas instâncias na mesma "cena": nenhuma lança por já ter pai
    const root = new THREE.Scene();
    root.add(first.scene, second.scene);
    expect(root.children).toHaveLength(2);

    service.releaseAsset("models/hero.glb");
    expect(dispose).not.toHaveBeenCalled();
    service.releaseAsset("models/hero.glb");
    expect(dispose).toHaveBeenCalledTimes(1);
    service.releaseAsset("models/hero.glb");
    expect(service.getRefCount("models/hero.glb")).toBe(0);
  });
});

describe("G80 — loadAudio não espera o gesto do usuário", () => {
  it("decodifica com o contexto suspenso (resume nunca resolve)", async () => {
    const resume = vi.fn(() => new Promise<void>(() => {}));
    class SuspendedContext {
      public state = "suspended";
      public resume = resume;
      public async close(): Promise<void> {}
      public decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer> {
        return Promise.resolve({ length: data.byteLength } as unknown as AudioBuffer);
      }
    }
    vi.stubGlobal("AudioContext", SuspendedContext);
    const loader = new AudioLoaderService(undefined, async () => response(new Uint8Array(32)));
    const buffer = await loader.load("http://x/a.ogg");
    expect(buffer.length).toBe(32);
    expect(resume).not.toHaveBeenCalled();
    loader.dispose();
  });

  it("sem Web Audio rejeita com erro claro em vez de travar", async () => {
    const loader = new AudioLoaderService(undefined, async () => response(new Uint8Array(4)));
    await expect(loader.load("http://x/a.ogg")).rejects.toThrow("Web Audio");
  });
});

describe("G81 — cache seguro com refcount", () => {
  it("clearCache mantém o que está em uso; force libera tudo; release extra não fica negativo", async () => {
    const texture = new THREE.Texture();
    const dispose = vi.spyOn(texture, "dispose");
    const service = new AssetsManagerService(undefined, {
      ...noopLoaders,
      loadTexture: async () => texture,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await service.loadTexture("t.png");
    expect(service.clearCache()).toBe(0);
    expect(dispose).not.toHaveBeenCalled();
    expect(service.getAsset("t.png")).toBe(texture);
    expect(warn).toHaveBeenCalledTimes(1);

    expect(service.retainAsset("t.png")).toBe(true);
    expect(service.retainAsset("nada.png")).toBe(false);
    expect(service.getRefCount("t.png")).toBe(2);
    expect(service.clearCache({ force: true })).toBe(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    service.releaseAsset("t.png");
    service.releaseAsset("t.png");
    expect(service.getRefCount("t.png")).toBe(0);

    await service.loadTexture("t.png");
    expect(service.getRefCount("t.png")).toBe(1);
  });
});

describe("G82 — json/binary e manifesto com progresso real", () => {
  it("loadJSON e loadBinary usam fetch injetado, com cache e refcount", async () => {
    const fetchSpy = vi.fn(async (url: string) =>
      url.endsWith(".json") ? response('{"hp":3}', "application/json") : response(new Uint8Array([1, 2, 3])),
    );
    const progress: Array<[string, number, number]> = [];
    const service = new AssetsManagerService(
      { onProgress: (url, loaded, total) => progress.push([url, loaded, total]), onLoaded() {} },
      noopLoaders,
      { baseUrl: "http://game.local/", fetch: fetchSpy },
    );
    const data = await service.loadJSON<{ hp: number }>("data/level.json");
    expect(data.hp).toBe(3);
    expect(await service.loadJSON("/data/level.json")).toBe(data);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith("http://game.local/data/level.json");
    const bytes = await service.loadBinary("blob.bin");
    expect(Array.from(new Uint8Array(bytes))).toEqual([1, 2, 3]);
    expect(progress.at(-1)).toEqual(["http://game.local/blob.bin", 3, 3]);
    expect(service.getRefCount("./data/level.json")).toBe(2);
  });

  it("preloadManifest reporta progresso agregado, falhas, ids e libera", async () => {
    const sizes: Record<string, number> = { "http://g/a.bin": 1000, "http://g/b.json": 10 };
    const fetchImpl = async (url: string): Promise<Response> => {
      if (url.endsWith("missing.bin")) {
        return new Response("nope", { status: 404 });
      }

      if (url.endsWith(".json")) {
        return response('{"ok":true}', "application/json");
      }

      // stream em 4 chunks para progresso parcial real
      const total = sizes[url] ?? 100;
      const chunk = new Uint8Array(total / 4);
      let sent = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller): void {
          if (sent === 4) {
            controller.close();
            return;
          }

          sent += 1;
          controller.enqueue(chunk);
        },
      });
      return new Response(stream, { headers: { "content-length": String(total) } });
    };
    const manifestEvents: ManifestProgressPayload[] = [];
    const failures: string[] = [];
    const service = new AssetsManagerService(
      {
        onProgress() {},
        onLoaded() {},
        onLoadFailed: (id) => failures.push(id),
        onManifestProgress: (payload) => manifestEvents.push(payload),
      },
      { ...noopLoaders, loadAudio: async () => ({ duration: 1 }) as AudioBuffer },
      { baseUrl: "http://g/", fetch: fetchImpl },
    );
    const manifest = {
      version: "1",
      assets: [
        { id: "big", url: "a.bin", type: "binary" as const },
        { id: "cfg", url: "b.json", type: "json" as const },
        { id: "sfx", url: "c.ogg", type: "audio" as const },
        { id: "bad", url: "missing.bin", type: "binary" as const },
      ],
    };
    const result = await service.preloadManifest(manifest, { concurrency: 1 });
    expect(result.loaded).toEqual(["big", "cfg", "sfx"]);
    expect(result.failed.map((f) => f.id)).toEqual(["bad"]);
    expect(failures).toEqual(["bad"]);

    const values = manifestEvents.map((event) => event.progress);
    expect(values[0]).toBe(0);
    expect(values.at(-1)).toBe(1);
    expect(values.some((value) => value > 0 && value < 0.25)).toBe(true); // progresso parcial do "big"
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]).toBeGreaterThanOrEqual(values[index - 1]!);
    }
    expect(manifestEvents.at(-1)).toMatchObject({ loadedCount: 3, failedCount: 1, totalCount: 4 });

    expect(service.getAsset<{ ok: boolean }>("cfg")?.ok).toBe(true);
    expect(service.getRefCount("b.json")).toBe(1);
    service.releaseManifest(manifest);
    expect(service.getAsset("cfg")).toBeNull();
    expect(service.getRefCount("b.json")).toBe(0);
  });
});

describe("G83 — URL normalizada, colorSpace e uso em node", () => {
  it("./a, a e /a na raiz são o mesmo asset", async () => {
    let calls = 0;
    const service = new AssetsManagerService(undefined, {
      ...noopLoaders,
      loadTexture: async () => {
        calls += 1;
        return new THREE.Texture();
      },
    }, { baseUrl: "http://host/" });
    const a = await service.loadTexture("./img/a.png");
    const b = await service.loadTexture("img/a.png");
    const c = await service.loadTexture("/img/a.png#frag");
    expect(calls).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(service.normalizeUrl(" ./img/a.png ")).toBe("http://host/img/a.png");
    expect(service.getRefCount("http://host/img/a.png")).toBe(3);
  });

  it("colorSpace configurável (srgb padrão, linear para mapas de dados) e progresso de textura", async () => {
    vi.spyOn(THREE.TextureLoader.prototype, "load").mockImplementation(function (
      this: THREE.TextureLoader,
      _url: string,
      onLoad?: (texture: THREE.Texture) => void,
    ): THREE.Texture {
      const texture = new THREE.Texture();
      queueMicrotask(() => onLoad?.(texture));
      return texture;
    });
    const progress: number[] = [];
    const loader = new TextureLoaderService(
      { onProgress: (_url, loaded) => progress.push(loaded) },
      async () => response(new Uint8Array(64), "image/png"),
    );
    const color = await loader.load("http://h/a.png");
    const normal = await loader.load("http://h/n.png", { colorSpace: "linear" });
    const data = await loader.load("http://h/d.png", { colorSpace: "none", flipY: false });
    expect(color.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(normal.colorSpace).toBe(THREE.LinearSRGBColorSpace);
    expect(data.colorSpace).toBe(THREE.NoColorSpace);
    expect(data.flipY).toBe(false);
    expect(progress).toContain(64);

    // variantes de colorSpace são assets distintos no cache
    const service = new AssetsManagerService(undefined, {
      ...noopLoaders,
      loadTexture: (url, options) => loader.load(url, options),
    }, { baseUrl: "http://h/" });
    const srgb = await service.loadTexture("x.png");
    const linear = await service.loadTexture("x.png", { colorSpace: "linear" });
    expect(srgb).not.toBe(linear);
    expect(service.getAsset("x.png", { colorSpace: "linear" })).toBe(linear);
    service.releaseAsset("x.png", { colorSpace: "linear" });
    expect(service.getAsset("x.png", { colorSpace: "linear" })).toBeNull();
    expect(service.getAsset("x.png")).toBe(srgb);
  });

  it("construir o serviço e o plugin não exige DOM/Web Audio", () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe("undefined");
    const service = new AssetsManagerService();
    expect(service.normalizeUrl("a.png")).toBe("http://localhost/a.png");
    service.dispose();
  });
});
