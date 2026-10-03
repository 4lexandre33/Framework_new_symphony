// @ai-why:  Fachada dos contratos. Re-exporta tudo exceto tokens/*.
// @ai-link: —
// @ai-keep: se mover um contrato dentro de contracts/, só este arquivo muda. NÃO adicione tokens aqui (vivem em @tokens).

// src/core/contracts/index.ts
//
// ─────────────────────────────────────────────────────────────────────
// FACHADA DOS CONTRATOS
// ─────────────────────────────────────────────────────────────────────
//
// Re-exporta tudo o que é superfície pública de `contracts/`. Se um
// contrato se move dentro deste diretório (ex.: `errors.ts` →
// `errors/root.ts`), este arquivo é o único que muda — os
// consumidores importam `@core` e nem sabem.
//
// NÃO re-exporta `contracts/tokens/*` — tokens canônicos vivem em
// `src/tokens/` (fachada própria). Ver comentário no fim.

export * from "./capability-token";
export * from "./clock";
export * from "./commands";
export * from "./envelope";
export * from "./errors";
export * from "./events";
export * from "./kernel-options";
export * from "./kernel-state";
export * from "./kernel-version";
export * from "./logger";
export * from "./middleware";
export * from "./plugin-config";
export * from "./plugin-context";
export * from "./plugin-kind";
export * from "./plugin-storage";
export * from "./dispatch-envelope";
export * from "./plugin-manifest";
export * from "./queries";
export * from "./scheduler";
export * from "./schema";
export * from "./slot";
export * from "./transaction";
export * from "./typed-event";

// CHANGED (vs. dump): comentário atualizado. Se a pasta
// `contracts/tokens/` foi mesmo apagada, manter assim. Se ainda existir
// (código morto), apagar a pasta — os tokens duplicados mascarariam
// futuras regressões (alguém importaria de `@core/contracts/tokens/`
// em vez de `@tokens/`).