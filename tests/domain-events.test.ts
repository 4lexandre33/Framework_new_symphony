// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createDomainEvent,
  createDomainEventId,
  createDomainEventMetadata,
  createDomainEventSourceId,
  createDomainEventSourceRef,
  createDomainEventSourceTypeId,
  createDomainEventTypeId,
  DomainEventBatch,
  DomainEventBatchError,
  DomainEventMetadataError,
} from "../src/domain/events";

import {
  createSimulationTick,
} from "../src/domain/time";

function createTestEvent(
  id: string,
  type: string,
  sequence: number,
  tick: number,
  payload:
    | boolean
    | number
    | string
    | {
        readonly [
          key: string
        ]:
          boolean |
          number |
          string;
      },
) {
  return createDomainEvent({
    id:
      createDomainEventId(
        id,
      ),
    typeId:
      createDomainEventTypeId(
        type,
      ),
    metadata:
      createDomainEventMetadata(
        sequence,
        createSimulationTick(
          tick,
        ),
      ),
    payload,
  });
}

describe(
  "Etapa 49 — DomainEvent metadata",
  () => {
    it(
      "cria metadata determinística com source lógico opaco",
      () => {
        const source =
          createDomainEventSourceRef(
            createDomainEventSourceTypeId(
              "source.agent",
            ),
            createDomainEventSourceId(
              "agent.player",
            ),
          );

        const metadata =
          createDomainEventMetadata(
            42,
            createSimulationTick(
              120,
            ),
            source,
          );

        expect(metadata).toEqual({
          sequence: 42,
          tick: 120,
          source: {
            typeId:
              "source.agent",
            sourceId:
              "agent.player",
          },
        });

        expect(
          Object.isFrozen(
            metadata,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            source,
          ),
        ).toBe(true);
      },
    );

    it(
      "rejeita sequence inválida",
      () => {
        expect(() =>
          createDomainEventMetadata(
            -1,
            createSimulationTick(
              0,
            ),
          ),
        ).toThrow(
          DomainEventMetadataError,
        );

        expect(() =>
          createDomainEventMetadata(
            1.5,
            createSimulationTick(
              0,
            ),
          ),
        ).toThrow(
          DomainEventMetadataError,
        );
      },
    );
  },
);

describe(
  "Etapa 49 — DomainEvent",
  () => {
    it(
      "cria evento imutável com payload tipado",
      () => {
        const event =
          createDomainEvent({
            id:
              createDomainEventId(
                "event.001",
              ),
            typeId:
              createDomainEventTypeId(
                "event.location-entered",
              ),
            metadata:
              createDomainEventMetadata(
                7,
                createSimulationTick(
                  90,
                ),
              ),
            payload: {
              agentId:
                "agent.player",
              locationId:
                "location.village",
            },
          });

        expect(event).toEqual({
          id: "event.001",
          typeId:
            "event.location-entered",
          metadata: {
            sequence: 7,
            tick: 90,
            source: null,
          },
          payload: {
            agentId:
              "agent.player",
            locationId:
              "location.village",
          },
        });

        expect(
          Object.isFrozen(event),
        ).toBe(true);

        expect(
          Object.isFrozen(
            event.payload,
          ),
        ).toBe(true);
      },
    );

    it(
      "copia profundamente o payload e bloqueia mutação externa",
      () => {
        const source = {
          value: 10,
          nested: {
            active: true,
          },
        };

        const event =
          createDomainEvent({
            id:
              createDomainEventId(
                "event.002",
              ),
            typeId:
              createDomainEventTypeId(
                "event.state-changed",
              ),
            metadata:
              createDomainEventMetadata(
                8,
                createSimulationTick(
                  91,
                ),
              ),
            payload: source,
          });

        source.value = 99;
        source.nested.active =
          false;

        expect(
          event.payload,
        ).toEqual({
          value: 10,
          nested: {
            active: true,
          },
        });
      },
    );
  },
);

