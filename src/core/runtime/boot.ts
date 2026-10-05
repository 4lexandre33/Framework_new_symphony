// src/core/runtime/boot.ts
//
// Stage 74:
// - boot estrito agora executa rollback automático de recursos em qualquer
//   falha, preservando o erro original;
// - tolerant mode quarentena plugins que falham em setup/resolve/readiness/
//   onBoot em vez de deixá-los parcialmente vivos;
// - onBoot falho recebe onStop antes do dispose;
// - plugins failed/disposed nunca são promovidos para started.

import type { KernelState } from "./state";
import type { PluginManifest } from "../contracts/plugin-manifest";
import { KernelError } from "../contracts/errors";
import {
  runArchitecturalPreflight,
  createScope,
  createSystemClock,
  SchedulerImpl,
  createLogger,
  freezeValue,
  withTimeout,
  createStorageForManifest,
} from "../internal";
import { emitLifecycle } from "./lifecycle-events";
import { createContext } from "./context";
import { disposePlugin } from "./dispose";
import {
  rollbackFailedBoot,
  runOnStopHookForStarted,
} from "./stop";

export async function boot(
  state: KernelState,
): Promise<void> {
  if (
    state.status !==
    "idle"
  ) {
    throw new KernelError(
      "PLUGIN_MISSING",
      `kernel já está em "${state.status}"`,
    );
  }

  state.status =
    "booting";

  try {
    await withTimeout(
      runBoot(
        state,
      ),
      state.bootTimeoutMs,
      () => {
        const pending =
          state.readiness
            .pendingList();

        return pending.length
          ? `boot excedeu ${state.bootTimeoutMs}ms; pendentes: [${pending.join(", ")}]`
          : `boot excedeu ${state.bootTimeoutMs}ms`;
      },
      "BOOT_TIMEOUT",
    );
  } catch (
    error
  ) {
    state.rootLog.error(
      "boot falhou; iniciando rollback automático",
      {
        error:
          String(
            error,
          ),
      },
    );

    try {
      await rollbackFailedBoot(
        state,
      );
    } catch (
      rollbackError
    ) {
      state.rootLog.error(
        "rollback automático do boot falhou",
        {
          error:
            String(
              rollbackError,
            ),
        },
      );
    }

    // O erro original continua sendo a autoridade da falha de boot.
    // A fase "stopped" significa que não restam recursos vivos.
    state.status =
      "failed";
    state.phase =
      "stopped";

    throw error;
  }
}

async function runBoot(
  state: KernelState,
): Promise<void> {
  const manifests =
    state.registry
      .all()
      .map(
        (plugin) =>
          plugin.manifest,
      );

  const order =
    runArchitecturalPreflight(
      manifests,
      {
        allowInternalConsumeExternal:
          state.options
            .allowInternalConsumeExternal ??
          false,
      },
    );

  state.bootOrder =
    order.map(
      (manifest) =>
        manifest.id,
    );

  state.phase =
    "setup";

  for (
    const manifest of
    order
  ) {
    await setupOne(
      state,
      manifest,
    );
  }

  state.phase =
    "resolving";

  await resolveAll(
    state,
    order,
  );

  if (
    state.tolerant
  ) {
    await quarantineFailedEntries(
      state,
      order,
    );
  }

  state.phase =
    "ready";

  await waitReady(
    state,
  );

  if (
    state.tolerant
  ) {
    await quarantineFailedEntries(
      state,
      order,
    );
  }

  await markStarted(
    state,
    order,
  );

  if (
    state.tolerant
  ) {
    await quarantineFailedEntries(
      state,
      order,
    );
  }

  state.phase =
    "running";
  state.status =
    "running";

  await emitLifecycle(
    state,
    "kernel.booted",
    {
      plugins:
        order.map(
          (manifest) =>
            manifest.id,
        ),
      order:
        state.bootOrder,
    },
  );
}

