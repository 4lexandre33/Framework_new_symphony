// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createObjectStateId,
  createObjectStateRef,
  createWorldObjectId,
  createWorldObjectRef,
  ObjectProp,
  ObjectPropError,
  sameObjectStateRef,
  sameWorldObjectRef,
} from "../src/domain/entities";

import {
  createLocationId,
  createLocationRef,
  LocationGraph,
  LocationZone,
} from "../src/domain/location";

describe(
  "Etapa 46 — World Object references",
  () => {
    it(
      "cria WorldObjectRef nominal e comparável",
      () => {
        const objectId =
          createWorldObjectId(
            "world-object.chest.01",
          );

        const left =
          createWorldObjectRef(
            objectId,
          );

        const right =
          createWorldObjectRef(
            objectId,
          );

        expect(left).toEqual({
          worldObjectId:
            "world-object.chest.01",
        });

        expect(
          sameWorldObjectRef(
            left,
            right,
          ),
        ).toBe(true);
      },
    );

    it(
      "cria ObjectStateRef opaca sem antecipar StateStore",
      () => {
        const stateId =
          createObjectStateId(
            "object-state.chest.01",
          );

        const left =
          createObjectStateRef(
            stateId,
          );

        const right =
          createObjectStateRef(
            stateId,
          );

        expect(left).toEqual({
          stateId:
            "object-state.chest.01",
        });

        expect(
          sameObjectStateRef(
            left,
            right,
          ),
        ).toBe(true);

        expect(
          Object.keys(left),
        ).not.toEqual(
          expect.arrayContaining([
            "value",
            "store",
            "database",
            "storage",
          ]),
        );
      },
    );
  },
);

describe(
  "Etapa 46 — ObjectProp",
  () => {
    it(
      "cria objeto lógico sem representação física",
      () => {
        const object =
          new ObjectProp({
            id:
              createWorldObjectId(
                "world-object.door",
              ),
            name:
              "Castle Door",
          });

        expect(object.located).toBe(
          false,
        );

        expect(
          object.toSnapshot(),
        ).toEqual({
          id:
            "world-object.door",
          name:
            "Castle Door",
          locationId: null,
          stateId: null,
        });

        expect(
          Object.keys(
            object.toSnapshot(),
          ),
        ).not.toEqual(
          expect.arrayContaining([
            "x",
            "y",
            "z",
            "position",
            "rotation",
            "transform",
            "sprite",
            "mesh",
            "collider",
            "rigidBody",
            "material",
            "texture",
          ]),
        );
      },
    );

    it(
      "associa semanticamente ObjectProp a LocationRef",
      () => {
        const village =
          new LocationZone({
            id:
              createLocationId(
                "location.village",
              ),
            name: "Village",
          });

        const graph =
          new LocationGraph({
            zones: [village],
          });

        const object =
          new ObjectProp({
            id:
              createWorldObjectId(
                "world-object.sign",
              ),
            name:
              "Village Sign",
            location:
              village.toRef(),
          });

        expect(
          object.isLocatedAt(
            village.toRef(),
          ),
        ).toBe(true);

        expect(
          graph.hasLocation(
            object.location
              ?.locationId ??
              createLocationId(
                "location.impossible",
              ),
          ),
        ).toBe(true);
      },
    );

    it(
      "relocate altera apenas associação lógica e evita mutação redundante",
      () => {
        const first =
          createLocationRef(
            createLocationId(
              "location.first",
            ),
          );

        const second =
          createLocationRef(
            createLocationId(
              "location.second",
            ),
          );

        const object =
          new ObjectProp({
            id:
              createWorldObjectId(
                "world-object.movable",
              ),
            name: "Movable",
            location: first,
          });

        expect(
          object.relocate(first),
        ).toBe(false);

        expect(
          object.relocate(second),
        ).toBe(true);

        expect(
          object.location,
        ).toBe(second);

        expect(
          object.clearLocation(),
        ).toBe(true);

        expect(
          object.clearLocation(),
        ).toBe(false);

        expect(object.located).toBe(
          false,
        );
      },
    );

    it(
      "mantém ObjectStateRef no snapshot sem conhecer implementação de state",
      () => {
        const object =
          new ObjectProp({
            id:
              createWorldObjectId(
                "world-object.chest",
              ),
            name: "Chest",
            stateRef:
              createObjectStateRef(
                createObjectStateId(
                  "object-state.chest",
                ),
              ),
          });

        expect(
          object.toSnapshot(),
        ).toEqual({
          id:
            "world-object.chest",
          name: "Chest",
          locationId: null,
          stateId:
            "object-state.chest",
        });
      },
    );

    it(
      "faz round-trip de snapshot preservando identidade/location/state",
      () => {
        const original =
          new ObjectProp({
            id:
              createWorldObjectId(
                "world-object.terminal",
              ),
            name:
              "Security Terminal",
            location:
              createLocationRef(
                createLocationId(
                  "location.control-room",
                ),
              ),
            stateRef:
              createObjectStateRef(
                createObjectStateId(
                  "object-state.terminal",
                ),
              ),
          });

        const snapshot =
          original.toSnapshot();

        const restored =
          ObjectProp.fromSnapshot(
            snapshot,
          );

        expect(
          restored.toSnapshot(),
        ).toEqual(snapshot);

        expect(
          restored.toRef(),
        ).toEqual({
          worldObjectId:
            "world-object.terminal",
        });
      },
    );

    it(
      "rejeita nome inválido",
      () => {
        expect(() =>
          new ObjectProp({
            id:
              createWorldObjectId(
                "world-object.invalid",
              ),
            name: " invalid ",
          }),
        ).toThrow(
          ObjectPropError,
        );
      },
    );

    it(
      "rejeita snapshot inválido",
      () => {
        const invalid =
          {
            id:
              "world-object.invalid",
            name: "",
            locationId: null,
            stateId: null,
          } as const;

        expect(() =>
          ObjectProp.fromSnapshot(
            invalid,
          ),
        ).toThrow(
          ObjectPropError,
        );
      },
    );
  },
);
