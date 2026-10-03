// src/core/runtime/pipeline.ts
import type { KernelState } from "./state";
import type {
  EventEnvelope,
  CommandEnvelope,
  QueryEnvelope,
} from "../contracts/envelope";
import type { DispatchEnvelope, DispatchResult } from "../contracts/dispatch-envelope";
import { makeEnvelope } from "../contracts/envelope";
import { freezeEnvelope } from "../internal/freeze";
import { assertCanUseCapability } from "./permissions";

// ── Build ──────────────────────────────────────────────────────────────

export function buildEventEnvelope<T extends string, P>(
  state: KernelState,
  type: T,
  payload: P,
  source: string,
): EventEnvelope<T, P> {
  const env = makeEnvelope({
    kind: "event",
    type,
    payload,
    source,
    meta: { seq: state.nextSeq(), source },
  });
  return freezeEnvelope(env) as EventEnvelope<T, P>;
}

export function buildCommandEnvelope<T extends string, P>(
  state: KernelState,
  type: T,
  payload: P,
  source: string,
): CommandEnvelope<T, P> {
  const env = makeEnvelope({
    kind: "command",
    type,
    payload,
    source,
    meta: { seq: state.nextSeq(), source },
  });
  return freezeEnvelope(env) as CommandEnvelope<T, P>;
}

export function buildQueryEnvelope<T extends string, P>(
  state: KernelState,
  type: T,
  payload: P,
  source: string,
): QueryEnvelope<T, P> {
  const env = makeEnvelope({
    kind: "query",
    type,
    payload,
    source,
    meta: { seq: state.nextSeq(), source },
  });
  return freezeEnvelope(env) as QueryEnvelope<T, P>;
}

// ── Through ────────────────────────────────────────────────────────────

export async function emitThroughPipeline(
  state: KernelState,
  env: EventEnvelope,
): Promise<void> {
  const err = validateEvent(state, env);
  if (err) throw err;

  for (const sub of state.testSubscribers) {
    try { sub(env); } catch { /* hostil */ }
  }

  await state.middleware.run(env, async (current) => {
    await state.events.emitAsync(current as EventEnvelope);
  });
}

export async function sendThroughPipeline(
  state: KernelState,
  env: CommandEnvelope,
  signal: AbortSignal,
): Promise<void> {
  const err = validateCommand(state, env);
  if (err) throw err;

  for (const sub of state.testSubscribers) {
    try { sub(env); } catch { /* hostil */ }
  }

  await state.middleware.run(env, async (current) => {
    await state.dispatcher.send(current as CommandEnvelope, signal);
  });
}

export async function askThroughPipeline<R>(
  state: KernelState,
  env: QueryEnvelope,
  signal: AbortSignal,
  fallback?: R,
): Promise<R> {
  const err = validateQuery(state, env);
  if (err) throw err;

  let result: R | undefined;
  let captured = false;
  await state.middleware.run(env, async (current) => {
    result = await state.dispatcher.ask<R>(current as QueryEnvelope, signal, fallback);
    captured = true;
  });
  if (!captured) return fallback as R;
  return result as R;
}

export async function dispatchCapabilityThroughPipeline<T = unknown>(
  state: KernelState,
  pluginId: string,
  env: DispatchEnvelope,
): Promise<DispatchResult<T>> {
  const manifest = state.registry.mustGet(pluginId).manifest;
  assertCanUseCapability(manifest, env.capability);
  const wrapped = freezeEnvelope(makeEnvelope({
    kind: "query",
    type: `${env.capability}#${env.type}@${env.version}`,
    payload: env.payload,
    source: pluginId,
    meta: { seq: state.nextSeq(), source: pluginId },
  }));
  let result: DispatchResult<T> = { ok: false, error: "middleware stopped dispatch" };
  await state.middleware.run(wrapped, async () => {
    result = await state.envelopeDispatcher.dispatch<T>(env);
  });
  return result;
}

// ── Validation (privado) ───────────────────────────────────────────────

function validateEvent(state: KernelState, env: EventEnvelope): Error | undefined {
  try {
    state.eventRegistry.validate(env.type, env.payload);
    return undefined;
  } catch (err) {
    return err as Error;
  }
}

function validateCommand(state: KernelState, env: CommandEnvelope): Error | undefined {
  try {
    state.commandRegistry.validate(env.type, env.payload);
    return undefined;
  } catch (err) {
    return err as Error;
  }
}

function validateQuery(state: KernelState, env: QueryEnvelope): Error | undefined {
  try {
    state.queryRegistry.validate(env.type, env.payload);
    return undefined;
  } catch (err) {
    return err as Error;
  }
}