import type { PluginContext } from "@core";
import { type SecurityApi } from "../../../tokens/security";
import { CrashReportGeneratedEvent, SecurityAlertEvent, type CrashReportPayload, type ProtectedValueDescriptor, type SystemFrameMetric } from "../../../contracts/security/types";
import { FrameProfiler } from "./FrameProfiler";
import { MemoryIntegrityGuard } from "./MemoryIntegrityGuard";
import { CrashReportDumper } from "./CrashReportDumper";
import { TauriSecurityDriver } from "./TauriSecurityDriver";

export class SecurityService implements SecurityApi {
  private readonly profiler = new FrameProfiler();
  private readonly guard = new MemoryIntegrityGuard();
  private readonly dumper = new CrashReportDumper();
  private readonly driver = new TauriSecurityDriver();

  public constructor(
    private readonly ctx: PluginContext,
  ) {}

  public beginSubsystemMetric(name: string): void {
    this.profiler.beginSubsystem(name);
  }

  public endSubsystemMetric(name: string): void {
    this.profiler.endSubsystem(name);
  }

  public getProfilerSnapshot(sampleCount?: number): SystemFrameMetric {
    return this.profiler.getProfilerSnapshot(sampleCount);
  }

  public protectNumber(
    id: string,
    value: number,
  ): ProtectedValueDescriptor {
    return this.guard.protectNumber(id, value);
  }

  public readProtectedNumber(
    descriptor: ProtectedValueDescriptor,
  ): number | null {
    const value = this.guard.readProtectedNumber(descriptor);

    if (value === null) {
      this.emitSecurityAlert(
        "memory_tampering",
        `Adulteração detectada na variável protegida: ${descriptor.id}`,
      );
    }

    return value;
  }

  public verifyIntegrity(
    descriptor: ProtectedValueDescriptor,
  ): boolean {
    return this.guard.verifyIntegrity(descriptor);
  }

  public validateMemoryIntegrity(
    descriptors: ReadonlyArray<ProtectedValueDescriptor>,
  ): boolean {
    const invalidIds: string[] = [];

    for (let index = 0; index < descriptors.length; index += 1) {
      const descriptor = descriptors[index];

      if (!descriptor) {
        continue;
      }

      if (!this.guard.verifyIntegrity(descriptor)) {
        invalidIds.push(descriptor.id);
      }
    }

    if (invalidIds.length === 0) {
      return true;
    }

    this.emitSecurityAlert(
      "checksum_mismatch",
      `Checksum inválido em ${invalidIds.length} variável(is): ${invalidIds.join(", ")}`,
    );

    return false;
  }

  public async validateSystemClock(browserDeltaMs: number): Promise<boolean> {
    const result = await this.driver.validateSystemClock(browserDeltaMs);

    if (!result.valid) {
      this.emitSecurityAlert(
        "speedhack_detected",
        `Desvio de tempo detectado entre navegador e SO: ${browserDeltaMs}ms vs ${result.osDeltaMs}ms`,
      );
    }

    return result.valid;
  }

  public async dumpCrashReport(
    error: Error | string,
  ): Promise<CrashReportPayload> {
    const report = this.dumper.generateReport(error);

    await this.driver.writeCrashDump(report);

    this.ctx.events.emit(
      CrashReportGeneratedEvent.type,
      report,
    );

    return report;
  }

  public update(deltaSeconds: number): void {
    this.profiler.updateFrame(deltaSeconds);
  }

  public clear(): void {
    this.profiler.clear();
    this.guard.rotateKey();
  }

  private emitSecurityAlert(
    violationType: "memory_tampering" | "speedhack_detected" | "checksum_mismatch",
    details: string,
  ): void {
    this.ctx.events.emit(
      SecurityAlertEvent.type,
      {
        violationType,
        details,
        timestamp: Date.now(),
      },
    );
  }
}
