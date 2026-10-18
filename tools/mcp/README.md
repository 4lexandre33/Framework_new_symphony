# tools/mcp — servidor MCP da engine (para quem contribui)

Especificação: [`docs/mcp/SPEC.md`](../../docs/mcp/SPEC.md) · plano:
[`docs/mcp/TASK_GRAPH.md`](../../docs/mcp/TASK_GRAPH.md).

```bash
npm run mcp              # sobe em stdio (o Claude Code usa .mcp.json)
npm run mcp:typecheck    # tsc só do MCP + tests/mcp
npx vitest run tests/mcp
```

## Estrutura

```
src/server.ts            createEngineMcpServer() + main() (stdio)
src/core/registry.ts     defineTool / defineResource / definePrompt + envelope
src/core/context.ts      ToolContext (ctx) entregue a toda tool
src/core/paths.ts        caminhos seguros, áreas graváveis, escrita atômica
src/core/exec.ts         comandos da allowlist (sem shell)
src/core/jobs.ts         JobManager (tarefas longas)
src/core/errors.ts       McpToolError + códigos (SPEC §4)
src/tools/<domínio>.ts   um arquivo por domínio, cada um com dono (TASK_GRAPH)
src/resources.ts         resources engine://… (T2)
src/prompts.ts           prompts (T2)
```

`src/tools/index.ts` já agrega todos os domínios: **não é preciso editá-lo**
para adicionar tools — basta preencher o array `tools` do seu arquivo.

## Adicionar uma tool

```ts
// src/tools/projects.ts
import { z } from "zod";
import { McpToolError } from "../core/errors.ts";
import { defineTool, type ToolDef } from "../core/registry.ts";

export const tools: ToolDef[] = [
  defineTool({
    name: "project_files",                       // snake_case, único
    title: "Arquivos de um jogo",
    description: "Árvore de arquivos de src/projects/<id>.",
    input: { id: z.string().describe("id do projeto") },   // shape cru = objeto estrito
    output: { files: z.array(z.string()) },      // opcional; vira outputSchema e é validado
    annotations: { readOnlyHint: true },
    summarize: (out) => `${out.files.length} arquivo(s)`,
    run: async ({ id }, ctx, call) => {
      const dir = ctx.paths.projectDir(id);      // valida o id
      if (!existsSync(dir)) throw new McpToolError("NOT_FOUND", `jogo ${id} não existe`, "Use project_list.");
      return { files: [...] };                   // vira structuredContent + texto
    },
  }),
];
```

- **Retorno**: um objeto JSON (vira `structuredContent` + texto "resumo + JSON").
  Para imagens ou resumo próprio: `return toolResult({ data, summary, images: [{ data: base64, mimeType: "image/png" }] })`.
- **Erros**: `throw new McpToolError(code, message, hint?)` → `isError: true` +
  `{ code, message, hint }` (em `_meta["engine-mcp/error"]` sempre e em
  `structuredContent` quando a tool não tem `output`). Exceção qualquer → `INTERNAL`;
  `ZodError` lançado no `run` → `SCHEMA_INVALID`; entrada inválida → `INVALID_INPUT`.
- **Escrita**: sempre por `ctx.paths.writeFileAtomic(rel, data)` / `mkdirp` /
  `remove` (ou `ctx.paths.assertWritable(rel)` antes de escrever). Leitura: resolva com
  `ctx.paths.resolve(rel)`. Nunca use caminhos crus do cliente.
- **Comandos**: `await ctx.exec.runAllowed("npm", ["run", "arch:check"], { timeoutMs })`
  → `{ code, stdout, stderr, durationMs, timedOut, aborted, … }`; `ensureSuccess(r, label)`
  converte em `TIMEOUT`/`COMMAND_FAILED`. Passe `signal: call.signal` para cancelar
  junto com o cliente.
- **Tarefa longa**: `const job = ctx.jobs.start(label, "npx", ["vitest", "run"], { env })`
  e devolva `{ jobId: job.jobId }`; o cliente acompanha com `job_status`/`job_log`.
- **Estado por servidor** (sockets, sessões): exporte `init(ctx)`/`dispose(ctx)` no
  arquivo do domínio ou use `ctx.onDispose(fn)`. Guarde estado num `WeakMap<ToolContext, …>`
  — os testes criam vários servidores no mesmo processo.
- **Log**: `ctx.log.info(...)` (stderr). Nunca `console.log`: stdout é o protocolo.

## Testes

```ts
import { createTestClient, makeTempRepo } from "./harness.ts";

const repo = await makeTempRepo({ copy: ["tsconfig.json"] }); // opcional (escrita)
const t = await createTestClient({ root: repo.root });       // sem root = repo real
expect(await t.callTool("project_files", { id: "x" })).toEqual({ files: [] });
await expect(t.callTool("project_files", { id: "../x" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
await t.close(); await repo.cleanup();
```

Cada tool precisa de um teste de sucesso e um de erro (SPEC §5.2), em
`tests/mcp/<domínio>.test.ts`. Domínios/tools falsos: `createTestClient({ domains: [...] })`.
