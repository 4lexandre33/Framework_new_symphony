import {
  createDomainId,
} from "./DomainId";

import type {
  DomainId,
} from "./DomainId";

export type AgentId =
  DomainId<"agent">;

export function createAgentId(
  value: string,
): AgentId {
  return createDomainId<
    "agent"
  >(value);
}

export interface AgentCreateOptions {
  readonly id: AgentId;
  readonly displayName: string;
  readonly maxHealth: number;
  readonly health?: number;
  readonly level?: number;
  readonly experience?: number;
}

export interface AgentSnapshot {
  readonly id: AgentId;
  readonly displayName: string;
  readonly health: number;
  readonly maxHealth: number;
  readonly level: number;
  readonly experience: number;
  readonly alive: boolean;
}

export class AgentInvariantError
  extends Error {
  public readonly name =
    "AgentInvariantError";

  public constructor(
    message: string,
  ) {
    super(message);
  }
}

const MAX_DISPLAY_NAME_LENGTH =
  96;

function assertDisplayName(
  displayName: string,
): void {
  if (
    displayName.length === 0 ||
    displayName.length >
      MAX_DISPLAY_NAME_LENGTH ||
    displayName !==
      displayName.trim()
  ) {
    throw new AgentInvariantError(
      "displayName deve ser não vazio, sem whitespace nas extremidades e ter no máximo 96 caracteres.",
    );
  }
}

function assertFiniteNonNegative(
  value: number,
  fieldName: string,
): void {
  if (
    !Number.isFinite(value) ||
    value < 0
  ) {
    throw new AgentInvariantError(
      `${fieldName} deve ser finito e maior ou igual a 0.`,
    );
  }
}

function assertPositiveFinite(
  value: number,
  fieldName: string,
): void {
  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {
    throw new AgentInvariantError(
      `${fieldName} deve ser finito e maior que 0.`,
    );
  }
}

function assertPositiveSafeInteger(
  value: number,
  fieldName: string,
): void {
  if (
    !Number.isSafeInteger(value) ||
    value < 1
  ) {
    throw new AgentInvariantError(
      `${fieldName} deve ser um inteiro seguro maior ou igual a 1.`,
    );
  }
}

function assertNonNegativeSafeInteger(
  value: number,
  fieldName: string,
): void {
  if (
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new AgentInvariantError(
      `${fieldName} deve ser um inteiro seguro maior ou igual a 0.`,
    );
  }
}

/**
 * Entidade pura de gameplay.
 *
 * Agent não conhece representação espacial, renderer, física, input, câmera,
 * Tauri ou plataforma. O mesmo Agent pode ser projetado por adapters 2D, 2.5D
 * ou 3D sem alteração do modelo de domínio.
 *
 * As mutações numéricas abaixo trabalham in-place e não alocam objetos no
 * caminho comum. Snapshots são alocados somente sob solicitação explícita.
 */
export class Agent {
  private displayNameValue:
    string;

  private healthValue:
    number;

  private readonly maxHealthValue:
    number;

  private levelValue:
    number;

  private experienceValue:
    number;

  public readonly id:
    AgentId;

  public constructor(
    options: AgentCreateOptions,
  ) {
    assertDisplayName(
      options.displayName,
    );

    assertPositiveFinite(
      options.maxHealth,
      "maxHealth",
    );

    const initialHealth =
      options.health ??
      options.maxHealth;

    assertFiniteNonNegative(
      initialHealth,
      "health",
    );

    if (
      initialHealth >
      options.maxHealth
    ) {
      throw new AgentInvariantError(
        "health não pode ser maior que maxHealth.",
      );
    }

    const initialLevel =
      options.level ?? 1;

    assertPositiveSafeInteger(
      initialLevel,
      "level",
    );

    const initialExperience =
      options.experience ?? 0;

    assertNonNegativeSafeInteger(
      initialExperience,
      "experience",
    );

    this.id = options.id;
    this.displayNameValue =
      options.displayName;
    this.maxHealthValue =
      options.maxHealth;
    this.healthValue =
      initialHealth;
    this.levelValue =
      initialLevel;
    this.experienceValue =
      initialExperience;
  }

