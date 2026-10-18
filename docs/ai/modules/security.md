# security — Profiler, Anti-cheat & Crash Dumper
capability: game.security@1.0.0 | category: functional | engine plugin id: game.security
dependsOn: game.loop, game.world, game.render
consumes: WorldToken, RenderToken
use (from src/projects/<jogo>/**):
  import { SecurityToken } from "../../tokens/security";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/security.ts
```ts
interface SecurityApi {
  beginSubsystemMetric(name: string): void;
  endSubsystemMetric(name: string): void;
  getProfilerSnapshot(sampleCount?: number): SystemFrameMetric; // Frames REAIS (medidos entre `game.loop.render`) em janela móvel.
  recordFrame(realDeltaSeconds?: number): void; // Registra um frame.
  resetProfiler(): void; // Zera estatísticas do profiler (frames e subsistemas).
  protectNumber(id: string, value: number): ProtectedValueDescriptor;
  readProtectedNumber(descriptor: ProtectedValueDescriptor): number | null;
  verifyIntegrity(descriptor: ProtectedValueDescriptor): boolean;
  validateSystemClock(browserDeltaMs: number, callerId?: string): Promise<boolean>; // Confere `browserDeltaMs` contra o relógio de referência (Instant nativo no Tauri; `Date.now` no navegador) de…
  createClockValidator(callerId?: string): ClockValidator; // Validador com estado próprio que mede o delta do navegador sozinho.
  getSpeedhackStatus(): SpeedhackStatus; // Estado da detecção automática (heurísticas tick/monotônico/nativo).
  setSpeedhackDetectionEnabled(enabled: boolean): void;
  dumpCrashReport(error: Error | string, options?: CrashReportOptions): Promise<CrashReportPayload>; // Gera e GRAVA (Tauri) um relatório.
  setCrashCaptureEnabled(enabled: boolean): void; // Captura automática (window error/unhandledrejection + kernel.handler.error).
  isCrashCaptureEnabled(): boolean;
  update(deltaSeconds: number): void; // Hook do tick (delta simulado): alimenta a detecção de speedhack.
  clear(): void;
}
capability SecurityToken = "game.security"@1.0.0 api SecurityApi
```
## contract src/contracts/security/types.ts
```ts
interface SubsystemProfilingMetric { // G113: `avgDurationMs`/`maxDurationMs` são da JANELA MÓVEL (últimas N medições, N = tamanho do histórico do pr…
  readonly name: string;
  readonly lastDurationMs: number;
  readonly avgDurationMs: number;
  readonly maxDurationMs: number;
  readonly sampleCount?: number; // Medições desde o início/reset.
  readonly windowSamples?: number; // Medições dentro da janela usada em avg/max.
  readonly lifetimeMaxDurationMs?: number;
}
interface SystemFrameMetric { // G113: tempos de frame REAIS (relógio de parede entre `game.loop.render`), não o delta fixo do tick.
  readonly frameIndex: number;
  readonly totalFrameTimeMs: number; // Tempo real do ÚLTIMO frame (ms).
  readonly fps: number;
  readonly subsystems: ReadonlyArray<SubsystemProfilingMetric>;
  readonly windowFrames?: number; // Frames usados nas estatísticas abaixo (janela).
  readonly avgFrameTimeMs?: number;
  readonly minFrameTimeMs?: number;
  readonly maxFrameTimeMs?: number;
}
interface ProtectedValueDescriptor { // Valor protegido OPACO (G114).
  readonly id: string;
  readonly obfuscatedValue: number;
  readonly key: number;
  readonly checksum: number;
}
interface SecurityViolationPayload {
  readonly violationType: "memory_tampering" | "speedhack_detected" | "checksum_mismatch";
  readonly details: string;
  readonly timestamp: number;
  readonly heuristic?: SpeedhackHeuristic; // Heurística que disparou (speedhack): ver `SpeedhackHeuristic`.
}
export type CrashReportSource = | "manual" | "window.error" | "unhandledrejection" | "kernel.handler";
interface CrashReportPayload {
  readonly crashId: string;
  readonly errorMessage: string;
  readonly stackTrace: string;
  readonly activeSceneId?: string; // Cena ativa do `game.world` (se disponível), senão "desconhecida".
  readonly webglRenderer?: string;
  readonly timestamp: number;
  readonly environment: Record<string, string | number>;
  readonly written?: boolean; // G115: true só se o dump foi REALMENTE gravado em disco (Tauri).
  readonly path?: string; // Caminho absoluto do arquivo gravado (Tauri).
  readonly writeError?: string; // Motivo de não ter gravado (sem Tauri, erro de IO, limite da sessão…).
  readonly source?: CrashReportSource; // G16: origem do relatório.
}
interface CrashReportOptions {
  readonly activeSceneId?: string; // Sobrepõe a cena detectada no `game.world`.
  readonly source?: CrashReportSource;
}
export type SpeedhackHeuristic = /** Tempo simulado (soma dos ticks) andou mais rápido que o relógio monotônico. */ | "tick_ahead_of_monotonic" /** `performance.now()` divergiu de `Date.now()` de forma sustentada. */ | "monotonic_vs_wall_drift" /** Relógio do JS divergiu do `Instant` monotônico nativo (Tauri). */ | "js_vs_native_drift" /** `validateSystemClock` reprovou o delta informado. */ | "caller_clock_check"; // G114: heurísticas de speedhack.
interface SpeedhackStatus {
  readonly enabled: boolean;
  readonly windowsEvaluated: number; // Janelas avaliadas desde o início/reset.
  readonly detections: number;
  readonly lastHeuristic: SpeedhackHeuristic | null;
  readonly lastTickRatio: number; // Razão (simulado/monotônico) da última janela.
  readonly lastWallRatio: number; // Razão (monotônico/parede) da última janela.
  readonly wallClockAdjustments: number; // Saltos isolados do relógio de parede ignorados (ajuste de hora do SO).
  readonly nativeAvailable: boolean; // true se a última amostra nativa (Tauri) foi usada.
}
interface ClockValidationResult {
  readonly valid: boolean;
  readonly referenceDeltaMs: number; // Delta do relógio de referência (nativo ou `Date.now`) desde a chamada anterior DESTE chamador.
  readonly browserDeltaMs: number;
  readonly source: "native" | "wall-clock" | "baseline"; // "baseline" = primeira chamada do chamador (sempre válida).
}
interface ClockValidator { // Validador de relógio com estado PRÓPRIO por chamador (G114).
  readonly callerId: string;
  validate(): Promise<ClockValidationResult>; // Mede o delta do navegador desde a chamada anterior e confere.
}
event SecurityAlertEvent = "game.security.alert" payload SecurityViolationPayload
event CrashReportGeneratedEvent = "game.security.crash-generated" payload CrashReportPayload
interface CaptureFrameMetricsPayload {
  readonly sampleCount?: number;
}
command CaptureFrameMetricsCommand = "game.security.capture-metrics" request CaptureFrameMetricsPayload
interface ValidateMemoryIntegrityPayload {
  readonly descriptors: ReadonlyArray<ProtectedValueDescriptor>;
}
command ValidateMemoryIntegrityCommand = "game.security.validate-integrity" request ValidateMemoryIntegrityPayload
interface DumpCrashReportPayload {
  readonly error: Error | string;
}
command DumpCrashReportCommand = "game.security.dump-crash" request DumpCrashReportPayload
```
## notas verificadas (comportamento)
- A engine chama `update(dt)` no tick (heurísticas de speedhack) e `recordFrame` no render. Não chame nenhum dos dois.
- Captura de erros AUTOMÁTICA (padrão ligada): `window` error/unhandledrejection e `kernel.handler.error` viram crash report (`source`) e `game.security.crash-generated`. Ouça esse evento para mostrar a tela de erro; `setCrashCaptureEnabled(false)` desliga.
- `dumpCrashReport(err, { activeSceneId?, source? })` sempre resolve: `written`/`path`/`writeError` dizem se gravou (só Tauri grava; limite padrão 10 dumps por sessão). A cena vem do `game.world`.
- Profiler: `beginSubsystemMetric(nome)`/`endSubsystemMetric(nome)` em volta dos sistemas do jogo; `getProfilerSnapshot(n)` dá FPS/tempos REAIS em janela móvel; `resetProfiler()`.
- Valores protegidos: `protectNumber(id, v)` (id vazio/valor não finito lança) → descritor opaco; `readProtectedNumber` (null se adulterado), `verifyIntegrity`.
- Speedhack: detecção automática (`getSpeedhackStatus`, alerta `game.security.alert`). Checagem própria: `createClockValidator("meu-id").validate()` periódico (estado por chamador). Nada competitivo deve confiar só no cliente.
