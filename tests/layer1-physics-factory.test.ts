// @vitest-environment node

import RAPIER from "@dimforge/rapier3d-compat";

import {
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import { RigidBodyFactory } from "../src/engine/physics/internal/RigidBodyFactory";

describe(
  "Etapa 77 — physics descriptor validation",
  () => {
    beforeAll(
      async (): Promise<void> => {
        await RAPIER.init();
      },
    );

    it(
      "rejeita quaternion de norma zero",
      (): void => {
        expect(
          (): void => {
            RigidBodyFactory
              .createRigidBodyDesc({
                bodyType:
                  "dynamic",
                rotation: {
                  x:
                    0,
                  y:
                    0,
                  z:
                    0,
                  w:
                    0,
                },
              });
          },
        ).toThrow();
      },
    );

    it(
      "rejeita dimensões inválidas de collider",
      (): void => {
        expect(
          (): void => {
            RigidBodyFactory
              .createColliderDesc({
                shapeType:
                  "sphere",
                radius:
                  0,
              });
          },
        ).toThrow();

        expect(
          (): void => {
            RigidBodyFactory
              .createColliderDesc({
                shapeType:
                  "box",
                halfExtents: {
                  x:
                    1,
                  y:
                    -1,
                  z:
                    1,
                },
              });
          },
        ).toThrow();
      },
    );

    it(
      "rejeita trimesh com index fora do vertex range",
      (): void => {
        expect(
          (): void => {
            RigidBodyFactory
              .createColliderDesc({
                shapeType:
                  "trimesh",
                vertices:
                  new Float32Array([
                    0,
                    0,
                    0,
                    1,
                    0,
                    0,
                    0,
                    1,
                    0,
                  ]),
                indices:
                  new Uint32Array([
                    0,
                    1,
                    3,
                  ]),
              });
          },
        ).toThrow();
      },
    );
  },
);
