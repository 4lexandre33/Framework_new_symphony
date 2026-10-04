import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

import type {
  SimulationTick,
} from "../time/SimulationTick";

export type DomainEventSourceTypeId =
  DomainId<
    "domain-event-source-type"
  >;

export type DomainEventSourceId =
  DomainId<
    "domain-event-source"
  >;

export interface DomainEventSourceRef {
  readonly typeId:
    DomainEventSourceTypeId;
  readonly sourceId:
    DomainEventSourceId;
}

export interface DomainEventMetadata {
  /**
   * Ordem lógica monotônica fornecida pelo produtor/orquestrador.
   *
   * O domínio não mantém contador global implícito.
   */
  readonly sequence:
    number;

  /**
   * Tick determinístico em que o fato ocorreu.
   *
   * Não é timestamp civil nem milliseconds.
   */
  readonly tick:
    SimulationTick;

  /**
   * Origem lógica opaca do evento.
   *
   * Exemplos possíveis de typeId:
   * - source.agent
   * - source.world-object
   * - source.location
   * - source.quest
   *
   * A referência não importa as entidades concretas para evitar acoplamento.
   */
  readonly source:
    DomainEventSourceRef | null;
}

export type DomainEventMetadataErrorCode =
  | "invalid-sequence";

export class DomainEventMetadataError
  extends Error {
  public readonly name =
    "DomainEventMetadataError";

  public constructor(
    public readonly code:
      DomainEventMetadataErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function createDomainEventSourceTypeId(
  value: string,
): DomainEventSourceTypeId {
  return createDomainId<
    "domain-event-source-type"
  >(value);
}

export function createDomainEventSourceId(
  value: string,
): DomainEventSourceId {
  return createDomainId<
    "domain-event-source"
  >(value);
}

export function createDomainEventSourceRef(
  typeId:
    DomainEventSourceTypeId,
  sourceId:
    DomainEventSourceId,
): DomainEventSourceRef {
  return Object.freeze({
    typeId,
    sourceId,
  });
}

export function createDomainEventMetadata(
  sequence: number,
  tick: SimulationTick,
  source:
    DomainEventSourceRef | null =
      null,
): DomainEventMetadata {
  if (
    !Number.isSafeInteger(
      sequence,
    ) ||
    sequence < 0
  ) {
    throw new DomainEventMetadataError(
      "invalid-sequence",
      "DomainEventMetadata.sequence deve ser um inteiro seguro maior ou igual a 0.",
    );
  }

  return Object.freeze({
    sequence,
    tick,
    source,
  });
}
