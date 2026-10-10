// Gerador do Manual de IA: digest compacto (assinaturas TypeScript) extraído do código real.
// Formato escolhido: TypeScript compacto, porque (1) o modelo já o domina, sem custo de ensinar
// uma DSL; (2) é a fonte da verdade e é verificável; (3) gerado ⇒ não deriva do código.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export const AI_MANUAL_DIR = "docs/ai";
export const AI_MANUAL_VERSION = "1.0.0";

const MAX_DOC = 110;

function loadTs(root) {
  return createRequire(path.join(root, "package.json"))("typescript");
}

function oneLine(text) {
  return text.replace(/\s+/gu, " ").trim();
}

function docOf(ts, node) {
  const docs = ts.getJSDocCommentsAndTags ? node.jsDoc : node.jsDoc;
  if (!docs || docs.length === 0) return "";
  const comment = docs[docs.length - 1].comment;
  const text = typeof comment === "string" ? comment : Array.isArray(comment) ? comment.map((c) => c.text ?? "").join("") : "";
  const first = oneLine(text).split(/(?<=[.!?])\s/u)[0] ?? "";
  return first.length > MAX_DOC ? `${first.slice(0, MAX_DOC - 1)}…` : first;
}

function textOf(sf, node) {
  return oneLine(node.getText(sf));
}

function typeArgs(sf, call) {
  return (call.typeArguments ?? []).map((t) => textOf(sf, t));
}

