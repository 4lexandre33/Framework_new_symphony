import type {
  StatusEffectSet,
} from "../mechanics";

import type {
  DomainDuration,
} from "../time";

export interface StatusEffectTimeAdvanceResult {
  readonly activeBefore:
    number;
  readonly activeAfter:
    number;
  readonly expiredNow:
    number;
}

/**
 * Integra DomainDuration ao lifecycle de StatusEffectSet.
 *
 * Não remove efeitos terminais automaticamente; prune continua explícito.
 */
export function advanceStatusEffectsByTime(
  effects:
    StatusEffectSet,
  elapsed:
    DomainDuration,
): StatusEffectTimeAdvanceResult {
  const activeBefore =
    effects.activeCount;

  effects.advance(elapsed);

  const activeAfter =
    effects.activeCount;

  return Object.freeze({
    activeBefore,
    activeAfter,
    expiredNow:
      activeBefore -
      activeAfter,
  });
}
