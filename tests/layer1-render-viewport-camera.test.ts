// @vitest-environment jsdom

import {
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { CameraManager } from "../src/engine/render/internal/CameraManager";
import { ViewportManager } from "../src/engine/render/internal/ViewportManager";

function setWindowMetric(
  key:
    "innerWidth" |
    "innerHeight" |
    "devicePixelRatio",
  value: number,
): void {
  Object.defineProperty(
    window,
    key,
    {
      configurable:
        true,
      value,
    },
  );
}

describe(
  "Etapa 76 — ViewportManager / CameraManager",
  () => {
    beforeEach(
      (): void => {
        document.body.innerHTML =
          "";

        setWindowMetric(
          "innerWidth",
          1280,
        );

        setWindowMetric(
          "innerHeight",
          720,
        );

        setWindowMetric(
          "devicePixelRatio",
          1.5,
        );
      },
    );

    it(
      "normaliza dimensões e limita pixel ratio a 2",
      (): void => {
        const canvas =
          document.createElement(
            "canvas",
          );

        const manager =
          new ViewportManager(
            canvas,
            window,
          );

        expect(
          manager.getDimensions(),
        ).toMatchObject({
          width:
            1280,
          height:
            720,
          pixelRatio:
            1.5,
        });

        manager.setManualSize(
          800.9,
          600.4,
          8,
        );

        expect(
          manager.getDimensions(),
        ).toEqual({
          width:
            800,
          height:
            600,
          aspectRatio:
            800 /
            600,
          pixelRatio:
            2,
        });

        expect(
          canvas.style.width,
        ).toBe(
          "800px",
        );

        expect(
          canvas.style.height,
        ).toBe(
          "600px",
        );

        manager.setManualSize(
          Number.NaN,
          Number.POSITIVE_INFINITY,
          Number.NaN,
        );

        expect(
          manager.getDimensions(),
        ).toEqual({
          width:
            1,
          height:
            1,
          aspectRatio:
            1,
          pixelRatio:
            1,
        });
      },
    );

    it(
      "resize listener é idempotente e removido em dispose",
      (): void => {
        const canvas =
          document.createElement(
            "canvas",
          );

        const manager =
          new ViewportManager(
            canvas,
            window,
          );

        let calls =
          0;

        manager.onResize(
          (): void => {
            calls +=
              1;
          },
        );

        manager.attachResizeListener();
        manager.attachResizeListener();

        setWindowMetric(
          "innerWidth",
          1920,
        );

        setWindowMetric(
          "innerHeight",
          1080,
        );

        window.dispatchEvent(
          new Event(
            "resize",
          ),
        );

        expect(calls)
          .toBe(1);

        manager.dispose();
        manager.dispose();

        window.dispatchEvent(
          new Event(
            "resize",
          ),
        );

        expect(calls)
          .toBe(1);
      },
    );

    it(
      "follow camera usa scratch vectors e lerp governado",
      (): void => {
        const camera =
          new CameraManager({
            width:
              1280,
            height:
              720,
            aspectRatio:
              16 /
              9,
            pixelRatio:
              1,
          });

        camera.setMode(
          "follow",
        );

        camera.updateFollowCamera(
          {
            x:
              10,
            y:
              2,
            z:
              -3,
          },
          undefined,
          1,
        );

        const active =
          camera.getActiveCamera();

        expect(
          active.position.x,
        ).toBeCloseTo(10);

        expect(
          active.position.y,
        ).toBeCloseTo(10);

        expect(
          active.position.z,
        ).toBeCloseTo(9);
      },
    );

    it(
      "rejeita camera mode/vetores não finitos",
      (): void => {
        const camera =
          new CameraManager({
            width:
              1,
            height:
              1,
            aspectRatio:
              1,
            pixelRatio:
              1,
          });

        expect(
          (): void => {
            camera.setMode(
              "invalid" as never,
            );
          },
        ).toThrow();

        camera.setMode(
          "follow",
        );

        expect(
          (): void => {
            camera.updateFollowCamera({
              x:
                Number.NaN,
              y:
                0,
              z:
                0,
            });
          },
        ).toThrow();
      },
    );
  },
);
