import {
  describe,
  expect,
  it,
} from "vitest";

import * as THREE from "three";

import {
  SpringArm3D,
} from "../src/engine/camera/internal/SpringArm3D";

import {
  TraumaCameraShake,
} from "../src/engine/camera/internal/TraumaCameraShake";

import {
  PostProcessingPipeline,
} from "../src/engine/vfx/internal/PostProcessingPipeline";

describe(
  "Layer 1 Stage 80 — Camera/VFX presentation",
  (): void => {
    it(
      "SpringArm reutiliza o mesmo vetor de saída e recupera suavemente",
      (): void => {
        const arm =
          new SpringArm3D({
            targetArmLength:
              5,
            probeRadius:
              0.2,
            socketOffset: {
              x:
                0,
              y:
                0,
              z:
                0,
            },
            targetOffset: {
              x:
                0,
              y:
                0,
              z:
                0,
            },
            enableCollision:
              false,
            smoothTimeSeconds:
              0.1,
          });

        const rotation =
          new THREE.Quaternion();

        const first =
          arm.computeCameraPosition(
            {
              x:
                0,
              y:
                0,
              z:
                0,
            },
            rotation,
            null,
            0.016,
          );

        const second =
          arm.computeCameraPosition(
            {
              x:
                1,
              y:
                0,
              z:
                0,
            },
            rotation,
            null,
            0.016,
          );

        expect(
          second,
        ).toBe(
          first,
        );
      },
    );

    it(
      "TraumaCameraShake clampa stalls e zera após decadência suficiente",
      (): void => {
        const shake =
          new TraumaCameraShake({
            maxTrauma:
              1,
            traumaDecayRate:
              4,
          });

        shake.addTrauma(
          1,
        );

        shake.update(
          10,
        );

        expect(
          shake.currentTrauma,
        ).toBe(
          0,
        );
      },
    );

    it(
      "TraumaCameraShake preserva decay por tempo decorrido e clampa apenas a fase do ruído",
      (): void => {
        const decayShake =
          new TraumaCameraShake({
            maxTrauma:
              1,
            traumaDecayRate:
              1,
            frequencyHz:
              20,
          });

        decayShake.addTrauma(
          0.8,
        );

        decayShake.update(
          0.1,
        );

        expect(
          decayShake.currentTrauma,
        ).toBeCloseTo(
          0.7,
          10,
        );

        decayShake.update(
          1,
        );

        expect(
          decayShake.currentTrauma,
        ).toBe(
          0,
        );

        const stalledPhase =
          new TraumaCameraShake({
            maxTrauma:
              1,
            traumaDecayRate:
              0,
            frequencyHz:
              20,
          });

        const quarterSecondPhase =
          new TraumaCameraShake({
            maxTrauma:
              1,
            traumaDecayRate:
              0,
            frequencyHz:
              20,
          });

        stalledPhase.addTrauma(
          1,
        );

        quarterSecondPhase.addTrauma(
          1,
        );

        const stalled =
          stalledPhase.update(
            10,
          );

        const clamped =
          quarterSecondPhase.update(
            0.25,
          );

        expect(
          stalled.positionOffset.x,
        ).toBeCloseTo(
          clamped.positionOffset.x,
          12,
        );

        expect(
          stalled.positionOffset.y,
        ).toBeCloseTo(
          clamped.positionOffset.y,
          12,
        );

        expect(
          stalled.positionOffset.z,
        ).toBeCloseTo(
          clamped.positionOffset.z,
          12,
        );

        expect(
          stalled.rotationOffset.x,
        ).toBeCloseTo(
          clamped.rotationOffset.x,
          12,
        );

        expect(
          stalled.rotationOffset.y,
        ).toBeCloseTo(
          clamped.rotationOffset.y,
          12,
        );

        expect(
          stalled.rotationOffset.z,
        ).toBeCloseTo(
          clamped.rotationOffset.z,
          12,
        );
      },
    );

    it(
      "PostFX restaura bloom base após pulso e clamp de delta",
      (): void => {
        const pipeline =
          new PostProcessingPipeline();

        pipeline.updateConfig({
          bloomStrength:
            1.25,
        });

        pipeline.triggerBloomPulse(
          4,
          0.2,
        );

        pipeline.update(
          10,
        );

        expect(
          pipeline.getConfig()
            .bloomStrength,
        ).toBe(
          1.25,
        );
      },
    );
  },
);
