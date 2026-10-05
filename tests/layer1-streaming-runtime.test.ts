// @vitest-environment node

import type {
  PluginContext,
} from "@core";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  StreamingService,
} from "../src/engine/streaming/internal/StreamingService";

describe(
  "Etapa 79 — StreamingService lifecycle",
  () => {
    it(
      "clear permanece reutilizável e dispose é terminal para resources internos",
      async (): Promise<void> => {
        const events:
          string[] =
          [];

        const ctx = {
          events: {
            emit(
              type:
                string,
            ): void {
              events.push(
                type,
              );
            },
          },
        } as unknown as
          PluginContext;

        const service =
          new StreamingService(
            ctx,
          );

        service.registerSector({
          sectorCoord: {
            x:
              0,
            y:
              0,
            z:
              0,
          },
          boundsMin: {
            x:
              -10,
            y:
              -10,
            z:
              -10,
          },
          boundsMax: {
            x:
              10,
            y:
              10,
            z:
              10,
          },
          assetUrls:
            [],
        });

        await expect(
          service.loadSector({
            x:
              0,
            y:
              0,
            z:
              0,
          }),
        ).resolves.toBe(true);

        service.clear();

        service.registerSector({
          sectorCoord: {
            x:
              1,
            y:
              0,
            z:
              0,
          },
          boundsMin: {
            x:
              40,
            y:
              -10,
            z:
              -10,
          },
          boundsMax: {
            x:
              60,
            y:
              10,
            z:
              10,
          },
          assetUrls:
            [],
        });

        await expect(
          service.loadSector({
            x:
              1,
            y:
              0,
            z:
              0,
          }),
        ).resolves.toBe(true);

        expect(
          events.filter(
            (
              type,
            ): boolean =>
              type ===
              "game.streaming.sector-loaded",
          ),
        ).toHaveLength(
          2,
        );

        service.dispose();
        service.dispose();
      },
    );
  },
);
