// @vitest-environment node

import * as THREE from "three";

import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { SceneGraphManager } from "../src/engine/render/internal/SceneGraphManager";

describe(
  "Etapa 76 — SceneGraphManager",
  () => {
    it(
      "preserva resources compartilhados até o último owner sair",
      (): void => {
        const manager =
          new SceneGraphManager();

        const geometry =
          new THREE.BoxGeometry(
            1,
            1,
            1,
          );

        const texture =
          new THREE.Texture();

        const material =
          new THREE.MeshBasicMaterial({
            map:
              texture,
          });

        const geometryDispose =
          vi.spyOn(
            geometry,
            "dispose",
          );

        const materialDispose =
          vi.spyOn(
            material,
            "dispose",
          );

        const textureDispose =
          vi.spyOn(
            texture,
            "dispose",
          );

        const first =
          new THREE.Mesh(
            geometry,
            material,
          );

        const second =
          new THREE.Mesh(
            geometry,
            material,
          );

        manager.addMesh(
          "first",
          first,
        );

        manager.addMesh(
          "second",
          second,
        );

        expect(
          manager.removeMesh(
            "first",
          ),
        ).toBe(true);

        expect(
          geometryDispose,
        ).not.toHaveBeenCalled();

        expect(
          materialDispose,
        ).not.toHaveBeenCalled();

        expect(
          textureDispose,
        ).not.toHaveBeenCalled();

        expect(
          manager.removeMesh(
            "second",
          ),
        ).toBe(true);

        expect(
          geometryDispose,
        ).toHaveBeenCalledTimes(1);

        expect(
          materialDispose,
        ).toHaveBeenCalledTimes(1);

        expect(
          textureDispose,
        ).toHaveBeenCalledTimes(1);
      },
    );

    it(
      "substituição de key libera recursos do objeto anterior",
      (): void => {
        const manager =
          new SceneGraphManager();

        const firstGeometry =
          new THREE.BoxGeometry();

        const firstMaterial =
          new THREE.MeshBasicMaterial();

        const geometryDispose =
          vi.spyOn(
            firstGeometry,
            "dispose",
          );

        const materialDispose =
          vi.spyOn(
            firstMaterial,
            "dispose",
          );

        manager.addMesh(
          "player",
          new THREE.Mesh(
            firstGeometry,
            firstMaterial,
          ),
        );

        const second =
          new THREE.Mesh(
            new THREE.BoxGeometry(),
            new THREE.MeshBasicMaterial(),
          );

        manager.addMesh(
          "player",
          second,
        );

        expect(
          geometryDispose,
        ).toHaveBeenCalledTimes(1);

        expect(
          materialDispose,
        ).toHaveBeenCalledTimes(1);

        expect(
          manager.getMesh(
            "player",
          ),
        ).toBe(second);
      },
    );

    it(
      "não permite o mesmo Object3D com duas keys",
      (): void => {
        const manager =
          new SceneGraphManager();

        const mesh =
          new THREE.Mesh(
            new THREE.BoxGeometry(),
            new THREE.MeshBasicMaterial(),
          );

        manager.addMesh(
          "a",
          mesh,
        );

        expect(
          (): void => {
            manager.addMesh(
              "b",
              mesh,
            );
          },
        ).toThrow();
      },
    );

    it(
      "dispose é idempotente",
      (): void => {
        const manager =
          new SceneGraphManager();

        const geometry =
          new THREE.BoxGeometry();

        const material =
          new THREE.MeshBasicMaterial();

        const geometryDispose =
          vi.spyOn(
            geometry,
            "dispose",
          );

        const materialDispose =
          vi.spyOn(
            material,
            "dispose",
          );

        manager.addMesh(
          "mesh",
          new THREE.Mesh(
            geometry,
            material,
          ),
        );

        manager.dispose();
        manager.dispose();

        expect(
          geometryDispose,
        ).toHaveBeenCalledTimes(1);

        expect(
          materialDispose,
        ).toHaveBeenCalledTimes(1);
      },
    );
  },
);