async function setupOne(
  state: KernelState,
  manifest: PluginManifest,
): Promise<void> {
  const entry =
    state.registry
      .mustGet(
        manifest.id,
      );

  if (
    entry.state ===
      "failed" ||
    entry.state ===
      "disposed"
  ) {
    return;
  }

  const log =
    createLogger(
      manifest.id,
      {},
    );

  state.scopes.set(
    manifest.id,
    createScope(),
  );

  state.abortControllers.set(
    manifest.id,
    new AbortController(),
  );

  state.schedulers.set(
    manifest.id,
    new SchedulerImpl(),
  );

  state.clocks.set(
    manifest.id,
    createSystemClock(),
  );

  state.pluginStorages.set(
    manifest.id,
    createStorageForManifest(
      manifest,
    ),
  );

  let config:
    Record<string, unknown> =
    {};

  try {
    const schema =
      manifest.configSchema;

    if (schema) {
      const userConfig =
        state.userConfigs?.[
          manifest.id
        ];

      const raw =
        userConfig !==
        undefined
          ? {
              ...schema.defaults,
              ...(
                userConfig as
                Record<
                  string,
                  unknown
                >
              ),
            }
          : schema.defaults;

      config =
        schema.parse(
          raw,
        );
    }
  } catch (
    error
  ) {
    log.error(
      "config inválida",
      {
        error:
          String(
            error,
          ),
      },
    );

    state.registry.setState(
      manifest.id,
      "failed",
      error,
    );

    state.readiness.markFailed(
      manifest.id,
    );

    await emitLifecycle(
      state,
      "kernel.plugin.config.failed",
      {
        pluginId:
          manifest.id,
        error:
          String(
            error,
          ),
      },
    );

    if (
      !state.tolerant
    ) {
      throw error;
    }

    await disposePlugin(
      state,
      manifest.id,
      {
        rebindConsumers:
          false,
        force:
          true,
      },
    );

    return;
  }

  state.configs.set(
    manifest.id,
    freezeValue(
      config,
    ),
  );

  const ctx =
    createContext(
      state,
      manifest.id,
      log,
    );

  try {
    state.registry.setState(
      manifest.id,
      "setup",
    );

    await emitLifecycle(
      state,
      "kernel.plugin.setup.start",
      {
        pluginId:
          manifest.id,
      },
    );

    await entry.plugin.setup(
      ctx,
    );

    await emitLifecycle(
      state,
      "kernel.plugin.setup.done",
      {
        pluginId:
          manifest.id,
      },
    );
  } catch (
    error
  ) {
    state.registry.setState(
      manifest.id,
      "failed",
      error,
    );

    state.readiness.markFailed(
      manifest.id,
    );

    log.error(
      "setup falhou",
      {
        error:
          String(
            error,
          ),
      },
    );

    await emitLifecycle(
      state,
      "kernel.plugin.setup.failed",
      {
        pluginId:
          manifest.id,
        error:
          String(
            error,
          ),
      },
    );

    if (
      !state.tolerant
    ) {
      throw error;
    }

    // Ainda não houve resolução global; não rebinde consumidores nesta fase.
    await disposePlugin(
      state,
      manifest.id,
      {
        rebindConsumers:
          false,
        force:
          true,
      },
    );
  }
}

async function resolveAll(
  state: KernelState,
  order: readonly PluginManifest[],
): Promise<void> {
  for (
    const manifest of
    order
  ) {
    const entry =
      state.registry
        .mustGet(
          manifest.id,
        );

    if (
      entry.state ===
        "failed" ||
      entry.state ===
        "disposed"
    ) {
      continue;
    }

    try {
      state.resolver.resolvePlugin(
        manifest.id,
      );
    } catch (
      error
    ) {
      state.registry.setState(
        manifest.id,
        "failed",
        error,
      );

      state.readiness.markFailed(
        manifest.id,
      );

      await emitLifecycle(
        state,
        "kernel.plugin.resolve.failed",
        {
          pluginId:
            manifest.id,
          error:
            String(
              error,
            ),
        },
      );

      if (
        !state.tolerant
      ) {
        throw error;
      }

      // Remove providers inválidos antes que dependentes posteriores sejam
      // resolvidos contra um plugin já condenado.
      await disposePlugin(
        state,
        manifest.id,
        {
          rebindConsumers:
            false,
          force:
            true,
        },
      );
    }
  }
}

