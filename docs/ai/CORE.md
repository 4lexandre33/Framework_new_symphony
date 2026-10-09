# core — Kernel e contrato de plugin
import { ... } from "@core";  // única forma de importar o kernel

## src/core/contracts/plugin-manifest.ts
```ts
interface PluginDependency {
  readonly id: string;
  readonly range: string;
  readonly optional?: boolean;
}
interface SlotDeclaration {
  readonly id: string;
  readonly title?: string;
  readonly description?: string;
}
interface SlotContribution {
  readonly slot: string;
  readonly order?: number;
}
interface PluginPermissions { // Permissões declaradas no manifest.
  readonly storage?: "read" | "write" | "none";
  readonly network?: "read" | "write" | "none";
  readonly events?: readonly string[]; // Tipos de evento que o plugin pode EMITIR.
  readonly capabilities?: readonly string[]; // Ids de capability que o plugin pode consumir/fornecer.
}
interface PluginSandbox { // Só faz sentido para `kind: "external"`.
  readonly memoryMb?: number;
  readonly timeoutMs?: number;
}
interface PluginLifecycleHooks {
  onBoot?(ctx: import("./plugin-context").PluginContext): void | Promise<void>;
  onStop?(ctx: import("./plugin-context").PluginContext): void | Promise<void>;
}
interface CapabilityConflict {
  readonly id: string;
  readonly range: string;
}
interface PluginManifest {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly description?: string;
  readonly api?: string; // faixa da API do kernel (semver).
  readonly kind: PluginKind; // Camada do plugin.
  readonly authority?: string; // Publisher.
  readonly permissions?: PluginPermissions; // Permissões declaradas.
  readonly sandbox?: PluginSandbox; // Recursos do sandbox.
  readonly dependsOn?: readonly PluginDependency[];
  readonly capabilities?: { readonly provides?: readonly CapabilityProvision[]; readonly consumes?: readonly CapabilityRequirement[]; readonly conflicts?: readonly CapabilityConflict[]; };
  readonly configSchema?: ConfigSchema<Record<string, unknown>>;
  readonly definesSlots?: readonly SlotDeclaration[];
  readonly contributesTo?: readonly SlotContribution[];
  readonly tags?: readonly string[];
  readonly lifecycleHooks?: PluginLifecycleHooks;
}
```
## src/core/contracts/plugin-context.ts
```ts
interface EnvApi {
  get(key: string): string | undefined;
  has(key: string): boolean;
  require(key: string): string;
}
interface HandlerCtx {
  readonly signal: AbortSignal;
}
interface EventBusApi {
  emit<T extends string, P>(type: T, payload: P): void;
  emitAsync<T extends string, P>(type: T, payload: P): Promise<void>;
  on<T extends string, P>( type: T, handler: (env: EventEnvelope<T, P>) => void | Promise<void>, ): () => void;
  onAny(handler: (env: Envelope) => void | Promise<void>): () => void;
  define(def: EventDefinition): void;
}
interface CommandApi {
  send<T extends string, P>(type: T, payload: P): Promise<void>;
  handle<T extends string, P>( type: T, handler: (env: CommandEnvelope<T, P>, ctx: HandlerCtx) => unknown | Promise<unknown>, ): () => void;
  define(def: CommandDefinition): void;
}
interface QueryApi {
  ask<T extends string, P, R>( type: T, payload: P, opts?: { fallback?: R }, ): Promise<R>;
  answer<T extends string, P, R>( type: T, handler: (env: QueryEnvelope<T, P>, ctx: HandlerCtx) => R | Promise<R>, ): () => void;
  define(def: QueryDefinition): void;
}
interface CapabilityAwaitOptions {
  readonly timeoutMs?: number;
}
interface CapabilityDescriptor {
  readonly id: string;
  readonly version: string;
  readonly providers: readonly { readonly pluginId: string; readonly version: string; readonly priority: number; readonly description?: string; }[];
}
interface CapabilityApi {
  require<T>(token: CapabilityToken<T>): T;
  await<T>( token: CapabilityToken<T> | AsyncCapabilityToken<T>, opts?: CapabilityAwaitOptions, ): Promise<T>;
  get<T>(token: CapabilityToken<T> | AsyncCapabilityToken<T>): T | undefined;
  provide<T>( token: CapabilityToken<T> | AsyncCapabilityToken<T>, value: T, ): void;
  watch<T>( token: CapabilityToken<T> | AsyncCapabilityToken<T>, cb: (value: T | undefined) => void, ): () => void;
  list(): readonly CapabilityDescriptor[];
  has(id: string): boolean;
  requireById(id: string): unknown;
  getById(id: string): unknown | undefined;
}
interface ServiceApi { // Service Locator do kernel.
  declare<T>( token: CapabilityToken<T> | AsyncCapabilityToken<T>, ): () => void; // Registra um token sob este plugin.
  require<T>(token: CapabilityToken<T>): T; // Resolve por token tipado.
  requireById<T = unknown>(id: string): T; // Resolve por ID string.
  await<T>( token: CapabilityToken<T> | AsyncCapabilityToken<T>, ): Promise<T>; // Aguarda token tipado.
  awaitById<T = unknown>(id: string, timeoutMs?: number): Promise<T>; // Aguarda por ID.
  proxy<T extends object>( tokenOrId: CapabilityToken<T> | AsyncCapabilityToken<T> | string, ): T; // Proxy estável para serviços-objeto.
  list(): readonly { id: string; version: string; owner: string }[]; // Snapshot dos tokens registrados.
  watch<T = unknown>( id: string, cb: (value: T | undefined) => void, ): () => void; // Assina mudanças de valor por ID.
}
interface SlotApi {
  contribute<T>(slotId: string, value: T, order?: number): () => void;
  read<T = unknown>(slotId: string): SlotView<T>;
  watch<T = unknown>( slotId: string, cb: (view: SlotView<T>) => void, ): () => void;
}
interface LifecycleWhenReadyOptions {
  readonly timeoutMs?: number;
  readonly onTimeout?: (pending: readonly string[]) => void;
}
interface LifecycleApi {
  onDispose(fn: () => void | Promise<void>): void;
  ready(): void;
  whenReady(opts?: LifecycleWhenReadyOptions): Promise<void>;
  readonly scope: ResourceScope;
  fork(): ResourceScope;
}
interface PluginContext {
  readonly id: string;
  readonly log: Logger;
  readonly clock: Clock;
  readonly config: Readonly<Record<string, unknown>>;
  readonly env: EnvApi;
  readonly events: EventBusApi;
  readonly commands: CommandApi;
  readonly queries: QueryApi;
  readonly caps: CapabilityApi;
  readonly services: ServiceApi; // Service Locator.
  readonly slots: SlotApi;
  readonly scheduler: Scheduler;
  readonly tx: TransactionApi;
  readonly lifecycle: LifecycleApi;
  readonly storage: PluginStorage;
  readonly envelope: EnvelopeApi;
}
interface Plugin {
  readonly manifest: import("./plugin-manifest").PluginManifest;
  setup(ctx: PluginContext): void | Promise<void>;
}
```
## src/core/contracts/capability-token.ts
```ts
interface CapabilityToken<T> { // Um token é um identificador tipado de "algo que alguém fornece".
  readonly id: string;
  readonly version: string;
  readonly __type?: T;
  readonly schema?: Schema<T>; // Schema opcional para validar o valor no `provide()`.
}
interface AsyncCapabilityToken<T> { // Token assíncrono: o provider pode anexar o valor depois do setup inicial (ex.: abrir PGlite/Postgres antes de…
  readonly id: string;
  readonly version: string;
  readonly __type?: T;
  readonly __async: true;
  readonly schema?: Schema<T>;
}
function defineCapability<T>(id: string, version = "1.0.0", schema?: Schema<T>): CapabilityToken<T>;
function defineAsyncCapability<T>(id: string, version = "1.0.0", schema?: Schema<T>): AsyncCapabilityToken<T>;
function isAsyncToken<T>(token: CapabilityToken<T> | AsyncCapabilityToken<T>): token is AsyncCapabilityToken<T>; // Type guard: distingue token síncrono de assíncrono em runtime.
interface CapabilityProvision { // Declaração no manifest: "eu forneço X na versão Y, com prioridade Z".
  readonly id: string;
  readonly version: string; // versão concreta da implementação, semver exato
  readonly priority?: number; // maior vence quando há múltiplos.
  readonly description?: string; // descrição curta para debug
}
interface CapabilityRequirement { // Declaração no manifest: "eu preciso de X satisfazendo a faixa Y".
  readonly id: string;
  readonly range: string; // range semver: "^1.0.0", ">=2 <3", etc
  readonly optional?: boolean; // se true, ausência não impede boot — capability vira `undefined`
}
```
## src/core/contracts/plugin-kind.ts
```ts
export type PluginKind = "internal" | "preloaded" | "external"; // Camada do plugin.
const PLUGIN_KINDS: readonly PluginKind[];
function kindRank(kind: PluginKind): number;
function canDependOn(from: PluginKind, to: PluginKind): boolean; // `from` pode depender de `to`?
function isExternal(kind: PluginKind): boolean;
```
## src/core/contracts/envelope.ts
```ts
export type EnvelopeKind = "event" | "command" | "query" | "response" | "signal";
interface EnvelopeMeta {
  readonly timestamp: number;
  readonly source: string; // id do plugin emissor.
  readonly seq: number; // sequência global monotônica dentro do kernel.
  readonly correlationId?: string; // id de correlação — estável por toda a operação encadeada.
  readonly causationId?: string; // id do envelope que CAUSOU este (parent direto).
  readonly replyTo?: string; // endereço de resposta para queries/commands que esperam resposta dedicada.
  readonly ttlMs?: number; // tempo de vida em ms; kernel usa para timeout de send/ask/emitAsync.
  readonly trace?: readonly string[]; // Cadeia de `source`s por onde a operação passou, do mais antigo ao mais recente.
}
interface Envelope<K extends EnvelopeKind = EnvelopeKind, T extends string = string, P = unknown> {
  readonly id: string;
  readonly kind: K;
  readonly type: T;
  readonly payload: P;
  readonly meta: EnvelopeMeta;
}
export type EventEnvelope<T extends string = string, P = unknown> = Envelope<"event", T, P>;
export type CommandEnvelope<T extends string = string, P = unknown> = Envelope<"command", T, P>;
export type QueryEnvelope<T extends string = string, P = unknown> = Envelope<"query", T, P>;
export type ResponseEnvelope<T extends string = string, P = unknown> = Envelope<"response", T, P>;
export type SignalEnvelope<T extends string = string, P = unknown> = Envelope<"signal", T, P>;
interface MakeEnvelopeArgs<K extends EnvelopeKind, T extends string, P> {
  kind: K;
  type: T;
  payload: P;
  source?: string;
  id?: string;
  parent?: Envelope; // Envelope pai.
  meta?: Partial<Omit<EnvelopeMeta, "timestamp" | "source" | "seq">> & { source?: string; seq?: number; timestamp?: number; };
}
function makeEnvelope<K extends EnvelopeKind, T extends string, P>(args: MakeEnvelopeArgs<K, T, P>): Envelope<K, T, P>;
```
