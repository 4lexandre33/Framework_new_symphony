import {
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { CrashReportDumper } from "../src/engine/security/internal/CrashReportDumper";
import { FrameProfiler } from "../src/engine/security/internal/FrameProfiler";
import { MemoryIntegrityGuard } from "../src/engine/security/internal/MemoryIntegrityGuard";
import { securityManifest } from "../src/plugins/security/plugin";
import { SecurityToken } from "../src/tokens/security";

describe(
  "Camada de Segurança, Profiling & Crash Report (game.security)",
  (): void => {
    let guard: MemoryIntegrityGuard;
    let dumper: CrashReportDumper;

    beforeEach((): void => {
      guard = new MemoryIntegrityGuard();
      dumper = new CrashReportDumper();
    });

    describe("FrameProfiler", (): void => {
      it("deve medir last/avg/max reais por subsistema", (): void => {
        let nowMs = 100;
        const profiler = new FrameProfiler((): number => nowMs);

        profiler.beginSubsystem("physics");
        nowMs += 2;
        profiler.endSubsystem("physics");

        profiler.beginSubsystem("physics");
        nowMs += 4;
        profiler.endSubsystem("physics");

        profiler.updateFrame(1 / 60);

        const snapshot = profiler.getProfilerSnapshot();
        const physicsMetric = snapshot.subsystems.find(
          (metric): boolean => metric.name === "physics",
        );

        expect(physicsMetric).toBeDefined();
        expect(physicsMetric?.lastDurationMs).toBe(4);
        expect(physicsMetric?.avgDurationMs).toBe(3);
        expect(physicsMetric?.maxDurationMs).toBe(4);
        expect(snapshot.totalFrameTimeMs).toBeCloseTo(16.667, 3);
        expect(snapshot.fps).toBe(60);
      });

      it("deve usar apenas as amostras mais recentes quando sampleCount for informado", (): void => {
        const profiler = new FrameProfiler((): number => 0);

        profiler.updateFrame(0.01);
        profiler.updateFrame(0.02);

        expect(profiler.getProfilerSnapshot(1).fps).toBe(50);
        expect(profiler.getProfilerSnapshot(2).fps).toBe(67);
      });

      it("deve ignorar endSubsystem sem begin correspondente e limpar o estado", (): void => {
        let nowMs = 10;
        const profiler = new FrameProfiler((): number => nowMs);

        profiler.endSubsystem("audio");
        expect(profiler.getProfilerSnapshot().subsystems).toHaveLength(0);

        profiler.beginSubsystem("audio");
        nowMs += 1;
        profiler.endSubsystem("audio");
        profiler.updateFrame(0.016);

        expect(profiler.getProfilerSnapshot().subsystems).toHaveLength(1);

        profiler.clear();
        const cleared = profiler.getProfilerSnapshot();

        expect(cleared.frameIndex).toBe(0);
        expect(cleared.fps).toBe(0);
        expect(cleared.subsystems).toHaveLength(0);
      });
    });

    describe("MemoryIntegrityGuard", (): void => {
      it("deve ofuscar e recuperar exatamente números finitos", (): void => {
        const values = [
          100.5,
          -42.25,
          0,
          -0,
          Number.MIN_VALUE,
          Number.MAX_VALUE,
          1e-120,
          -1e120,
        ];

        for (let index = 0; index < values.length; index += 1) {
          const originalValue = values[index] ?? 0;
          const descriptor = guard.protectNumber(
            `protected_${index}`,
            originalValue,
          );

          expect(Object.is(descriptor.obfuscatedValue, originalValue)).toBe(false);

          const recoveredValue = guard.readProtectedNumber(descriptor);
          expect(recoveredValue).not.toBeNull();
          expect(Object.is(recoveredValue, originalValue)).toBe(true);
        }
      });

      it("deve identificar adulteração do valor ofuscado", (): void => {
        const descriptor = guard.protectNumber("player_gold", 500);
        const tamperedDescriptor = {
          ...descriptor,
          obfuscatedValue: descriptor.obfuscatedValue + 999,
        };

        expect(guard.verifyIntegrity(tamperedDescriptor)).toBe(false);
        expect(guard.readProtectedNumber(tamperedDescriptor)).toBeNull();
      });

      it("deve identificar adulteração de checksum e chave", (): void => {
        const descriptor = guard.protectNumber("player_health", 100.5);

        expect(
          guard.verifyIntegrity({
            ...descriptor,
            checksum: (descriptor.checksum + 1) >>> 0,
          }),
        ).toBe(false);

        expect(
          guard.verifyIntegrity({
            ...descriptor,
            key: (descriptor.key ^ 0x1234) >>> 0,
          }),
        ).toBe(false);
      });

      it("deve rejeitar valores não finitos", (): void => {
        expect((): void => {
          guard.protectNumber("nan", Number.NaN);
        }).toThrow();

        expect((): void => {
          guard.protectNumber("infinity", Number.POSITIVE_INFINITY);
        }).toThrow();
      });

      it("deve manter descritores existentes válidos após rotação da chave para novos valores", (): void => {
        const descriptor = guard.protectNumber("persistent_value", 77.25);

        guard.rotateKey();

        expect(guard.verifyIntegrity(descriptor)).toBe(true);
        expect(guard.readProtectedNumber(descriptor)).toBe(77.25);
      });

      it("deve detectar desvio temporal acima da tolerância configurada", (): void => {
        expect(guard.checkSpeedhack(100, 100, 0.25)).toBe(false);
        expect(guard.checkSpeedhack(200, 100, 0.25)).toBe(true);
        expect(guard.checkSpeedhack(Number.NaN, 100, 0.25)).toBe(false);
      });
    });

    describe("CrashReportDumper", (): void => {
      it("deve gerar um relatório de crash completo com mensagens e ambiente", (): void => {
        const error = new Error("Falha no contexto WebGL");
        const report = dumper.generateReport(error, "Fase1_Boss");

        expect(report.crashId).toMatch(/^crash_[A-Za-z0-9_-]+$/);
        expect(report.errorMessage).toBe("Falha no contexto WebGL");
        expect(report.stackTrace.length).toBeGreaterThan(0);
        expect(report.activeSceneId).toBe("Fase1_Boss");
        expect(report.environment.platform).toBeDefined();
      });

      it("deve gerar fallback de stack trace quando receber apenas string", (): void => {
        const report = dumper.generateReport("Falha textual");

        expect(report.errorMessage).toBe("Falha textual");
        expect(report.stackTrace).toBe("Stack trace não disponível");
      });
    });

    describe("Plugin game.security", (): void => {
      it("deve publicar SecurityToken e depender explicitamente de game.loop", (): void => {
        expect(
          securityManifest.capabilities?.provides?.some(
            (capability): boolean => capability.id === SecurityToken.id,
          ),
        ).toBe(true);

        expect(
          securityManifest.dependsOn?.some(
            (dependency): boolean =>
              dependency.id === "game.loop" && dependency.range === "^1.0.0",
          ),
        ).toBe(true);
      });
    });
  },
);
