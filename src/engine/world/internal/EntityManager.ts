import type {
  EntityComponentState,
  EntitySpawnInput,
  EntityStatePatch,
  WorldPosition3D,
  WorldRotation,
  WorldScale3D,
} from "../../../contracts/world/types";

export type EntityStateVisitor = (
  state: EntityComponentState,
) => void;

const DEFAULT_ENTITY_TYPE = "entity";

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value);
}

function readComponent(
  source: Record<string, unknown>,
  key: string,
  fallback: number,
): number | null {
  const value = source[key];

  if (value === undefined) {
    return fallback;
  }

  return typeof value === "number" &&
    Number.isFinite(value)
    ? value
    : null;
}

function normalizeVector(
  value: unknown,
  fallback: number,
): WorldPosition3D | null {
  if (value === undefined) {
    return Object.freeze({
      x: fallback,
      y: fallback,
      z: fallback,
    });
  }

  if (!isRecord(value)) {
    return null;
  }

  const x = readComponent(value, "x", fallback);
  const y = readComponent(value, "y", fallback);
  const z = readComponent(value, "z", fallback);

  if (x === null || y === null || z === null) {
    return null;
  }

  return Object.freeze({ x, y, z });
}

function normalizeRotation(
  value: unknown,
): WorldRotation | null {
  if (value === undefined) {
    return Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
  }

  if (!isRecord(value)) {
    return null;
  }

  const x = readComponent(value, "x", 0);
  const y = readComponent(value, "y", 0);
  const z = readComponent(value, "z", 0);
  const w = readComponent(value, "w", 1);

  if (
    x === null ||
    y === null ||
    z === null ||
    w === null ||
    x * x + y * y + z * z + w * w <= Number.EPSILON
  ) {
    return null;
  }

  return Object.freeze({ x, y, z, w });
}

function normalizeTags(
  value: unknown,
): ReadonlyArray<string> | null {
  if (value === undefined) {
    return Object.freeze([]);
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const tags: string[] = [];

  for (const tag of value) {
    if (typeof tag !== "string") {
      return null;
    }

    tags.push(tag);
  }

  return Object.freeze(tags);
}

function normalizeCustomData(
  value: unknown,
): Record<string, unknown> | null {
  if (value === undefined) {
    return {};
  }

  return isRecord(value)
    ? { ...value }
    : null;
}

function normalizeType(
  value: unknown,
): string | null {
  if (value === undefined) {
    return DEFAULT_ENTITY_TYPE;
  }

  return typeof value === "string"
    ? value
    : null;
}

/**
 * Valida e normaliza uma entrada de spawn em um snapshot técnico próprio e
 * imutável (posição/rotação/escala/tags congeladas). Retorna null se algum
 * campo informado for inválido. Nunca lança.
 */
export function normalizeEntityInput(
  input: unknown,
): EntityComponentState | null {
  if (!isRecord(input)) {
    return null;
  }

  const entityId = input["entityId"];

  if (
    typeof entityId !== "string" ||
    entityId.trim().length === 0
  ) {
    return null;
  }

  const type = normalizeType(input["type"]);
  const position = normalizeVector(input["position"], 0);
  const rotation = normalizeRotation(input["rotation"]);
  const scale = normalizeVector(input["scale"], 1);
  const tags = normalizeTags(input["tags"]);
  const customData = normalizeCustomData(input["customData"]);

  if (
    type === null ||
    position === null ||
    rotation === null ||
    scale === null ||
    tags === null ||
    customData === null
  ) {
    return null;
  }

  return Object.freeze({
    entityId,
    type,
    position,
    rotation,
    scale: scale as WorldScale3D,
    tags,
    customData,
  });
}

export class EntityManager {
  private readonly entityMap =
    new Map<
      string,
      EntityComponentState
    >();

  public get activeEntityCount():
    number {
    return this.entityMap.size;
  }

  /**
   * Cria/substitui uma entidade. Retorna false (sem lançar) para entrada
   * inválida.
   *
   * O EntityManager mantém ownership do snapshot técnico. Snapshots são
   * imutáveis (copy-on-write): referências entregues por getEntityState()
   * nunca mudam nem "renascem" como outra entidade. Spawn/despawn/update são
   * operações discretas fora do hot path da engine.
   */
  public spawnEntity(
    state: EntitySpawnInput,
  ): boolean {
    const ownedState =
      normalizeEntityInput(state);

    if (ownedState === null) {
      return false;
    }

    this.entityMap.set(
      ownedState.entityId,
      ownedState,
    );

    return true;
  }

  /**
   * Aplica um patch criando um snapshot novo. Retorna o snapshot novo, ou
   * null se a entidade não existe ou o patch é inválido.
   */
  public patchEntity(
    entityId: string,
    patch: EntityStatePatch,
  ): EntityComponentState | null {
    const current =
      this.entityMap.get(entityId);

    if (
      current === undefined ||
      !isRecord(patch)
    ) {
      return null;
    }

    const next =
      normalizeEntityInput({
        entityId,
        type: patch.type ?? current.type,
        position: patch.position ?? current.position,
        rotation: patch.rotation ?? current.rotation,
        scale: patch.scale ?? current.scale,
        tags: patch.tags ?? current.tags,
        customData: patch.customData ?? current.customData,
      });

    if (next === null) {
      return null;
    }

    this.entityMap.set(
      entityId,
      next,
    );

    return next;
  }

  /**
   * Caminho rápido para mover/girar/escalar: só os campos de transform são
   * validados e copiados; type/tags/customData são compartilhados com o
   * snapshot anterior. Retorna o snapshot novo ou null.
   */
  public updateTransform(
    entityId: string,
    patch: EntityStatePatch,
  ): EntityComponentState | null {
    const current =
      this.entityMap.get(entityId);

    if (
      current === undefined ||
      !isRecord(patch)
    ) {
      return null;
    }

    const position =
      patch.position === undefined
        ? current.position
        : normalizeVector(patch.position, 0);
    const rotation =
      patch.rotation === undefined
        ? current.rotation
        : normalizeRotation(patch.rotation);
    const scale =
      patch.scale === undefined
        ? current.scale
        : normalizeVector(patch.scale, 1);

    if (
      position === null ||
      rotation === null ||
      scale === null
    ) {
      return null;
    }

    const next: EntityComponentState =
      Object.freeze({
        entityId: current.entityId,
        type: current.type,
        position,
        rotation,
        scale,
        tags: current.tags,
        customData: current.customData,
      });

    this.entityMap.set(
      entityId,
      next,
    );

    return next;
  }

  public hasEntity(
    entityId: string,
  ): boolean {
    return this.entityMap.has(
      entityId,
    );
  }

  public despawnEntity(
    entityId: string,
  ): boolean {
    return this.entityMap.delete(
      entityId,
    );
  }

  public getEntityState(
    entityId: string,
  ): EntityComponentState | null {
    return this.entityMap.get(
      entityId,
    ) ?? null;
  }

  public getAllEntities():
    EntityComponentState[] {
    return Array.from(
      this.entityMap.values(),
    );
  }

  public getEntityIds():
    string[] {
    return Array.from(
      this.entityMap.keys(),
    );
  }

  public forEachEntity(
    visitor: EntityStateVisitor,
  ): void {
    for (
      const state of
      this.entityMap.values()
    ) {
      visitor(
        state,
      );
    }
  }

  public clear(): void {
    this.entityMap.clear();
  }
}
