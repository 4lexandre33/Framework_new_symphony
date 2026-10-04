import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

export type SkillId =
  DomainId<"skill">;

export function createSkillId(
  value: string,
): SkillId {
  return createDomainId<
    "skill"
  >(value);
}

export interface SkillNodeDefinition {
  readonly id: SkillId;
  readonly name: string;
  readonly prerequisites:
    readonly SkillId[];
}

export interface SkillNode {
  readonly id: SkillId;
  readonly name: string;
  readonly prerequisites:
    readonly SkillId[];
}

export type SkillTreeGraphErrorCode =
  | "duplicate-skill"
  | "invalid-name"
  | "duplicate-prerequisite"
  | "self-dependency"
  | "missing-prerequisite"
  | "cycle"
  | "unknown-skill";

export class SkillTreeGraphError
  extends Error {
  public readonly name =
    "SkillTreeGraphError";

  public constructor(
    public readonly code:
      SkillTreeGraphErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const MAX_SKILL_NAME_LENGTH =
  120;

function compareSkillId(
  left: SkillId,
  right: SkillId,
): number {
  return left < right
    ? -1
    : left > right
      ? 1
      : 0;
}

function assertSkillName(
  name: string,
): void {
  if (
    name.length === 0 ||
    name.length >
      MAX_SKILL_NAME_LENGTH ||
    name !== name.trim()
  ) {
    throw new SkillTreeGraphError(
      "invalid-name",
      "Skill name deve ser não vazio, sem whitespace nas extremidades e ter no máximo 120 caracteres.",
    );
  }
}

function createFrozenSkillNode(
  definition:
    SkillNodeDefinition,
): SkillNode {
  const prerequisites =
    [...definition.prerequisites]
      .sort(compareSkillId);

  return Object.freeze({
    id: definition.id,
    name: definition.name,
    prerequisites:
      Object.freeze(
        prerequisites,
      ),
  });
}

/**
 * DAG imutável de progressão de skills.
 *
 * O grafo é validado integralmente no construtor:
 * - IDs duplicados;
 * - nomes inválidos;
 * - pré-requisitos duplicados;
 * - auto-dependência;
 * - referências inexistentes;
 * - ciclos.
 *
 * Após a construção, lookups são baseados em Map e a ordem topológica é
 * pré-calculada. Nenhum processamento por frame é necessário.
 */
export class SkillTreeGraph {
  private readonly nodes =
    new Map<
      SkillId,
      SkillNode
    >();

  private readonly dependents =
    new Map<
      SkillId,
      readonly SkillId[]
    >();

  private readonly topologicalOrderValue:
    readonly SkillId[];

  public constructor(
    definitions:
      readonly SkillNodeDefinition[],
  ) {
    for (
      const definition of
      definitions
    ) {
      if (
        this.nodes.has(
          definition.id,
        )
      ) {
        throw new SkillTreeGraphError(
          "duplicate-skill",
          `SkillId duplicado: "${definition.id}".`,
        );
      }

      assertSkillName(
        definition.name,
      );

      const seenPrerequisites =
        new Set<SkillId>();

      for (
        const prerequisite of
        definition.prerequisites
      ) {
        if (
          prerequisite ===
          definition.id
        ) {
          throw new SkillTreeGraphError(
            "self-dependency",
            `Skill "${definition.id}" não pode depender de si mesma.`,
          );
        }

        if (
          seenPrerequisites.has(
            prerequisite,
          )
        ) {
          throw new SkillTreeGraphError(
            "duplicate-prerequisite",
            `Skill "${definition.id}" possui prerequisite duplicado "${prerequisite}".`,
          );
        }

        seenPrerequisites.add(
          prerequisite,
        );
      }

      this.nodes.set(
        definition.id,
        createFrozenSkillNode(
          definition,
        ),
      );
    }

    const mutableDependents =
      new Map<
        SkillId,
        SkillId[]
      >();

    const indegree =
      new Map<
        SkillId,
        number
      >();

    for (
      const skillId of
      this.nodes.keys()
    ) {
      mutableDependents.set(
        skillId,
        [],
      );

      indegree.set(
        skillId,
        0,
      );
    }

    for (
      const node of
      this.nodes.values()
    ) {
      indegree.set(
        node.id,
        node.prerequisites.length,
      );

      for (
        const prerequisite of
        node.prerequisites
      ) {
        if (
          !this.nodes.has(
            prerequisite,
          )
        ) {
          throw new SkillTreeGraphError(
            "missing-prerequisite",
            `Skill "${node.id}" depende de skill inexistente "${prerequisite}".`,
          );
        }

        const list =
          mutableDependents.get(
            prerequisite,
          );

        if (list === undefined) {
          throw new SkillTreeGraphError(
            "missing-prerequisite",
            `Skill prerequisite inexistente "${prerequisite}".`,
          );
        }

        list.push(node.id);
      }
    }

    for (
      const [
        skillId,
        list,
      ] of
      mutableDependents
    ) {
      list.sort(compareSkillId);

      this.dependents.set(
        skillId,
        Object.freeze(
          [...list],
        ),
      );
    }

    const ready:
      SkillId[] = [];

    for (
      const [
        skillId,
        degree,
      ] of indegree
    ) {
      if (degree === 0) {
        ready.push(skillId);
      }
    }

    ready.sort(compareSkillId);

    const topological:
      SkillId[] = [];

    while (
      ready.length > 0
    ) {
      const skillId =
        ready.shift();

      if (
        skillId === undefined
      ) {
        break;
      }

      topological.push(
        skillId,
      );

      const children =
        this.dependents.get(
          skillId,
        ) ?? [];

      for (
        const childId of
        children
      ) {
        const currentDegree =
          indegree.get(
            childId,
          );

        if (
          currentDegree ===
          undefined
        ) {
          throw new SkillTreeGraphError(
            "unknown-skill",
            `Skill interna desconhecida "${childId}".`,
          );
        }

        const nextDegree =
          currentDegree - 1;

        indegree.set(
          childId,
          nextDegree,
        );

        if (nextDegree === 0) {
          ready.push(
            childId,
          );

          ready.sort(
            compareSkillId,
          );
        }
      }
    }

    if (
      topological.length !==
      this.nodes.size
    ) {
      throw new SkillTreeGraphError(
        "cycle",
        "SkillTreeGraph contém ciclo de dependências.",
      );
    }

    this.topologicalOrderValue =
      Object.freeze(
        topological,
      );
  }

  public get size():
    number {
    return this.nodes.size;
  }

  public has(
    skillId: SkillId,
  ): boolean {
    return this.nodes.has(
      skillId,
    );
  }

  public getSkill(
    skillId: SkillId,
  ): SkillNode | null {
    return (
      this.nodes.get(
        skillId,
      ) ??
      null
    );
  }

  public getPrerequisites(
    skillId: SkillId,
  ): readonly SkillId[] {
    return this.requireSkill(
      skillId,
    ).prerequisites;
  }

  public getDependents(
    skillId: SkillId,
  ): readonly SkillId[] {
    this.requireSkill(
      skillId,
    );

    return (
      this.dependents.get(
        skillId,
      ) ??
      []
    );
  }

  /**
   * Ordem topológica determinística, estável por SkillId.
   *
   * O array é calculado uma vez no construtor e reutilizado.
   */
  public get topologicalOrder():
    readonly SkillId[] {
    return this
      .topologicalOrderValue;
  }

  public canUnlock(
    skillId: SkillId,
    unlocked:
      ReadonlySet<SkillId>,
  ): boolean {
    const node =
      this.requireSkill(
        skillId,
      );

    if (
      unlocked.has(skillId)
    ) {
      return false;
    }

    for (
      const prerequisite of
      node.prerequisites
    ) {
      if (
        !unlocked.has(
          prerequisite,
        )
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * Aloca somente quando o chamador pede a lista de faltantes.
   */
  public getMissingPrerequisites(
    skillId: SkillId,
    unlocked:
      ReadonlySet<SkillId>,
  ): readonly SkillId[] {
    const node =
      this.requireSkill(
        skillId,
      );

    const missing:
      SkillId[] = [];

    for (
      const prerequisite of
      node.prerequisites
    ) {
      if (
        !unlocked.has(
          prerequisite,
        )
      ) {
        missing.push(
          prerequisite,
        );
      }
    }

    return missing;
  }

  /**
   * Retorna skills atualmente desbloqueáveis em ordem topológica determinística.
   *
   * Operação event-driven; deve ser chamada quando o conjunto de skills
   * desbloqueadas muda, não por frame.
   */
  public getUnlockable(
    unlocked:
      ReadonlySet<SkillId>,
  ): readonly SkillId[] {
    const result:
      SkillId[] = [];

    for (
      const skillId of
      this.topologicalOrderValue
    ) {
      if (
        this.canUnlock(
          skillId,
          unlocked,
        )
      ) {
        result.push(skillId);
      }
    }

    return result;
  }

  private requireSkill(
    skillId: SkillId,
  ): SkillNode {
    const node =
      this.nodes.get(
        skillId,
      );

    if (node === undefined) {
      throw new SkillTreeGraphError(
        "unknown-skill",
        `Skill desconhecida: "${skillId}".`,
      );
    }

    return node;
  }
}