function declKinds(ts, node) {
  return {
    isExported: (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0,
  };
}

/** Compacta um arquivo .ts em linhas de digest. */
export function digestSource(ts, fileName, source, { includeNonExported = false } = {}) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const out = [];

  for (const node of sf.statements) {
    if (ts.isImportDeclaration(node)) continue;
    if (ts.isExportDeclaration(node)) continue;
    const { isExported } = declKinds(ts, node);
    if (!isExported && !includeNonExported) continue;
    const doc = docOf(ts, node);
    const docSuffix = doc ? ` // ${doc}` : "";

    if (ts.isInterfaceDeclaration(node)) {
      const head = `interface ${node.name.text}${node.typeParameters ? `<${node.typeParameters.map((p) => textOf(sf, p)).join(", ")}>` : ""}${node.heritageClauses ? ` ${node.heritageClauses.map((h) => textOf(sf, h)).join(" ")}` : ""}`;
      out.push(`${head} {${docSuffix}`);
      for (const member of node.members) {
        const mdoc = docOf(ts, member);
        let line = textOf(sf, member).replace(/;$/u, "");
        out.push(`  ${line};${mdoc ? ` // ${mdoc}` : ""}`);
      }
      out.push("}");
    } else if (ts.isTypeAliasDeclaration(node)) {
      out.push(`${textOf(sf, node)}${docSuffix}`);
    } else if (ts.isEnumDeclaration(node)) {
      out.push(`${textOf(sf, node)}${docSuffix}`);
    } else if (ts.isFunctionDeclaration(node)) {
      const params = node.parameters.map((p) => textOf(sf, p)).join(", ");
      const generics = node.typeParameters ? `<${node.typeParameters.map((p) => textOf(sf, p)).join(", ")}>` : "";
      const ret = node.type ? `: ${textOf(sf, node.type)}` : "";
      out.push(`function ${node.name?.text ?? "default"}${generics}(${params})${ret};${docSuffix}`);
    } else if (ts.isClassDeclaration(node)) {
      out.push(`class ${node.name?.text ?? "default"} {${docSuffix}`);
      for (const member of node.members) {
        const hidden = (ts.getCombinedModifierFlags(member) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) !== 0;
        if (hidden || ts.isConstructorDeclaration(member) && false) continue;
        if (ts.isMethodDeclaration(member) || ts.isPropertyDeclaration(member) || ts.isGetAccessor(member) || ts.isConstructorDeclaration(member)) {
          const sig = textOf(sf, member).replace(/\{.*$/u, "").replace(/\s*=.*$/u, "").trim();
          out.push(`  ${sig};`);
        }
      }
      out.push("}");
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        const name = decl.name.getText(sf);
        const init = decl.initializer;
        if (init && ts.isCallExpression(init)) {
          const callee = init.expression.getText(sf);
          const args = typeArgs(sf, init);
          const lit = init.arguments.map((a) => (ts.isStringLiteralLike(a) ? a.text : "")).filter(Boolean);
          if (callee === "defineEvent") {
            out.push(`event ${name} = "${lit[0] ?? ""}" payload ${args[1] ?? args[0] ?? "unknown"}${docSuffix}`);
            continue;
          }
          if (callee === "defineCommand") {
            out.push(`command ${name} = "${lit[0] ?? ""}" request ${args[1] ?? "unknown"}${args[2] ? ` -> ${args[2]}` : ""}${docSuffix}`);
            continue;
          }
          if (callee === "defineQuery") {
            out.push(`query ${name} = "${lit[0] ?? ""}" ${args.join(", ")}${docSuffix}`);
            continue;
          }
          if (callee === "defineCapability") {
            out.push(`capability ${name} = "${lit[0] ?? ""}"@${lit[1] ?? "?"} api ${args[0] ?? "unknown"}${docSuffix}`);
            continue;
          }
        }
        const typeText = decl.type ? `: ${textOf(sf, decl.type)}` : "";
        const short = init && (ts.isLiteralExpression(init) || ts.isNumericLiteral(init) || init.kind === ts.SyntaxKind.TrueKeyword || init.kind === ts.SyntaxKind.FalseKeyword) ? ` = ${textOf(sf, init)}` : "";
        out.push(`const ${name}${typeText}${short};${docSuffix}`);
      }
    }
  }
  return out;
}

function read(root, relative) {
  return fs.readFileSync(path.join(root, ...relative.split("/")), "utf8").replace(/\r\n/gu, "\n");
}

function approxTokens(text) {
  return Math.ceil(text.length / 3.6);
}

function pluginDeps(ts, source) {
  const sf = ts.createSourceFile("plugin.ts", source, ts.ScriptTarget.Latest, true);
  const found = { dependsOn: new Set(), consumes: new Set() };
  const idOf = (obj) => {
    for (const prop of obj.properties) {
      if (ts.isPropertyAssignment(prop) && prop.name.getText(sf) === "id") {
        const v = prop.initializer;
        if (ts.isStringLiteralLike(v)) return v.text;
        if (ts.isPropertyAccessExpression(v)) return v.expression.getText(sf);
      }
    }
    return null;
  };
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && ts.isArrayLiteralExpression(node.initializer)) {
      const name = node.name.getText(sf);
      if (name === "dependsOn" || name === "consumes") {
        for (const el of node.initializer.elements) {
          if (ts.isObjectLiteralExpression(el)) {
            const id = idOf(el);
            if (id) found[name].add(id);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { dependsOn: [...found.dependsOn], consumes: [...found.consumes] };
}

function tokenNames(tokenSource) {
  return [...tokenSource.matchAll(/export const (\w+Token)\b/gu)].map((m) => m[1]);
}

const CORE_FILES = [
  "src/core/contracts/plugin-manifest.ts",
  "src/core/contracts/plugin-context.ts",
  "src/core/contracts/capability-token.ts",
  "src/core/contracts/plugin-kind.ts",
  "src/core/contracts/envelope.ts",
];

/** Gera todos os arquivos do manual em memória: Map<caminho relativo, conteúdo>. */
export async function buildAiManual({ projectRoot = process.cwd() } = {}) {
  const root = path.resolve(projectRoot);
  const ts = loadTs(root);
  const moduleMap = await import(pathToFileURL(path.join(root, "scripts/architecture/module-map.mjs")).href);
  const files = new Map();
  const rows = [];

  // ── módulos ────────────────────────────────────────────────────────────
  for (const mod of moduleMap.CANONICAL_MODULES) {
    const lines = [];
    const pluginSource = fs.existsSync(path.join(root, mod.plugin)) ? read(root, mod.plugin) : "";
    const deps = pluginDeps(ts, pluginSource);
    const tokenImports = [];

    lines.push(`# ${mod.key} — ${mod.displayName}`);
    lines.push(`capability: ${mod.capabilityId}@${mod.capabilityVersion} | category: ${mod.category} | engine plugin id: ${mod.capabilityId}`);
    if (deps.dependsOn.length > 0) lines.push(`dependsOn: ${deps.dependsOn.join(", ")}`);
    if (deps.consumes.length > 0) lines.push(`consumes: ${deps.consumes.join(", ")}`);

    for (const token of mod.tokens) {
      const source = read(root, token.path);
      const names = tokenNames(source);
      const rel = token.path.replace(/^src\//u, "").replace(/\.ts$/u, "");
      tokenImports.push(`import { ${names.join(", ")} } from "<rel>/${rel}";`);
    }
    lines.push("use (from src/projects/<jogo>/**):");
    for (const imp of tokenImports) lines.push(`  ${imp.replace("<rel>", "../..")}`);
    lines.push("  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)");
    lines.push("");

    for (const token of mod.tokens) {
      lines.push(`## token ${token.path}${token.primary ? "" : " (secundária)"}`);
      lines.push("```ts");
      lines.push(...digestSource(ts, token.path, read(root, token.path)));
      lines.push("```");
    }
    for (const contract of mod.contracts) {
      lines.push(`## contract ${contract}`);
      lines.push("```ts");
      lines.push(...digestSource(ts, contract, read(root, contract)));
      lines.push("```");
    }
    const notesPath = `${AI_MANUAL_DIR}/notes/${mod.key}.md`;
    if (fs.existsSync(path.join(root, notesPath))) lines.push(read(root, notesPath).trim());
    const body = `${lines.join("\n")}\n`;
    files.set(`${AI_MANUAL_DIR}/modules/${mod.key}.md`, body);
    rows.push({ key: mod.key, capability: mod.capabilityId, deps: deps.dependsOn.join(", ") || "-", name: mod.displayName, tokens: approxTokens(body) });
  }

  // ── core ───────────────────────────────────────────────────────────────
  const core = ["# core — Kernel e contrato de plugin", "import { ... } from \"@core\";  // única forma de importar o kernel", ""];
  for (const file of CORE_FILES) {
    core.push(`## ${file}`, "```ts", ...digestSource(ts, file, read(root, file)), "```");
  }
  const coreBody = `${core.join("\n")}\n`;
  files.set(`${AI_MANUAL_DIR}/CORE.md`, coreBody);

  // ── receitas (arquivos .ts compilados pelo tsc) ────────────────────────
  const recipesDir = "src/projects/_template/recipes";
  const recipeFiles = fs.existsSync(path.join(root, recipesDir))
    ? fs.readdirSync(path.join(root, recipesDir)).filter((f) => f.endsWith(".ts")).sort()
    : [];
  const recipes = ["# receitas — trechos reais, compilados pelo tsc em src/projects/_template/recipes", ""];
  for (const file of recipeFiles) {
    const code = read(root, `${recipesDir}/${file}`).replace(/\n{3,}/gu, "\n\n").trim();
    recipes.push(`## ${file}`, "```ts", code, "```", "");
  }
  const recipesBody = `${recipes.join("\n")}\n`;
  files.set(`${AI_MANUAL_DIR}/RECIPES.md`, recipesBody);

  // ── índice ─────────────────────────────────────────────────────────────
  const rulesTokens = fs.existsSync(path.join(root, AI_MANUAL_DIR, "RULES.md")) ? approxTokens(read(root, `${AI_MANUAL_DIR}/RULES.md`)) : 0;
  const index = [
    "# Manual de IA — criar jogos sobre esta engine",
    `versão ${AI_MANUAL_VERSION} · GERADO por \`npm run ai-manual:generate\` (não edite à mão; \`npm run ai-manual:check\` falha se divergir do código)`,
    "",
    "## Como usar (economize tokens)",
    "1. Leia `docs/ai/RULES.md` (regras, obrigatório, curto).",
    "2. Leia `docs/ai/CORE.md` (contrato do plugin: manifest, ctx.caps/events/commands, lifecycle).",
    "3. Leia SÓ os módulos que o jogo usa, em `docs/ai/modules/<chave>.md`, pela tabela abaixo.",
    "4. Copie a estrutura de `src/projects/_template/` e consulte `docs/ai/RECIPES.md`.",
    "5. Leia `docs/ai/GAPS.md` (o que a engine não faz e como contornar) antes de planejar.",
    "6. Não leia `src/engine/**`: o digest + notas verificadas já são a API pública.",
    "",
    "## Preciso de … → módulo",
    "| preciso de | módulo (chave) | capability / id do plugin (use em dependsOn) | plugin depende de | ~tokens |",
    "|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.name} | ${r.key} | ${r.capability} | ${r.deps} | ${r.tokens} |`),
    "",
    `Tamanho: RULES ≈ ${rulesTokens}, CORE ≈ ${approxTokens(coreBody)}, RECIPES ≈ ${approxTokens(recipesBody)}, todos os módulos ≈ ${rows.reduce((a, r) => a + r.tokens, 0)} tokens (estimativa: caracteres/3,6).`,
    "",
    "## Atalhos por tipo de jogo",
    "- 3D com física: render, camera, physics, input, assets, audio, ui, game-loop.",
    "- Persistência: storage. Multiplayer: net (+ steam para lobby/P2P). Steam/conquistas: steam.",
    "- Mundo/IA/roteiro: world, ai, scripting. Efeitos: vfx. Terreno procedural: terrain, streaming.",
    "",
    "## Fora deste manual (consulte só se precisar)",
    "- Empacotar/Windows/Steam release: `docs/layer1/native-tauri-steam.md`. Passo a passo humano: `docs/layer1/creating-a-game.md`.",
    "- Ciclo do kernel e recuperação de falhas: `docs/layer1/runtime-lifecycle.md`. Regras permanentes do repositório: `AGENTS.md`.",
    "",
  ].join("\n");
  files.set(`${AI_MANUAL_DIR}/INDEX.md`, index);

  return files;
}

export async function writeAiManual({ projectRoot = process.cwd() } = {}) {
  const root = path.resolve(projectRoot);
  const files = await buildAiManual({ projectRoot: root });
  for (const [relative, content] of files) {
    const full = path.join(root, ...relative.split("/"));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
  }
  return [...files.keys()];
}

export async function checkAiManual({ projectRoot = process.cwd() } = {}) {
  const root = path.resolve(projectRoot);
  const files = await buildAiManual({ projectRoot: root });
  const problems = [];
  for (const [relative, content] of files) {
    const full = path.join(root, ...relative.split("/"));
    if (!fs.existsSync(full)) problems.push(`ausente: ${relative}`);
    else if (fs.readFileSync(full, "utf8").replace(/\r\n/gu, "\n") !== content) problems.push(`desatualizado: ${relative}`);
  }
  return problems;
}