describe(
  "Etapa 49 — DomainEventBatch",
  () => {
    it(
      "permite batch vazio",
      () => {
        const batch =
          new DomainEventBatch(
            [],
          );

        expect(batch.size).toBe(
          0,
        );

        expect(
          batch.isEmpty,
        ).toBe(true);

        expect(batch.first).toBe(
          null,
        );

        expect(batch.last).toBe(
          null,
        );
      },
    );

    it(
      "ordena deterministicamente por sequence",
      () => {
        const third =
          createTestEvent(
            "event.3",
            "event.test",
            30,
            300,
            3,
          );

        const first =
          createTestEvent(
            "event.1",
            "event.test",
            10,
            100,
            1,
          );

        const second =
          createTestEvent(
            "event.2",
            "event.test",
            20,
            200,
            2,
          );

        const batch =
          new DomainEventBatch(
            [
              third,
              first,
              second,
            ],
          );

        expect(
          batch
            .asReadonlyArray()
            .map(
              (event) =>
                event.metadata
                  .sequence,
            ),
        ).toEqual([
          10,
          20,
          30,
        ]);

        expect(
          Object.isFrozen(
            batch
              .asReadonlyArray(),
          ),
        ).toBe(true);

        expect(batch.first).toBe(
          first,
        );

        expect(batch.last).toBe(
          third,
        );
      },
    );

    it(
      "permite gaps de sequence",
      () => {
        const batch =
          new DomainEventBatch([
            createTestEvent(
              "event.a",
              "event.test",
              10,
              100,
              true,
            ),
            createTestEvent(
              "event.b",
              "event.test",
              50,
              101,
              false,
            ),
          ]);

        expect(batch.size).toBe(
          2,
        );
      },
    );

    it(
      "rejeita DomainEventId duplicado",
      () => {
        expect(() =>
          new DomainEventBatch([
            createTestEvent(
              "event.same",
              "event.a",
              1,
              1,
              true,
            ),
            createTestEvent(
              "event.same",
              "event.b",
              2,
              2,
              false,
            ),
          ]),
        ).toThrow(
          DomainEventBatchError,
        );
      },
    );

    it(
      "rejeita sequence duplicada",
      () => {
        expect(() =>
          new DomainEventBatch([
            createTestEvent(
              "event.a",
              "event.a",
              5,
              10,
              true,
            ),
            createTestEvent(
              "event.b",
              "event.b",
              5,
              10,
              false,
            ),
          ]),
        ).toThrow(
          DomainEventBatchError,
        );
      },
    );

    it(
      "rejeita regressão de tick na ordem lógica",
      () => {
        expect(() =>
          new DomainEventBatch([
            createTestEvent(
              "event.a",
              "event.test",
              10,
              100,
              true,
            ),
            createTestEvent(
              "event.b",
              "event.test",
              20,
              99,
              false,
            ),
          ]),
        ).toThrow(
          DomainEventBatchError,
        );
      },
    );

    it(
      "aceita múltiplos eventos no mesmo tick com sequences distintas",
      () => {
        const batch =
          new DomainEventBatch([
            createTestEvent(
              "event.a",
              "event.test",
              1,
              50,
              true,
            ),
            createTestEvent(
              "event.b",
              "event.test",
              2,
              50,
              false,
            ),
          ]);

        expect(batch.size).toBe(
          2,
        );
      },
    );

    it(
      "consulta por id, index e tipo sem dispatch",
      () => {
        const typeA =
          "event.type-a";

        const first =
          createTestEvent(
            "event.a",
            typeA,
            1,
            10,
            {
              value: 1,
            },
          );

        const second =
          createTestEvent(
            "event.b",
            "event.type-b",
            2,
            11,
            {
              value: 2,
            },
          );

        const third =
          createTestEvent(
            "event.c",
            typeA,
            3,
            12,
            {
              value: 3,
            },
          );

        const batch =
          new DomainEventBatch(
            [
              first,
              second,
              third,
            ],
          );

        expect(
          batch.hasEvent(
            first.id,
          ),
        ).toBe(true);

        expect(
          batch.at(1),
        ).toBe(second);

        expect(
          batch.filterByType(
            first.typeId,
          ),
        ).toEqual([
          first,
          third,
        ]);

        let count = 0;

        batch.forEach(() => {
          count += 1;
        });

        expect(count).toBe(3);
      },
    );
  },
);
