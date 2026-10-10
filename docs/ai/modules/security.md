# security — Profiler, Anti-cheat & Crash Dumper
capability: game.security@1.0.0 | category: functional | engine plugin id: game.security
dependsOn: game.loop
use (from src/projects/<jogo>/**):
  import { SecurityToken } from "../../tokens/security";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/security.ts
```ts
interface SecurityApi {
  beginSubsystemMetric(name: string): void;
  endSubsystemMetric(name: string): void;
  getProfilerSnapshot(sampleCount?: number): SystemFrameMetric;
  protectNumber(id: string, value: number): ProtectedValueDescriptor;
  readProtectedNumber(descriptor: ProtectedValueDescriptor): number | null;
  verifyIntegrity(descriptor: ProtectedValueDescriptor): boolean;
  validateSystemClock(browserDeltaMs: number): Promise<boolean>;
  dumpCrashReport(error: Error | string): Promise<CrashReportPayload>;
  update(deltaSeconds: number): void;
  clear(): void;
}
capability SecurityToken = "game.security"@1.0.0 api SecurityApi
```
## contract src/contracts/security/types.ts
```ts
interface SubsystemProfilingMetric {
  readonly name: string;
  readonly lastDurationMs: number;
  readonly avgDurationMs: number;
  readonly maxDurationMs: number;
}
interface SystemFrameMetric {
  readonly frameIndex: number;
  readonly totalFrameTimeMs: number;
  readonly fps: number;
  readonly subsystems: ReadonlyArray<SubsystemProfilingMetric>;
}
interface ProtectedValueDescriptor {
  readonly id: string;
  readonly obfuscatedValue: number;
  readonly key: number;
  readonly checksum: number;
}
interface SecurityViolationPayload {
  readonly violationType: "memory_tampering" | "speedhack_detected" | "checksum_mismatch";
  readonly details: string;
  readonly timestamp: number;
}
interface CrashReportPayload {
  readonly crashId: string;
  readonly errorMessage: string;
  readonly stackTrace: string;
  readonly activeSceneId?: string;
  readonly webglRenderer?: string;
  readonly timestamp: number;
  readonly environment: Record<string, string | number>;
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
- A engine chama `update(dt)` no tick.
- `protectNumber`/`readProtectedNumber`/`verifyIntegrity` são puros (em memória). `protectNumber` lança com id vazio ou valor não finito.
- `dumpCrashReport(err)` resolve com o relatório e emite `game.security.crash-generated` mesmo sem Tauri.
- NÃO há captura automática de erros: o jogo registra `window.addEventListener("error"/"unhandledrejection")` num adapter e chama `dumpCrashReport` (remova no dispose).
- Profiler: `beginSubsystemMetric(nome)`/`endSubsystemMetric(nome)` em volta de cada sistema do jogo; leia `getProfilerSnapshot()`.
