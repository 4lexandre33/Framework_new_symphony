/**
 * Prompts MCP — T2 (SPEC §3.1). Instruções curtas em pt-BR dizendo à IA
 * quais tools do MCP usar e em que ordem, sempre seguindo docs/ai/RULES.md.
 */

import { z } from "zod";
import { PROJECT_ID_RE } from "./core/paths.ts";
import { definePrompt, type PromptDef } from "./core/registry.ts";

const GATES = ["tsc", "test", "arch", "isolation", "agents", "stage90", "ai-manual", "build", "cargo-check", "cargo-test", "diff-check", "all"] as const;

const projectId = z
  .string()
  .regex(PROJECT_ID_RE, "id inválido: use [a-z0-9][a-z0-9-]{0,62}")
  .describe("id do jogo (pasta src/projects/<id>, ex.: meu-jogo)");

const RULES_LINE =
  "Siga docs/ai/RULES.md à risca (leia com docs_read { doc: \"RULES\" } se ainda não leu): escreva só em src/projects/<id>/, nunca altere a engine (src/core, src/engine, src/plugins, src/contracts, src/tokens, src-tauri, baselines); se faltar API, registre a lacuna com project_report_append em vez de contornar.";

export const prompts: PromptDef[] = [
  definePrompt({
    name: "criar-jogo",
    title: "Criar um jogo novo",
    description: "Cria um jogo em src/projects/<id> a partir do template, usando só a API pública da engine.",
    args: {
      id: projectId,
      nome: z.string().min(1).describe("nome exibido do jogo"),
      ideia: z.string().min(1).describe("ideia/gênero/mecânicas principais"),
    },
    render: ({ id, nome, ideia }) =>
      [
        `Crie o jogo "${nome}" (id \`${id}\`). Ideia: ${ideia}`,
        "",
        RULES_LINE,
        "",
        "Passos (tools do MCP da engine):",
        "1. engine_info (estado do repo) e docs_read { doc: \"RULES\" }, depois { doc: \"CORE\" }.",
        "2. docs_index para escolher os módulos; module_api { module } SÓ dos módulos que o jogo usa; gaps_list (filtre por módulo) antes de planejar.",
        "3. recipes_list + recipe_read das receitas relevantes (manifest/lifecycle, tick, física, render, input, HUD, save, testes).",
        `4. project_create { id: "${id}", name: "${nome}" }; implemente com project_write_file (plugin só compõe; lógica em classes testáveis; dispose de tudo; ctx.lifecycle.ready()).`,
        "5. Escreva testes do jogo dentro da pasta (receita 11) e rode project_check até ficar verde; depois gate_run { gate: \"all\" } (ou tsc/test/arch/isolation/ai-manual).",
        "6. Opcional: runtime_launch + kernel_inspect/logs_tail/screenshot para ver o jogo rodando; runtime_stop no fim.",
        "7. Registre lacunas/bugs/confirmações da engine com project_report_append. Só diga \"pronto\" com os gates verdes.",
      ].join("\n"),
  }),
  definePrompt({
    name: "corrigir-gate",
    title: "Corrigir um gate vermelho",
    description: "Roda um gate do repositório, lê as falhas estruturadas e corrige sem desativar guardrails.",
    args: {
      gate: z
        .string()
        .refine((v) => (GATES as readonly string[]).includes(v), { message: `gate desconhecido; use: ${GATES.join(", ")}` })
        .describe(`gate a corrigir: ${GATES.join(", ")}`),
    },
    render: ({ gate }) =>
      [
        `O gate \`${gate}\` precisa ficar verde.`,
        "",
        RULES_LINE,
        "",
        "Passos:",
        `1. gate_run { gate: "${gate}" } (use async: true para gates longos e acompanhe com job_status/job_log).`,
        "2. Para cada item de failures[] (file/line/message): leia o arquivo; se for de um jogo use project_read_file; para entender a API use module_api / docs_search.",
        "3. Corrija a causa no código do jogo (project_write_file). Nunca edite baselines (LAYER1_*.json), .freeze-lock.json, scripts/architecture nem desligue testes/guardrails para obter verde.",
        "4. Se a falha estiver na engine (não no jogo), não altere a engine: descreva com project_report_append (kind \"bug\") e informe o usuário.",
        `5. Rode gate_run { gate: "${gate}" } de novo até ok: true; depois rode gate_run { gate: "all" } para garantir que nada mais quebrou.`,
      ].join("\n"),
  }),
  definePrompt({
    name: "investigar-bug-runtime",
    title: "Investigar bug com o jogo rodando",
    description: "Sobe o jogo com o DevBridge e investiga um sintoma observando kernel, mundo, eventos e logs.",
    args: {
      id: projectId,
      sintoma: z.string().min(1).describe("o que está errado (ex.: 'o jogador atravessa o chão')"),
    },
    render: ({ id, sintoma }) =>
      [
        `Investigue no jogo \`${id}\` o sintoma: ${sintoma}`,
        "",
        RULES_LINE,
        "",
        "Passos:",
        `1. runtime_launch { id: "${id}" } (sem Playwright: runtime_connect_info e peça ao usuário para abrir a URL); confirme com runtime_status.`,
        "2. kernel_inspect (status ready? plugins em quarentena?) e logs_tail { level: \"error\" }.",
        "3. events_subscribe com os padrões relevantes (ex.: game.physics.*, game.world.*) e events_tail; world_entities / world_entity, physics_stats / physics_raycast, camera_get conforme o sintoma.",
        "4. Reproduza com input_send ou loop_control { action: \"pause\" | \"step\" }; capture screenshot para confirmar visualmente.",
        "5. Antes de culpar a engine: module_api do módulo envolvido e gaps_list { module } (pode ser lacuna conhecida com contorno).",
        "6. Corrija no código do jogo (project_read_file / project_write_file), valide com project_check e repita os passos 2–4.",
        "7. Se for bug da engine, registre com project_report_append (kind \"bug\", módulo, passos de reprodução). Termine com runtime_stop.",
      ].join("\n"),
  }),
  definePrompt({
    name: "nova-cena",
    title: "Criar uma cena (SceneDocument)",
    description: "Cria e valida uma cena JSON (scenes/*.scene.json) para um jogo e a carrega ao vivo.",
    args: {
      id: projectId,
      descricao: z.string().min(1).describe("o que a cena contém (entidades, layout, assets)"),
    },
    render: ({ id, descricao }) =>
      [
        `Crie uma cena no jogo \`${id}\`: ${descricao}`,
        "",
        RULES_LINE,
        "",
        "Passos:",
        "1. module_api { module: \"world\" } (SceneDocument, loadSceneDocument) e docs_search { query: \"scene document\" }; recipe_read da receita de cena se existir.",
        `2. scene_list / prefab_list { id: "${id}" } para reaproveitar prefabs; assets_list { id: "${id}" } para os assets existentes (asset_import para novos).`,
        `3. scene_create { id: "${id}", sceneId, sceneName }, depois scene_entity_add para cada entidade (ids únicos; prefab quando houver; position/rotation/scale/tags/data).`,
        "4. scene_validate até não haver erros (schema, prefab ou asset inexistente, ids repetidos); assets_validate se adicionou assets.",
        "5. No código do jogo, carregue a cena com WorldApi.loadSceneDocument (project_write_file) e rode project_check.",
        "6. Opcional: runtime_launch + scene_load_live + screenshot para conferir; runtime_stop no fim.",
      ].join("\n"),
  }),
];
