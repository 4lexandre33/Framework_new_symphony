// @ai-why:  Fachada pública do kernel. Ninguém importa sub-path de @core fora do próprio core.
// @ai-link: —
// @ai-keep: NÃO re-exporte bootstrap daqui (ciclo core→bootstrap→core). Bootstrap vive em src/bootstrap/.

// src/core/index.ts
//
// ─────────────────────────────────────────────────────────────────────
// FACHADA PÚBLICA DO KERNEL
// ─────────────────────────────────────────────────────────────────────
//
// Regra arquitetural: nada fora de `src/core/` importa de um sub-path
// deste módulo (`@core/internal/*`, `@core/runtime/*`). Todos os
// consumidores importam daqui (`@core`).
//
// Quando um arquivo se move dentro do core, esta fachada é o ÚNICO
// lugar que muda. O resto do projeto nem sabe.
//
// CHANGED (vs. dump): removido o `export { bootstrap, ... } from
// "./bootstrap"`. Bootstrap vive em `src/bootstrap/` (irmão de
// `src/core/`) e re-exportá-lo aqui criaria ciclo de módulos
// (`core/index → bootstrap/index → core/api → ... → core/index`), que
// em ESM funciona por sorte na ordem de avaliação e quebra em bundlers
// que reordenam ou fazem tree-shaking agressivo.

// ── Kernel (classe principal) ──────────────────────────────────────────
export { Kernel } from "./kernel";

// ── Fábrica / singleton ────────────────────────────────────────────────
export {
  getKernel,
  createKernel,
  bootKernel,
  resetKernelForTests,
} from "./api";

// ── Devtools / testing ─────────────────────────────────────────────────
export { inspect } from "./api/devtools";
export type {
  KernelInspection,
  KernelInspectionPlugin,
  KernelInspectionCapability,
} from "./api/devtools";
export { createTestKernel } from "./api/testing";
export { checkPluginConformance } from "./api/plugin-conformance";
export type { PluginConformanceReport } from "./api/plugin-conformance";
export type { TestKernel, CreateTestKernelOptions } from "./api/testing";

// ── Tipos públicos de topo ─────────────────────────────────────────────
// Vêm de `kernel-types.ts` (ponto único). Inclui `KernelOptions`,
// `KernelState`, `KernelStatus`, `KernelPluginSnapshot`, `Logger`,
// `LogEntry`, `Middleware`, etc., e `KERNEL_API_VERSION`.
export * from "./kernel-types";

// ── Contratos (fachada dos contratos) ──────────────────────────────────
// `contracts/index.ts` re-exporta tudo o que é tipo/schema/envelope/
// erro/contexto. Se um contrato se mover dentro de `contracts/`, só o
// `contracts/index.ts` muda. Ninguém fora do core repara.
//
// Daqui saem `Plugin`, `PluginContext`, `PluginManifest`,
// `KernelError`, `CapabilityToken`, `Envelope`, `Schema`, etc.
export * from "./contracts";
// ── Utilitário SemVer público ────────────────────────────────────────────
// Exposto de forma explícita para validação de ranges de plugins/modding.
// Não transforma `internal/*` em API pública genérica.
export { satisfies } from "./internal/semver";