import type {
  DomainEvent,
  DomainEventPayload,
} from "./DomainEvent";

import type {
  DomainEventId,
} from "./DomainEventId";

import type {
  DomainEventTypeId,
} from "./DomainEventTypeId";

export type DomainEventBatchErrorCode =
  | "duplicate-event-id"
  | "duplicate-sequence"
  | "tick-regression";

export class DomainEventBatchError
  extends Error {
  public readonly name =
    "DomainEventBatchError";

  public constructor(
    public readonly code:
      DomainEventBatchErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function compareEventOrder(
  left:
    DomainEvent,
  right:
    DomainEvent,
): number {
  const sequenceDifference =
    left.metadata.sequence -
    right.metadata.sequence;

  if (
    sequenceDifference !==
    0
  ) {
    return sequenceDifference;
  }

  if (left.id < right.id) {
    return -1;
  }

  if (left.id > right.id) {
    return 1;
  }

  return 0;
}

/**
 * Lote imutável de DomainEvents.
 *
 * Responsabilidades:
 * - validar identidade/sequência;
 * - ordenar deterministicamente por sequence;
 * - garantir que tick não regreda ao longo da sequência lógica;
 * - fornecer consultas puras.
 *
 * NÃO transporta, publica ou despacha eventos.
 */
export class DomainEventBatch {
  private readonly events:
    readonly DomainEvent[];

  public constructor(
    events:
      readonly DomainEvent[],
  ) {
    const eventIds =
      new Set<
        DomainEventId
      >();

    const sequences =
      new Set<number>();

    const ordered =
      [...events];

    for (
      const event of
      ordered
    ) {
      if (
        eventIds.has(
          event.id,
        )
      ) {
        throw new DomainEventBatchError(
          "duplicate-event-id",
          `DomainEventId duplicado no batch: "${event.id}".`,
        );
      }

      eventIds.add(
        event.id,
      );

      if (
        sequences.has(
          event.metadata
            .sequence,
        )
      ) {
        throw new DomainEventBatchError(
          "duplicate-sequence",
          `DomainEvent sequence duplicada no batch: ${String(event.metadata.sequence)}.`,
        );
      }

      sequences.add(
        event.metadata
          .sequence,
      );
    }

    ordered.sort(
      compareEventOrder,
    );

    for (
      let index = 1;
      index <
      ordered.length;
      index += 1
    ) {
      const previous =
        ordered[index - 1];

      const current =
        ordered[index];

      if (
        previous ===
          undefined ||
        current ===
          undefined
      ) {
        continue;
      }

      if (
        current.metadata.tick <
        previous.metadata.tick
      ) {
        throw new DomainEventBatchError(
          "tick-regression",
          `DomainEvent tick regrediu da sequence ${String(previous.metadata.sequence)} para ${String(current.metadata.sequence)}.`,
        );
      }
    }

    this.events =
      Object.freeze(
        ordered,
      );
  }

  public get size():
    number {
    return this.events.length;
  }

  public get isEmpty():
    boolean {
    return (
      this.events.length ===
      0
    );
  }

  public get first():
    DomainEvent | null {
    return (
      this.events[0] ??
      null
    );
  }

  public get last():
    DomainEvent | null {
    return (
      this.events[
        this.events.length -
        1
      ] ??
      null
    );
  }

  public at(
    index: number,
  ): DomainEvent | undefined {
    return this.events[index];
  }

  public hasEvent(
    eventId:
      DomainEventId,
  ): boolean {
    for (
      const event of
      this.events
    ) {
      if (
        event.id ===
        eventId
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Itera sem materializar novo array.
   */
  public forEach(
    visitor: (
      event: DomainEvent,
      index: number,
    ) => void,
  ): void {
    for (
      let index = 0;
      index <
      this.events.length;
      index += 1
    ) {
      const event =
        this.events[index];

      if (
        event !== undefined
      ) {
        visitor(
          event,
          index,
        );
      }
    }
  }

  /**
   * Consulta tipada que aloca somente quando solicitada.
   */
  public filterByType<
    TPayload extends
      DomainEventPayload =
        DomainEventPayload,
  >(
    typeId:
      DomainEventTypeId,
  ): readonly DomainEvent<
    TPayload
  >[] {
    const result:
      DomainEvent<
        TPayload
      >[] = [];

    for (
      const event of
      this.events
    ) {
      if (
        event.typeId ===
        typeId
      ) {
        result.push(
          event as DomainEvent<
            TPayload
          >,
        );
      }
    }

    return Object.freeze(
      result,
    );
  }

  /**
   * Retorna a sequência interna readonly/frozen sem copiar.
   */
  public asReadonlyArray():
    readonly DomainEvent[] {
    return this.events;
  }
}
