import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

import type {
  AgentId,
} from "../entities/Agent";

export type AbilityId =
  DomainId<"ability">;

export type AbilityActionId =
  DomainId<"ability-action">;

export type AbilityTargetReferenceId =
  DomainId<"ability-target-reference">;

export function createAbilityId(
  value: string,
): AbilityId {
  return createDomainId<
    "ability"
  >(value);
}

export function createAbilityActionId(
  value: string,
): AbilityActionId {
  return createDomainId<
    "ability-action"
  >(value);
}

export function createAbilityTargetReferenceId(
  value: string,
): AbilityTargetReferenceId {
  return createDomainId<
    "ability-target-reference"
  >(value);
}

export type AbilityTarget =
  | {
      readonly kind: "self";
    }
  | {
      readonly kind: "agent";
      readonly agentId: AgentId;
    }
  | {
      /**
       * Referência lógica opaca resolvida por uma camada superior.
       *
       * Pode representar um alvo espacial, área, objeto de cenário ou outro
       * conceito sem introduzir coordenadas 2D/3D dentro do domínio.
       */
      readonly kind:
        "reference";
      readonly targetId:
        AbilityTargetReferenceId;
    };

export type AbilityActionStatus =
  | "pending"
  | "committed"
  | "resolved"
  | "cancelled";

export type AbilityActionErrorCode =
  | "invalid-transition"
  | "invalid-cancel-reason";

export class AbilityActionError
  extends Error {
  public readonly name =
    "AbilityActionError";

  public constructor(
    public readonly code:
      AbilityActionErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface AbilityActionCreateOptions {
  readonly id: AbilityActionId;
  readonly abilityId: AbilityId;
  readonly sourceAgentId: AgentId;
  readonly target: AbilityTarget;
}

export interface AbilityActionSnapshot {
  readonly id: AbilityActionId;
  readonly abilityId: AbilityId;
  readonly sourceAgentId: AgentId;
  readonly target: AbilityTarget;
  readonly status:
    AbilityActionStatus;
  readonly cancelReason:
    string | null;
}

const MAX_CANCEL_REASON_LENGTH =
  256;

function copyTarget(
  target: AbilityTarget,
): AbilityTarget {
  switch (target.kind) {
    case "self":
      return {
        kind: "self",
      };

    case "agent":
      return {
        kind: "agent",
        agentId:
          target.agentId,
      };

    case "reference":
      return {
        kind:
          "reference",
        targetId:
          target.targetId,
      };
  }
}

function assertCancelReason(
  reason: string,
): void {
  if (
    reason.length === 0 ||
    reason.length >
      MAX_CANCEL_REASON_LENGTH ||
    reason !== reason.trim()
  ) {
    throw new AbilityActionError(
      "invalid-cancel-reason",
      "cancel reason deve ser não vazio, sem whitespace nas extremidades e ter no máximo 256 caracteres.",
    );
  }
}

/**
 * Instância de execução lógica de uma habilidade.
 *
 * AbilityAction é propositalmente independente de renderer, raycast, física,
 * coordenadas, input e game loop. Ele representa somente identidade, origem,
 * alvo lógico e lifecycle da ação.
 *
 * Um adapter/sistema superior pode resolver AbilityTarget.reference para uma
 * posição 2D, um billboard 2.5D ou uma coordenada/volume 3D sem modificar esta
 * entidade.
 *
 * Transições:
 * pending -> committed -> resolved
 * pending -> cancelled
 * committed -> cancelled
 *
 * Estado é mutado in-place; snapshots são alocados somente sob demanda.
 */
export class AbilityAction {
  public readonly id:
    AbilityActionId;

  public readonly abilityId:
    AbilityId;

  public readonly sourceAgentId:
    AgentId;

  private readonly targetValue:
    AbilityTarget;

  private statusValue:
    AbilityActionStatus =
      "pending";

  private cancelReasonValue:
    string | null =
      null;

  public constructor(
    options:
      AbilityActionCreateOptions,
  ) {
    this.id = options.id;
    this.abilityId =
      options.abilityId;
    this.sourceAgentId =
      options.sourceAgentId;
    this.targetValue =
      copyTarget(
        options.target,
      );
  }

  public get target():
    AbilityTarget {
    return this.targetValue;
  }

  public get status():
    AbilityActionStatus {
    return this.statusValue;
  }

  public get cancelReason():
    string | null {
    return this.cancelReasonValue;
  }

  public get isTerminal():
    boolean {
    return (
      this.statusValue ===
        "resolved" ||
      this.statusValue ===
        "cancelled"
    );
  }

  public commit(): void {
    if (
      this.statusValue !==
      "pending"
    ) {
      throw new AbilityActionError(
        "invalid-transition",
        `AbilityAction não pode executar pending -> committed a partir de "${this.statusValue}".`,
      );
    }

    this.statusValue =
      "committed";
  }

  public resolve(): void {
    if (
      this.statusValue !==
      "committed"
    ) {
      throw new AbilityActionError(
        "invalid-transition",
        `AbilityAction só pode ser resolvida a partir de "committed"; estado atual: "${this.statusValue}".`,
      );
    }

    this.statusValue =
      "resolved";
  }

  public cancel(
    reason: string,
  ): void {
    assertCancelReason(reason);

    if (
      this.statusValue !==
        "pending" &&
      this.statusValue !==
        "committed"
    ) {
      throw new AbilityActionError(
        "invalid-transition",
        `AbilityAction não pode ser cancelada a partir de "${this.statusValue}".`,
      );
    }

    this.cancelReasonValue =
      reason;

    this.statusValue =
      "cancelled";
  }

  /**
   * Snapshot serializável, criado somente quando solicitado.
   */
  public toSnapshot():
    AbilityActionSnapshot {
    return {
      id: this.id,
      abilityId:
        this.abilityId,
      sourceAgentId:
        this.sourceAgentId,
      target:
        copyTarget(
          this.targetValue,
        ),
      status:
        this.statusValue,
      cancelReason:
        this.cancelReasonValue,
    };
  }
}
