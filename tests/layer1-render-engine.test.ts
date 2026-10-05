// @vitest-environment jsdom

import type * as THREE from "three";

import {
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { ThreeRenderEngine } from "../src/engine/render/internal/ThreeRenderEngine";

class FakeRenderer {
  public readonly domElement:
    HTMLCanvasElement;

  public readonly shadowMap = {
    enabled:
      false,
    type:
      0,
  };

  public readonly renderLists = {
    dispose:
      (): void => {
        this.renderListsDisposeCalls +=
          1;
      },
  };

  public outputColorSpace:
    unknown = null;

  public renderCalls =
    0;

  public disposeCalls =
    0;

  public resetStateCalls =
    0;

  public renderListsDisposeCalls =
    0;

  public animationLoopNullCalls =
    0;

  public sizeCalls:
    readonly [
      number,
      number,
      boolean,
    ][] = [];

  public pixelRatioCalls:
    number[] = [];

  public constructor(
    canvas:
      HTMLCanvasElement,
  ) {
    this.domElement =
      canvas;
  }

  public setPixelRatio(
    value: number,
  ): void {
    this.pixelRatioCalls.push(
      value,
    );
  }

  public setSize(
    width: number,
    height: number,
    updateStyle: boolean,
  ): void {
    this.sizeCalls = [
      ...this.sizeCalls,
      [
        width,
        height,
        updateStyle,
      ],
    ];
  }

  public render(): void {
    this.renderCalls +=
      1;
  }

  public resetState(): void {
    this.resetStateCalls +=
      1;
  }

  public setAnimationLoop(
    callback: null,
  ): void {
    if (
      callback ===
      null
    ) {
      this.animationLoopNullCalls +=
        1;
    }
  }

  public dispose(): void {
    this.disposeCalls +=
      1;
  }
}

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

function createEngine(
  canvas?: HTMLCanvasElement,
): {
  readonly engine: ThreeRenderEngine;
  readonly renderer: FakeRenderer;
} {
  let renderer:
    FakeRenderer |
    null = null;

  const engine =
    new ThreeRenderEngine(
      canvas,
      {
        hostWindow:
          window,
        hostDocument:
          document,
        rendererFactory:
          (
            target,
          ): THREE.WebGLRenderer => {
            renderer =
              new FakeRenderer(
                target,
              );

            return renderer as unknown as THREE.WebGLRenderer;
          },
      },
    );

  if (
    renderer ===
    null
  ) {
    throw new Error(
      "fake renderer não criado.",
    );
  }

  return {
    engine,
    renderer,
  };
}

describe(
  "Etapa 76 — ThreeRenderEngine",
  () => {
    beforeEach(
      (): void => {
        document.body.innerHTML =
          '<div id="app"></div>';

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
          1,
        );
      },
    );

    it(
      "context loss pausa render e restore retoma",
      (): void => {
        const canvas =
          document.createElement(
            "canvas",
          );

        document.body.appendChild(
          canvas,
        );

        const {
          engine,
          renderer,
        } =
          createEngine(
            canvas,
          );

        engine.render(
          0.5,
          1 /
            60,
        );

        expect(
          renderer.renderCalls,
        ).toBe(1);

        const lost =
          new Event(
            "webglcontextlost",
            {
              cancelable:
                true,
            },
          );

        canvas.dispatchEvent(
          lost,
        );

        expect(
          lost.defaultPrevented,
        ).toBe(true);

        engine.render(
          0.5,
          1 /
            60,
        );

        expect(
          renderer.renderCalls,
        ).toBe(1);

        canvas.dispatchEvent(
          new Event(
            "webglcontextrestored",
          ),
        );

        expect(
          renderer.resetStateCalls,
        ).toBe(1);

        engine.render(
          0.5,
          1 /
            60,
        );

        expect(
          renderer.renderCalls,
        ).toBe(2);
      },
    );

    it(
      "dispose é idempotente e preserva canvas fornecido externamente",
      (): void => {
        const canvas =
          document.createElement(
            "canvas",
          );

        document.body.appendChild(
          canvas,
        );

        const {
          engine,
          renderer,
        } =
          createEngine(
            canvas,
          );

        engine.dispose();
        engine.dispose();

        expect(
          renderer.disposeCalls,
        ).toBe(1);

        expect(
          renderer.renderListsDisposeCalls,
        ).toBe(1);

        expect(
          renderer.animationLoopNullCalls,
        ).toBe(1);

        expect(
          canvas.parentNode,
        ).not.toBeNull();

        canvas.dispatchEvent(
          new Event(
            "webglcontextrestored",
          ),
        );

        expect(
          renderer.resetStateCalls,
        ).toBe(0);
      },
    );

    it(
      "remove somente canvas criado pelo próprio engine",
      (): void => {
        const {
          engine,
        } =
          createEngine();

        const canvas =
          engine.getCanvas();

        expect(
          canvas.parentNode,
        ).not.toBeNull();

        engine.dispose();

        expect(
          canvas.parentNode,
        ).toBeNull();
      },
    );

    it(
      "resize aplica dimensões seguras e pixel ratio governado",
      (): void => {
        const canvas =
          document.createElement(
            "canvas",
          );

        const {
          engine,
          renderer,
        } =
          createEngine(
            canvas,
          );

        engine.resize(
          640.8,
          360.2,
          9,
        );

        expect(
          engine.getViewportDimensions(),
        ).toEqual({
          width:
            640,
          height:
            360,
          aspectRatio:
            640 /
            360,
          pixelRatio:
            2,
        });

        expect(
          renderer.pixelRatioCalls.at(
            -1,
          ),
        ).toBe(2);

        expect(
          renderer.sizeCalls.at(
            -1,
          ),
        ).toEqual([
          640,
          360,
          false,
        ]);
      },
    );
  },
);
