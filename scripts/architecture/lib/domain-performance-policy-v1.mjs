export const DOMAIN_PERFORMANCE_POLICY_VERSION =
  "1.0.0";

/**
 * Hot paths auditados estruturalmente.
 *
 * Estes métodos podem ser chamados em alta frequência e, no caminho normal,
 * não devem materializar coleções/snapshots nem criar objetos temporários.
 *
 * Alocações exclusivamente dentro de `throw` são ignoradas pelo auditor:
 * failure paths são excepcionais e não pertencem ao throughput normal.
 */
export const DOMAIN_HOT_PATHS =
  Object.freeze([
    {
      file:
        "src/domain/state/StateStore.ts",
      className:
        "StateStore",
      methods:
        [
          "has",
          "read",
          "delete",
          "clear",
        ],
      maxLoopDepth: 0,
    },
    {
      file:
        "src/domain/tags/TagSet.ts",
      className:
        "TagSet",
      methods:
        [
          "has",
          "containsAll",
          "containsAny",
          "equals",
          "forEach",
        ],
      maxLoopDepth: 1,
    },
    {
      file:
        "src/domain/economy/Inventory.ts",
      className:
        "Inventory",
      methods:
        [
          "has",
          "getQuantity",
          "getItem",
          "canAdd",
        ],
      maxLoopDepth: 0,
    },
    {
      file:
        "src/domain/mechanics/ResourcePool.ts",
      className:
        "ResourcePool",
      methods:
        [
          "canSpend",
          "trySpend",
          "gain",
        ],
      maxLoopDepth: 0,
    },
    {
      file:
        "src/domain/mechanics/ModifierSet.ts",
      className:
        "ModifierSet",
      methods:
        [
          "has",
          "get",
          "countForTarget",
          "getModifiersForTarget",
          "evaluate",
          "forEach",
        ],
      maxLoopDepth: 1,
    },
    {
      file:
        "src/domain/mechanics/CooldownSet.ts",
      className:
        "CooldownSet",
      methods:
        [
          "has",
          "get",
          "advance",
          "forEach",
        ],
      maxLoopDepth: 1,
    },
    {
      file:
        "src/domain/mechanics/StatusEffectSet.ts",
      className:
        "StatusEffectSet",
      methods:
        [
          "has",
          "hasActive",
          "get",
          "advance",
          "pruneTerminal",
          "forEach",
        ],
      maxLoopDepth: 1,
    },
    {
      file:
        "src/domain/relations/FactionMatrix.ts",
      className:
        "FactionMatrix",
      methods:
        [
          "hasExplicit",
          "get",
        ],
      maxLoopDepth: 0,
    },
    {
      file:
        "src/domain/progression/ProgressionCurve.ts",
      className:
        "ProgressionCurve",
      methods:
        [
          "getLevelForTotalExperience",
          "getExperienceIntoLevel",
          "getExperienceRequiredForNextLevel",
          "getProgress01",
        ],
      maxLoopDepth: 1,
    },
    {
      file:
        "src/domain/random/DeterministicRng.ts",
      className:
        "DeterministicRng",
      methods:
        [
          "nextUint32",
          "nextFloat",
          "nextInt",
          "nextFloatRange",
          "nextBoolean",
        ],
      maxLoopDepth: 1,
    },
  ]);

/**
 * Coleções mutáveis que precisam possuir APIs explícitas de release/lifecycle.
 *
 * O objetivo não é forçar GC manual; é garantir que o domínio ofereça uma
 * forma semântica de remover referências quando o lifecycle termina.
 */
export const DOMAIN_LIFECYCLE_POLICIES =
  Object.freeze([
    {
      file:
        "src/domain/state/StateStore.ts",
      className:
        "StateStore",
      requiredMethods:
        [
          "delete",
          "clear",
        ],
    },
    {
      file:
        "src/domain/tags/TagSet.ts",
      className:
        "TagSet",
      requiredMethods:
        [
          "delete",
          "clear",
        ],
    },
    {
      file:
        "src/domain/economy/Inventory.ts",
      className:
        "Inventory",
      requiredMethods:
        [
          "remove",
          "clear",
        ],
    },
    {
      file:
        "src/domain/mechanics/ModifierSet.ts",
      className:
        "ModifierSet",
      requiredMethods:
        [
          "remove",
          "clear",
        ],
    },
    {
      file:
        "src/domain/mechanics/CooldownSet.ts",
      className:
        "CooldownSet",
      requiredMethods:
        [
          "remove",
          "clear",
        ],
    },
    {
      file:
        "src/domain/mechanics/StatusEffectSet.ts",
      className:
        "StatusEffectSet",
      requiredMethods:
        [
          "remove",
          "pruneTerminal",
          "clear",
        ],
    },
    {
      file:
        "src/domain/narrative/StoryFlagSet.ts",
      className:
        "StoryFlagSet",
      requiredMethods:
        [
          "clear",
        ],
    },
    {
      file:
        "src/domain/progression/UnlockSet.ts",
      className:
        "UnlockSet",
      requiredMethods:
        [
          "lock",
          "clear",
        ],
    },
  ]);

export const DOMAIN_DISALLOWED_HOT_CALL_NAMES =
  Object.freeze(
    new Set([
      "map",
      "filter",
      "reduce",
      "reduceRight",
      "sort",
      "slice",
      "concat",
      "flat",
      "flatMap",
      "toSorted",
      "toReversed",
      "toSpliced",
      "toSnapshot",
      "toArray",
      "stringify",
      "parse",
    ]),
  );

export const DOMAIN_DISALLOWED_HOT_STATIC_CALLS =
  Object.freeze(
    new Set([
      "Array.from",
      "Array.of",
      "Object.keys",
      "Object.values",
      "Object.entries",
      "Object.fromEntries",
      "JSON.stringify",
      "JSON.parse",
      "structuredClone",
    ]),
  );
