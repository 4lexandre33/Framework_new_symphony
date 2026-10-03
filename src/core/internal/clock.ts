import type { Clock } from "../contracts/clock";

/** Clock de sistema com extensões usadas por plugins de longa duração. */
export interface SystemClock extends Clock {
  /** Repetidor. Retorna cancelador. */
  setInterval(fn: () => void, ms: number): () => void;
  /** Cancela todos os timers pendentes deste clock. */
  cancelAll(): void;
}

export function createSystemClock(): SystemClock {
  const timeouts = new Set<ReturnType<typeof setTimeout>>();
  const intervals = new Set<ReturnType<typeof setInterval>>();

  return {
    now: () => Date.now(),
    setTimeout: (fn, ms) => {
      const h = setTimeout(() => {
        timeouts.delete(h);
        fn();
      }, ms);
      timeouts.add(h);
      return () => {
        clearTimeout(h);
        timeouts.delete(h);
      };
    },
    clearTimeout: () => {
      // O contrato do Clock expõe clearTimeout(handle), mas nosso setTimeout
      // devolve um cancelador, não um handle. Este método existe apenas para
      // compat; o caminho correto é chamar o cancelador devolvido.
    },
    setInterval: (fn, ms) => {
      const h = setInterval(fn, ms);
      intervals.add(h);
      return () => {
        clearInterval(h);
        intervals.delete(h);
      };
    },
    cancelAll() {
      for (const h of timeouts) clearTimeout(h);
      for (const h of intervals) clearInterval(h);
      timeouts.clear();
      intervals.clear();
    },
  };
}

export interface ManualClock extends Clock {
  setInterval(fn: () => void, ms: number): () => void;
  advance(ms: number): void;
  pending(): number;
  cancelAll(): void;
}

interface ManualTimer {
  at: number;
  fn: () => void;
  intervalMs?: number;
  active: boolean;
}

export function createManualClock(initial = 0): ManualClock {
  let now = initial;
  let nextId = 0;
  const timers = new Map<number, ManualTimer>();

  return {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn, active: true });
      return () => {
        const t = timers.get(id);
        if (t) t.active = false;
        timers.delete(id);
      };
    },
    clearTimeout: () => {
      // ver comentário em createSystemClock
    },
    setInterval: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn, intervalMs: ms, active: true });
      return () => {
        const t = timers.get(id);
        if (t) t.active = false;
        timers.delete(id);
      };
    },
    advance(ms) {
      const target = now + ms;
      // Loop com guarda: cada iteração executa o próximo timer <= target.
      // Intervalos rearmam e podem ser executados várias vezes.
      let guard = 0;
      while (guard++ < 10_000) {
        let next: [number, ManualTimer] | undefined;
        for (const entry of timers) {
          if (!entry[1].active) continue;
          if (entry[1].at > target) continue;
          if (!next || entry[1].at < next[1].at) next = entry;
        }
        if (!next) break;
        const [id, t] = next;
        now = t.at;
        if (t.intervalMs !== undefined) {
          t.at = now + t.intervalMs;
        } else {
          timers.delete(id);
        }
        try {
          t.fn();
        } catch {
          /* handler hostil */
        }
      }
      now = target;
    },
    pending: () => {
      let n = 0;
      for (const t of timers.values()) if (t.active) n++;
      return n;
    },
    cancelAll() {
      for (const t of timers.values()) t.active = false;
      timers.clear();
    },
  };
}