async function waitReady(
  state: KernelState,
): Promise<void> {
  try {
    await state.readiness.whenReady(
      {
        timeoutMs:
          state.readyTimeoutMs,
      },
    );
  } catch (
    error
  ) {
    const isTimeout =
      error instanceof
        KernelError &&
      (
        error.code ===
          "TIMEOUT" ||
        error.code ===
          "READY_TIMEOUT"
      );

    if (
      !isTimeout
    ) {
      throw error;
    }

    const pending =
      state.readiness
        .pendingList();

    state.rootLog.warn(
      "readiness timeout",
      {
        pending,
      },
    );

    for (
      const id of
      pending
    ) {
      state.registry.setState(
        id,
        "failed",
        error,
      );

      state.readiness.markFailed(
        id,
      );

      await emitLifecycle(
        state,
        "kernel.plugin.ready.timeout",
        {
          pluginId:
            id,
        },
      );
    }

    if (
      !state.tolerant
    ) {
      throw error;
    }

    await quarantineFailedEntries(
      state,
      state.bootOrder
        .map(
          (id) =>
            state.registry
              .mustGet(
                id,
              )
              .manifest,
        ),
    );
  }
}

async function markStarted(
  state: KernelState,
  order: readonly PluginManifest[],
): Promise<void> {
  for (
    const manifest of
    order
  ) {
    const entry =
      state.registry
        .mustGet(
          manifest.id,
        );

    if (
      entry.state ===
        "failed" ||
      entry.state ===
        "disposed"
    ) {
      continue;
    }

    state.registry.setState(
      manifest.id,
      "started",
    );

    await emitLifecycle(
      state,
      "kernel.plugin.started",
      {
        pluginId:
          manifest.id,
      },
    );

    const hook =
      manifest.lifecycleHooks
        ?.onBoot;

    if (
      !hook
    ) {
      continue;
    }

    try {
      await hook(
        createContext(
          state,
          manifest.id,
          createLogger(
            manifest.id,
            {},
          ),
        ),
      );
    } catch (
      error
    ) {
      state.rootLog.error(
        `onBoot de "${manifest.id}" falhou`,
        {
          error:
            String(
              error,
            ),
        },
      );

      // O plugin já foi promovido a started; execute seu onStop exatamente
      // uma vez antes de marcá-lo como failed/disposed.
      await runOnStopHookForStarted(
        state,
        manifest.id,
      );

      state.registry.setState(
        manifest.id,
        "failed",
        error,
      );

      if (
        !state.tolerant
      ) {
        throw error;
      }

      await disposePlugin(
        state,
        manifest.id,
        {
          rebindConsumers:
            true,
          force:
            true,
        },
      );
    }
  }
}

async function quarantineFailedEntries(
  state: KernelState,
  order: readonly PluginManifest[],
): Promise<void> {
  // Dispor um provider pode marcar consumidores como failed durante rebind.
  // Repete até não restar failed não-disposed.
  let changed =
    true;

  while (
    changed
  ) {
    changed =
      false;

    for (
      const manifest of
      [
        ...order,
      ].reverse()
    ) {
      const entry =
        state.registry.get(
          manifest.id,
        );

      if (
        entry?.state !==
        "failed"
      ) {
        continue;
      }

      changed =
        true;

      await disposePlugin(
        state,
        manifest.id,
        {
          rebindConsumers:
            true,
          force:
            true,
        },
      );
    }
  }
}
