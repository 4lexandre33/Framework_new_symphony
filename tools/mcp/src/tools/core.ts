/**
 * Domínio `core` — tools do próprio servidor (smoke test).
 */

import { z } from "zod";
import { defineTool, type ToolDef } from "../core/registry.ts";

export const tools: ToolDef[] = [
  defineTool({
    name: "engine_ping",
    title: "Ping do MCP da engine",
    description: "Teste rápido: confirma que o servidor MCP da engine responde e mostra a raiz do repositório, a versão e se está em modo somente leitura.",
    output: {
      ok: z.literal(true),
      root: z.string(),
      version: z.string(),
      engineVersion: z.string().nullable(),
      readonly: z.boolean(),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    run: (_args, ctx) => ({
      ok: true as const,
      root: ctx.root,
      version: ctx.version,
      engineVersion: ctx.engineVersion,
      readonly: ctx.config.readonly,
    }),
    summarize: (out) => `engine-mcp ${out.version} ok em ${out.root}${out.readonly ? " (somente leitura)" : ""}`,
  }),
];
