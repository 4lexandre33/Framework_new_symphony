// @vitest-environment node

import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  AssetCache,
} from "../src/engine/assets/internal/AssetCache";

import {
  AssetsManagerService,
} from "../src/engine/assets/internal/AssetsManagerService";

describe(
  "Etapa 79 — Assets runtime",
  () => {
    it(
      "deduplica carregamentos concorrentes e mantém refCount por consumidor",
      async (): Promise<void> => {
        let resolveTexture:
          (
            value:
              object,
          ) => void =
            (): void => {};

        const texturePromise =
          new Promise<object>(
            (
              resolve,
            ): void => {
              resolveTexture =
                resolve;
            },
          );

        let loadCalls =
          0;

        const loaded:
          string[] =
          [];

        const service =
          new AssetsManagerService(
            {
              onProgress(): void {},

              onLoaded(
                _id,
                url,
              ): void {
                loaded.push(
                  url,
                );
              },
            },
            {
              async loadGLTF() {
                return {} as never;
              },

              async loadTexture() {
                loadCalls +=
                  1;

                return await texturePromise as never;
              },

              async loadAudio() {
                return {} as AudioBuffer;
              },

              disposeAudio(): void {},
            },
          );

        const first =
          service.loadTexture(
            "texture.png",
          );

        const second =
          service.loadTexture(
            "texture.png",
          );

        expect(
          loadCalls,
        ).toBe(1);

        expect(
          service.inFlightCount,
        ).toBe(1);

        const texture = {
          dispose:
            vi.fn(),
        };

        resolveTexture(
          texture,
        );

        await expect(first)
          .resolves.toBe(
            texture,
          );

        await expect(second)
          .resolves.toBe(
            texture,
          );

        expect(
          service.getCachedRefCount(
            "texture.png",
          ),
        ).toBe(2);

        expect(loaded)
          .toEqual([
            "texture.png",
          ]);

        service.releaseAsset(
          "texture.png",
        );

        expect(
          texture.dispose,
        ).not.toHaveBeenCalled();

        service.releaseAsset(
          "texture.png",
        );

        expect(
          texture.dispose,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "AssetCache descarta recursos compartilhados de GLTF uma única vez",
      (): void => {
        const geometry = {
          dispose:
            vi.fn(),
        };

        const texture = {
          dispose:
            vi.fn(),
        };

        const material = {
          map:
            texture,
          dispose:
            vi.fn(),
        };

        const gltf = {
          scene: {
            traverse(
              callback:
                (
                  value:
                    unknown,
                ) => void,
            ): void {
              callback({
                geometry,
                material,
              });

              callback({
                geometry,
                material,
              });
            },
          },
        };

        const cache =
          new AssetCache();

        cache.set(
          "hero.glb",
          gltf,
          "gltf",
        );

        expect(
          cache.release(
            "hero.glb",
          ),
        ).toBe(true);

        expect(
          geometry.dispose,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          material.dispose,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          texture.dispose,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "dispose é terminal e limpa cache/in-flight sem permitir novo load",
      async (): Promise<void> => {
        const service =
          new AssetsManagerService(
            undefined,
            {
              async loadGLTF() {
                return {} as never;
              },

              async loadTexture() {
                return {} as never;
              },

              async loadAudio() {
                return {} as AudioBuffer;
              },

              disposeAudio(): void {},
            },
          );

        service.dispose();
        service.dispose();

        await expect(
          service.loadTexture(
            "x.png",
          ),
        ).rejects.toThrow(
          "descartado",
        );
      },
    );
  },
);
