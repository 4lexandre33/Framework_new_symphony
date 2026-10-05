// src/core/runtime/stop.ts
//
// Stage 74:
// - phase acompanha status durante shutdown;
// - onStop só roda para plugins efetivamente started;
// - rollback de boot reutiliza exatamente a mesma ordem inversa;
// - boot rollback limpa recursos sem mascarar o erro original;
// - stop/dispose permanecem idempotentes.

import type { KernelState } from "./state";
import { createLogger } from "../internal/logger";
import { withTimeout } from "../internal/ttl";
import { emitLifecycle } from "./lifecycle-events";
import { createContext } from "./context";
import { disposePlugin } from "./dispose";

export async function stop(
  state: KernelState,
): Promise<void> {
  if (
    state.status !==
      "running" &&
    state.status !==
      "booting" &&
    state.status !==
      "failed"
  ) {
    return;
  }

  state.status =
    "stopping";
  state.phase =
    "stopping";

  await emitLifecycle(
    state,
    "kernel.stopping",
    {},
  );

  const ids =
    reverseShutdownOrder(
      state,
    );

  try {
    await withTimeout(
      runStop(
        state,
        ids,
      ),
      state.stopTimeoutMs,
      () =>
        `stop excedeu ${state.stopTimeoutMs}ms`,
    );
  } catch (
    error
  ) {
    state.rootLog.error(
      "stop timeout",
      {
        error:
          String(
            error,
          ),
      },
    );

    // Não aceita novos emits depois que o host declarou shutdown.
    state.emitQueue.stop();

    state.status =
      "stopped";
    state.phase =
      "stopped";
  }
}

/**
 * Rollback interno usado exclusivamente quando boot() falha.
 *
 * Não emite kernel.stopping/kernel.stopped porque o kernel nunca chegou ao
 * estado running. O erro original do boot continua sendo a autoridade.
 */
export async function rollbackFailedBoot(
  state: KernelState,
): Promise<void> {
  const ids =
    reverseShutdownOrder(
      state,
    );

  state.phase =
    "stopping";

  // Descarta eventos fire-and-forget ainda pendentes de um boot condenado.
  state.emitQueue.stop();

  await runOnStopHooks(
    state,
    ids,
  );

  await disposeAll(
    state,
    ids,
  );

  state.capabilityWatchers.clear();
  state.bootOrder =
    [];
  state.phase =
    "stopped";
}

export async function runOnStopHookForStarted(
  state: KernelState,
  id: string,
): Promise<void> {
  const entry =
    state.registry.get(
      id,
    );

  if (
    entry?.state !==
    "started"
  ) {
    return;
  }

  const hook =
    entry.manifest
      .lifecycleHooks
      ?.onStop;

  if (
    !hook
  ) {
    return;
  }

  try {
    await hook(
      createContext(
        state,
        id,
        createLogger(
          id,
          {},
        ),
      ),
    );
  } catch (
    error
  ) {
    state.rootLog.error(
      `onStop de "${id}" falhou`,
      {
        error:
          String(
            error,
          ),
      },
    );
  }
}

function reverseShutdownOrder(
  state: KernelState,
): readonly string[] {
  if (
    state.bootOrder.length >
    0
  ) {
    return [
      ...state.bootOrder,
    ].reverse();
  }

  return state.registry
    .all()
    .map(
      (plugin) =>
        plugin.manifest.id,
    )
    .reverse();
}

async function runStop(
  state: KernelState,
  ids: readonly string[],
): Promise<void> {
  try {
    await withTimeout(
      state.emitQueue.drain(),
      Math.max(
        500,
        Math.floor(
          state.stopTimeoutMs /
          2,
        ),
      ),
      () =>
        "drain de emit excedeu",
    );
  } catch (
    error
  ) {
    state.rootLog.warn(
      "drain falhou",
      {
        error:
          String(
            error,
          ),
      },
    );
  }

  state.emitQueue.stop();

  await runOnStopHooks(
    state,
    ids,
  );

  await disposeAll(
    state,
    ids,
  );

  state.capabilityWatchers.clear();
  state.bootOrder =
    [];
  state.status =
    "stopped";
  state.phase =
    "stopped";

  await emitLifecycle(
    state,
    "kernel.stopped",
    {},
  );
}

async function runOnStopHooks(
  state: KernelState,
  ids: readonly string[],
): Promise<void> {
  for (
    const id of
    ids
  ) {
    await runOnStopHookForStarted(
      state,
      id,
    );
  }
}

async function disposeAll(
  state: KernelState,
  ids: readonly string[],
): Promise<void> {
  for (
    const id of
    ids
  ) {
    await disposePlugin(
      state,
      id,
      {
        rebindConsumers:
          false,
        force:
          true,
      },
    );
  }
}
