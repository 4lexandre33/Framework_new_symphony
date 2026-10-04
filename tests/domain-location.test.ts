// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createLocationId,
  createLocationRef,
  createLocationRelation,
  LocationGraph,
  LocationGraphError,
  LocationRelationError,
  LocationZone,
  LocationZoneError,
  sameLocationRef,
} from "../src/domain/location";

function zone(
  id: string,
  name: string,
): LocationZone {
  return new LocationZone({
    id: createLocationId(id),
    name,
  });
}

describe(
  "Etapa 45 — Location primitives",
  () => {
    it(
      "cria LocationId e LocationRef sem coordenadas",
      () => {
        const locationId =
          createLocationId(
            "location.village",
          );

        const left =
          createLocationRef(
            locationId,
          );

        const right =
          createLocationRef(
            locationId,
          );

        expect(left).toEqual({
          locationId:
            "location.village",
        });

        expect(
          sameLocationRef(
            left,
            right,
          ),
        ).toBe(true);

        expect(
          Object.keys(left),
        ).not.toEqual(
          expect.arrayContaining([
            "x",
            "y",
            "z",
            "position",
            "transform",
            "tile",
            "layer",
          ]),
        );
      },
    );

    it(
      "cria LocationZone imutável e serializável",
      () => {
        const village =
          zone(
            "location.village",
            "Village",
          );

        expect(
          village.toSnapshot(),
        ).toEqual({
          id:
            "location.village",
          name: "Village",
        });

        expect(
          village.toRef(),
        ).toEqual({
          locationId:
            "location.village",
        });

        expect(() =>
          new LocationZone({
            id:
              createLocationId(
                "location.bad",
              ),
            name: " invalid ",
          }),
        ).toThrow(
          LocationZoneError,
        );
      },
    );

    it(
      "rejeita self relation",
      () => {
        const village =
          createLocationId(
            "location.village",
          );

        expect(() =>
          createLocationRelation(
            "neighbor",
            village,
            village,
          ),
        ).toThrow(
          LocationRelationError,
        );
      },
    );
  },
);

describe(
  "Etapa 45 — LocationGraph",
  () => {
    it(
      "modela connectivity simétrica",
      () => {
        const village =
          zone(
            "location.village",
            "Village",
          );

        const road =
          zone(
            "location.road",
            "Road",
          );

        const graph =
          new LocationGraph({
            zones: [
              village,
              road,
            ],
            relations: [
              createLocationRelation(
                "connected-to",
                village.id,
                road.id,
              ),
            ],
          });

        expect(
          graph.hasDirectRelation(
            village.id,
            road.id,
            "connected-to",
          ),
        ).toBe(true);

        expect(
          graph.hasDirectRelation(
            road.id,
            village.id,
            "connected-to",
          ),
        ).toBe(true);
      },
    );

    it(
      "permite ciclos de connectivity e encontra path determinístico",
      () => {
        const a =
          zone(
            "location.a",
            "A",
          );

        const b =
          zone(
            "location.b",
            "B",
          );

        const c =
          zone(
            "location.c",
            "C",
          );

        const graph =
          new LocationGraph({
            zones: [a, b, c],
            relations: [
              createLocationRelation(
                "connected-to",
                a.id,
                b.id,
              ),
              createLocationRelation(
                "connected-to",
                b.id,
                c.id,
              ),
              createLocationRelation(
                "connected-to",
                c.id,
                a.id,
              ),
            ],
          });

        expect(
          graph.findPath(
            a.id,
            c.id,
          ),
        ).toEqual([
          "location.a",
          "location.c",
        ]);
      },
    );

    it(
      "resolve containment transitivo",
      () => {
        const world =
          zone(
            "location.world",
            "World",
          );

        const town =
          zone(
            "location.town",
            "Town",
          );

        const tavern =
          zone(
            "location.tavern",
            "Tavern",
          );

        const graph =
          new LocationGraph({
            zones: [
              world,
              town,
              tavern,
            ],
            relations: [
              createLocationRelation(
                "contains",
                world.id,
                town.id,
              ),
              createLocationRelation(
                "contains",
                town.id,
                tavern.id,
              ),
            ],
          });

        expect(
          graph.getDirectContents(
            world.id,
          ),
        ).toEqual([
          "location.town",
        ]);

        expect(
          graph.isContainedBy(
            tavern.id,
            world.id,
          ),
        ).toBe(true);

        expect(
          graph.isContainedBy(
            world.id,
            tavern.id,
          ),
        ).toBe(false);
      },
    );

    it(
      "rejeita ciclos de contains",
      () => {
        const a =
          zone(
            "location.a",
            "A",
          );

        const b =
          zone(
            "location.b",
            "B",
          );

        expect(() =>
          new LocationGraph({
            zones: [a, b],
            relations: [
              createLocationRelation(
                "contains",
                a.id,
                b.id,
              ),
              createLocationRelation(
                "contains",
                b.id,
                a.id,
              ),
            ],
          }),
        ).toThrow(
          LocationGraphError,
        );
      },
    );

    it(
      "rejeita LocationId duplicado",
      () => {
        const first =
          zone(
            "location.same",
            "First",
          );

        const second =
          zone(
            "location.same",
            "Second",
          );

        expect(() =>
          new LocationGraph({
            zones: [
              first,
              second,
            ],
          }),
        ).toThrow(
          LocationGraphError,
        );
      },
    );

    it(
      "rejeita relations para locations ausentes",
      () => {
        const known =
          zone(
            "location.known",
            "Known",
          );

        expect(() =>
          new LocationGraph({
            zones: [known],
            relations: [
              createLocationRelation(
                "connected-to",
                known.id,
                createLocationId(
                  "location.missing",
                ),
              ),
            ],
          }),
        ).toThrow(
          LocationGraphError,
        );
      },
    );

    it(
      "rejeita duplicate e reverse duplicate de relation simétrica",
      () => {
        const a =
          zone(
            "location.a",
            "A",
          );

        const b =
          zone(
            "location.b",
            "B",
          );

        expect(() =>
          new LocationGraph({
            zones: [a, b],
            relations: [
              createLocationRelation(
                "neighbor",
                a.id,
                b.id,
              ),
              createLocationRelation(
                "neighbor",
                b.id,
                a.id,
              ),
            ],
          }),
        ).toThrow(
          LocationGraphError,
        );
      },
    );

    it(
      "findPath ignora contains por default e permite filtro explícito",
      () => {
        const world =
          zone(
            "location.world",
            "World",
          );

        const room =
          zone(
            "location.room",
            "Room",
          );

        const graph =
          new LocationGraph({
            zones: [
              world,
              room,
            ],
            relations: [
              createLocationRelation(
                "contains",
                world.id,
                room.id,
              ),
            ],
          });

        expect(
          graph.findPath(
            world.id,
            room.id,
          ),
        ).toBeNull();

        expect(
          graph.findPath(
            world.id,
            room.id,
            {
              relationKinds: [
                "contains",
              ],
            },
          ),
        ).toEqual([
          "location.world",
          "location.room",
        ]);
      },
    );

    it(
      "falha explicitamente em query para LocationId desconhecida",
      () => {
        const known =
          zone(
            "location.known",
            "Known",
          );

        const graph =
          new LocationGraph({
            zones: [known],
          });

        expect(() =>
          graph.getLocation(
            createLocationId(
              "location.unknown",
            ),
          ),
        ).toThrow(
          LocationGraphError,
        );

        expect(() =>
          graph.findPath(
            known.id,
            createLocationId(
              "location.unknown",
            ),
          ),
        ).toThrow(
          LocationGraphError,
        );
      },
    );
  },
);
