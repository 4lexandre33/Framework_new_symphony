import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createDomainId,
  createVersionedSnapshot,
  domainIdToString,
  DomainIdValidationError,
  isDomainIdValue,
} from "../src/domain/entities";

import {
  domainErr,
  domainOk,
  flatMapDomainResult,
  mapDomainResult,
} from "../src/domain/evaluation";

import {
  createModId,
  createSaveSlotId,
} from "../src/domain/ports";

describe(
  "Etapa 44.0 — fundação do domínio",
  () => {
    it(
      "cria IDs nominais sem wrapper runtime",
      () => {
        const id =
          createDomainId<"agent">(
            "agent.player",
          );

        expect(id).toBe(
          "agent.player",
        );
        expect(
          domainIdToString(id),
        ).toBe("agent.player");
        expect(
          typeof id,
        ).toBe("string");
      },
    );

    it(
      "rejeita IDs ambíguos ou inválidos",
      () => {
        expect(
          isDomainIdValue(
            "valid:id-01",
          ),
        ).toBe(true);

        expect(
          isDomainIdValue(""),
        ).toBe(false);

        expect(
          isDomainIdValue(
            " invalid ",
          ),
        ).toBe(false);

        expect(() =>
          createDomainId<"item">(
            "\u0000bad",
          ),
        ).toThrow(
          DomainIdValidationError,
        );
      },
    );

    it(
      "cria IDs específicos de save e mod",
      () => {
        expect(
          createSaveSlotId(
            "slot-01",
          ),
        ).toBe("slot-01");

        expect(
          createModId(
            "mod.example",
          ),
        ).toBe("mod.example");
      },
    );

    it(
      "cria snapshots versionados determinísticos",
      () => {
        const state = {
          seed: 42,
          difficulty: "normal",
        } as const;

        const snapshot =
          createVersionedSnapshot(
            1,
            1_700_000_000_000,
            state,
          );

        expect(snapshot).toEqual({
          schemaVersion: 1,
          createdAtEpochMs:
            1_700_000_000_000,
          state,
        });
      },
    );

    it(
      "rejeita versão e timestamp inválidos",
      () => {
        expect(() =>
          createVersionedSnapshot(
            0,
            10,
            {},
          ),
        ).toThrow(RangeError);

        expect(() =>
          createVersionedSnapshot(
            1,
            -1,
            {},
          ),
        ).toThrow(RangeError);
      },
    );

    it(
      "representa sucesso e falha sem exceptions de infraestrutura",
      () => {
        const success =
          domainOk(20);

        const mapped =
          mapDomainResult(
            success,
            (value) => value * 2,
          );

        expect(mapped).toEqual({
          ok: true,
          value: 40,
        });

        const failure =
          domainErr(
            "blocked" as const,
          );

        const preserved =
          flatMapDomainResult(
            failure,
            (value: never) =>
              domainOk(value),
          );

        expect(preserved).toBe(
          failure,
        );
      },
    );
  },
);
