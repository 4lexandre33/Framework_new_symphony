// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildExpectedPublicFacade,
  comparePublicApiBaselineCompatibility,
} from "../scripts/architecture/lib/layer1-public-api-v1.mjs";

const BASELINE_ENTRY =
  Object.freeze({
    key: "render",
    capabilityId:
      "game.render",
    capabilityVersion:
      "1.0.0",
    facade:
      Object.freeze({
        path:
          "src/engine/render/public/index.ts",
        fingerprint:
          "facade-a",
      }),
    contracts:
      Object.freeze([
        Object.freeze({
          path:
            "src/contracts/render/types.ts",
          fingerprint:
            "contract-a",
        }),
      ]),
    tokens:
      Object.freeze([
        Object.freeze({
          path:
            "src/tokens/render.ts",
          capabilityId:
            "game.render",
          version:
            "1.0.0",
          primary:
            true,
          fingerprint:
            "token-a",
        }),
      ]),
  });

const BASELINE =
  Object.freeze({
    modules:
      Object.freeze([
        BASELINE_ENTRY,
      ]),
  });

describe(
  "Etapa 72 — public API policy self-test",
  () => {
    it(
      "gera facade exclusivamente a partir de contracts + tokens declarados",
      () => {
        const facade =
          buildExpectedPublicFacade({
            engine: {
              publicRoot:
                "src/engine/steam/public",
            },
            contracts: [
              "src/contracts/steam/types.ts",
              "src/contracts/steam/net-types.ts",
            ],
            tokens: [
              {
                path:
                  "src/tokens/steam.ts",
              },
              {
                path:
                  "src/tokens/steam-net.ts",
              },
            ],
          });

        expect(
          facade.exportSpecifiers,
        ).toEqual([
          "../../../contracts/steam/types",
          "../../../contracts/steam/net-types",
          "../../../tokens/steam",
          "../../../tokens/steam-net",
        ]);

        expect(
          facade.exportSpecifiers
            .some(
              (specifier: string) =>
                specifier.includes(
                  "internal",
                ),
            ),
        ).toBe(false);
      },
    );

    it(
      "permite novo módulo sem invalidar API baseline anterior",
      () => {
        const result =
          comparePublicApiBaselineCompatibility(
            BASELINE,
            [
              BASELINE_ENTRY,
              {
                ...BASELINE_ENTRY,
                key:
                  "weather",
                capabilityId:
                  "game.weather",
                facade: {
                  path:
                    "src/engine/weather/public/index.ts",
                  fingerprint:
                    "facade-weather",
                },
                contracts: [
                  {
                    path:
                      "src/contracts/weather/types.ts",
                    fingerprint:
                      "contract-weather",
                  },
                ],
                tokens: [
                  {
                    path:
                      "src/tokens/weather.ts",
                    capabilityId:
                      "game.weather",
                    version:
                      "1.0.0",
                    primary:
                      true,
                    fingerprint:
                      "token-weather",
                  },
                ],
              },
            ],
          );

        expect(result.ok)
          .toBe(true);

        expect(
          result.additionalModuleKeys,
        ).toEqual([
          "weather",
        ]);
      },
    );

    it(
      "reprova alteração sem recertificação em contract existente",
      () => {
        const changed = {
          ...BASELINE_ENTRY,
          contracts: [
            {
              path:
                "src/contracts/render/types.ts",
              fingerprint:
                "changed-contract",
            },
          ],
        };

        const result =
          comparePublicApiBaselineCompatibility(
            BASELINE,
            [
              changed,
            ],
          );

        expect(result.ok)
          .toBe(false);

        expect(
          result.violations
            .some(
              (item) =>
                item.code ===
                "L1API044",
            ),
        ).toBe(true);
      },
    );

    it(
      "reprova alteração sem recertificação em token existente",
      () => {
        const changed = {
          ...BASELINE_ENTRY,
          tokens: [
            {
              ...BASELINE_ENTRY
                .tokens[0],
              fingerprint:
                "changed-token",
            },
          ],
        };

        const result =
          comparePublicApiBaselineCompatibility(
            BASELINE,
            [
              changed,
            ],
          );

        expect(result.ok)
          .toBe(false);

        expect(
          result.violations
            .some(
              (item) =>
                item.code ===
                "L1API046",
            ),
        ).toBe(true);
      },
    );

    it(
      "reprova mudança de capability identity/version da baseline",
      () => {
        const changed = {
          ...BASELINE_ENTRY,
          capabilityVersion:
            "2.0.0",
        };

        const result =
          comparePublicApiBaselineCompatibility(
            BASELINE,
            [
              changed,
            ],
          );

        expect(result.ok)
          .toBe(false);

        expect(
          result.violations
            .some(
              (item) =>
                item.code ===
                "L1API041",
            ),
        ).toBe(true);
      },
    );
  },
);