  public get displayName():
    string {
    return this.displayNameValue;
  }

  public get health():
    number {
    return this.healthValue;
  }

  public get maxHealth():
    number {
    return this.maxHealthValue;
  }

  public get level():
    number {
    return this.levelValue;
  }

  public get experience():
    number {
    return this.experienceValue;
  }

  public get alive():
    boolean {
    return this.healthValue > 0;
  }

  public rename(
    displayName: string,
  ): void {
    assertDisplayName(
      displayName,
    );

    this.displayNameValue =
      displayName;
  }

  /**
   * Aplica dano e retorna o dano efetivamente absorvido.
   *
   * Não cria eventos, VFX, áudio ou efeitos de física. Camadas superiores
   * traduzem a mudança de estado para infraestrutura concreta.
   */
  public applyDamage(
    amount: number,
  ): number {
    assertFiniteNonNegative(
      amount,
      "amount",
    );

    if (
      amount === 0 ||
      this.healthValue === 0
    ) {
      return 0;
    }

    const previous =
      this.healthValue;

    this.healthValue =
      Math.max(
        0,
        previous - amount,
      );

    return (
      previous -
      this.healthValue
    );
  }

  /**
   * Recupera vida e retorna a quantidade efetivamente restaurada.
   *
   * Um Agent morto não é revivido implicitamente por heal(); revive() existe
   * para tornar essa transição explícita no domínio.
   */
  public heal(
    amount: number,
  ): number {
    assertFiniteNonNegative(
      amount,
      "amount",
    );

    if (
      amount === 0 ||
      !this.alive ||
      this.healthValue ===
        this.maxHealthValue
    ) {
      return 0;
    }

    const previous =
      this.healthValue;

    this.healthValue =
      Math.min(
        this.maxHealthValue,
        previous + amount,
      );

    return (
      this.healthValue -
      previous
    );
  }

  public kill(): void {
    this.healthValue = 0;
  }

  public revive(
    health: number = 1,
  ): void {
    if (this.alive) {
      throw new AgentInvariantError(
        "revive só pode ser usado quando o Agent está morto.",
      );
    }

    assertPositiveFinite(
      health,
      "health",
    );

    if (
      health >
      this.maxHealthValue
    ) {
      throw new AgentInvariantError(
        "health de revive não pode ser maior que maxHealth.",
      );
    }

    this.healthValue =
      health;
  }

  /**
   * Level é alterado explicitamente; Agent não impõe curva de XP.
   *
   * Curvas de progressão variam por jogo e pertencem às mecânicas futuras, não
   * à identidade fundamental de Agent.
   */
  public setLevel(
    level: number,
  ): void {
    assertPositiveSafeInteger(
      level,
      "level",
    );

    this.levelValue = level;
  }

  /**
   * Adiciona XP sem executar level-up automático.
   */
  public addExperience(
    amount: number,
  ): number {
    assertNonNegativeSafeInteger(
      amount,
      "amount",
    );

    if (amount === 0) {
      return this.experienceValue;
    }

    const next =
      this.experienceValue +
      amount;

    if (
      !Number.isSafeInteger(next)
    ) {
      throw new AgentInvariantError(
        "experience excedeu o limite de inteiro seguro.",
      );
    }

    this.experienceValue =
      next;

    return next;
  }

  /**
   * Snapshot de domínio sob demanda.
   *
   * Esta alocação é intencional e não deve ser chamada por frame.
   */
  public toSnapshot():
    AgentSnapshot {
    return {
      id: this.id,
      displayName:
        this.displayNameValue,
      health:
        this.healthValue,
      maxHealth:
        this.maxHealthValue,
      level:
        this.levelValue,
      experience:
        this.experienceValue,
      alive: this.alive,
    };
  }
}
