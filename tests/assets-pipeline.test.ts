import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  AssetCache,
} from "../src/engine/assets/internal/AssetCache";

import {
  createAssetsPlugin,
} from "../src/plugins/assets/plugin";

import {
  AssetsToken,
} from "../src/tokens/assets";

describe(
  "Camada 3: Asset Pipeline & VRAM Cache Tests",
  (): void => {
    let cache:
      AssetCache;

    beforeEach(
      (): void => {
        vi.clearAllMocks();

        cache =
          new AssetCache();
      },
    );

    it(
      "deve armazenar um asset no cache e inicializar o refCount em 1",
      (): void => {
        const mockTexture = {
          id:
            "tex_01",

          dispose:
            vi.fn(),
        };

        cache.set(
          "models/character.png",
          mockTexture,
          "texture",
        );

        expect(
          cache.has(
            "models/character.png",
          ),
        ).toBe(
          true,
        );

        expect(
          cache.get(
            "models/character.png",
          ),
        ).toBe(
          mockTexture,
        );
      },
    );

    it(
      "deve incrementar o refCount ao reter o asset existente",
      (): void => {
        const mockTexture = {
          id:
            "tex_01",

          dispose:
            vi.fn(),
        };

        cache.set(
          "models/character.png",
          mockTexture,
          "texture",
        );

        const retained =
          cache.retain(
            "models/character.png",
          );

        expect(
          retained,
        ).toBe(
          true,
        );

        const releasedFirst =
          cache.release(
            "models/character.png",
          );

        expect(
          releasedFirst,
        ).toBe(
          false,
        );

        expect(
          cache.has(
            "models/character.png",
          ),
        ).toBe(
          true,
        );

        expect(
          mockTexture.dispose,
        ).not.toHaveBeenCalled();

        const releasedFinal =
          cache.release(
            "models/character.png",
          );

        expect(
          releasedFinal,
        ).toBe(
          true,
        );

        expect(
          cache.has(
            "models/character.png",
          ),
        ).toBe(
          false,
        );

        expect(
          mockTexture.dispose,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "deve descartar geometrias e materiais de modelos GLTF recursivamente ao zerar a contagem de referências",
      (): void => {
        const mockGeometry = {
          dispose:
            vi.fn(),
        };

        const mockMaterial = {
          dispose:
            vi.fn(),
        };

        const mockGLTF = {
          scene: {
            traverse(
              callback:
                (
                  object: {
                    geometry?: {
                      dispose():
                        void;
                    };

                    material?: {
                      dispose():
                        void;
                    };
                  },
                ) => void,
            ): void {
              callback({
                geometry:
                  mockGeometry,

                material:
                  mockMaterial,
              });
            },
          },
        };

        cache.set(
          "models/hero.glb",
          mockGLTF,
          "gltf",
        );

        expect(
          cache.has(
            "models/hero.glb",
          ),
        ).toBe(
          true,
        );

        const released =
          cache.release(
            "models/hero.glb",
          );

        expect(
          released,
        ).toBe(
          true,
        );

        expect(
          cache.has(
            "models/hero.glb",
          ),
        ).toBe(
          false,
        );

        expect(
          mockGeometry.dispose,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          mockMaterial.dispose,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "deve limpar completamente o cache e chamar dispose em todos os recursos cadastrados",
      (): void => {
        const mockTexture1 = {
          dispose:
            vi.fn(),
        };

        const mockTexture2 = {
          dispose:
            vi.fn(),
        };

        cache.set(
          "tex1.png",
          mockTexture1,
          "texture",
        );

        cache.set(
          "tex2.png",
          mockTexture2,
          "texture",
        );

        cache.clear();

        expect(
          cache.has(
            "tex1.png",
          ),
        ).toBe(
          false,
        );

        expect(
          cache.has(
            "tex2.png",
          ),
        ).toBe(
          false,
        );

        expect(
          mockTexture1.dispose,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          mockTexture2.dispose,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "deve registrar o plugin de Assets no Kernel com manifesto versão 1.0.0 e capability AssetsToken",
      (): void => {
        const plugin =
          createAssetsPlugin();

        expect(
          plugin.manifest.id,
        ).toBe(
          "game.assets",
        );

        expect(
          plugin.manifest.version,
        ).toBe(
          "1.0.0",
        );

        const providedCapabilities =
          plugin.manifest
            .capabilities
            ?.provides ??
          [];

        expect(
          providedCapabilities.some(
            (
              capability,
            ): boolean =>
              capability.id ===
                AssetsToken.id &&
              capability.version ===
                "1.0.0",
          ),
        ).toBe(
          true,
        );
      },
    );
  },
);