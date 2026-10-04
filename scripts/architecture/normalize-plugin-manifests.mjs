#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const STAGE_NAME = "stage-20-normalize-plugin-manifests";
const MANIFEST_CONTRACT = "src/core/contracts/plugin-manifest.ts";
const PLUGINS_DIR = "src/plugins";

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = new Set(argv);
  const known = new Set(["--check", "--apply", "--help", "-h"]);

  for (const arg of args) {
    if (!known.has(arg)) {
      fail(`Argumento desconhecido: ${arg}`);
    }
  }

  if (args.has("--check") && args.has("--apply")) {
    fail("Use apenas um modo por execução: --check ou --apply.");
  }

  if (args.has("--help") || args.has("-h")) {
    return { help: true, mode: "check" };
  }

  return {
    help: false,
    mode: args.has("--apply") ? "apply" : "check",
  };
}

function printHelp() {
  console.log(`
Projeto1 — Etapa 20: normalização do manifesto dos plugins

Uso:
  node scripts/architecture/normalize-plugin-manifests.mjs --check
  node scripts/architecture/normalize-plugin-manifests.mjs --apply

Escopo estrito da Etapa 20:
  - preserva dependsOn como dependência de lifecycle;
  - preserva capabilities.provides;
  - normaliza capabilities.consumes:
      optional: false => required
      optional: true  => optional
  - adiciona suporte tipado a capabilities.conflicts;
  - materializa conflicts: [] quando nenhum conflito real é declarado;
  - não altera Kernel, boot order, resolver, package.json ou testes.

O modo --check é read-only.
O modo --apply é idempotente e valida o resultado antes de concluir.
`);
}

function projectRootFromCwd() {
  return path.resolve(process.cwd());
}

function toPosix(input) {
  return input.split(path.sep).join("/");
}

function assertRegularFile(absolutePath, label) {
  if (!fs.existsSync(absolutePath)) {
    fail(`${label} ausente: ${toPosix(path.relative(process.cwd(), absolutePath))}`);
  }
  const stat = fs.lstatSync(absolutePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(`${label} deve ser arquivo regular: ${toPosix(path.relative(process.cwd(), absolutePath))}`);
  }
}

function assertDirectory(absolutePath, label) {
  if (!fs.existsSync(absolutePath)) {
    fail(`${label} ausente: ${toPosix(path.relative(process.cwd(), absolutePath))}`);
  }
  const stat = fs.lstatSync(absolutePath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail(`${label} deve ser diretório real: ${toPosix(path.relative(process.cwd(), absolutePath))}`);
  }
}

function assertProjectRoot(rootDir) {
  assertRegularFile(path.join(rootDir, "package.json"), "package.json");
  assertRegularFile(path.join(rootDir, MANIFEST_CONTRACT), MANIFEST_CONTRACT);
  assertDirectory(path.join(rootDir, PLUGINS_DIR), PLUGINS_DIR);
}

function loadTypeScript(rootDir) {
  try {
    const projectRequire = createRequire(path.join(rootDir, "package.json"));
    return projectRequire("typescript");
  } catch (projectError) {
    try {
      return require("typescript");
    } catch (fallbackError) {
      fail(
        `TypeScript não pôde ser carregado. Instale as dependências do projeto antes de executar ${STAGE_NAME}.\n` +
          `Projeto: ${String(projectError)}\nFallback: ${String(fallbackError)}`,
      );
    }
  }
}

function listPluginFiles(rootDir) {
  const pluginsRoot = path.join(rootDir, PLUGINS_DIR);
  const entries = fs.readdirSync(pluginsRoot, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink?.()) {
      continue;
    }

    const pluginPath = path.join(pluginsRoot, entry.name, "plugin.ts");
    if (!fs.existsSync(pluginPath)) {
      continue;
    }

    const stat = fs.lstatSync(pluginPath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      fail(`Plugin inválido: ${toPosix(path.relative(rootDir, pluginPath))}`);
    }

    files.push(pluginPath);
  }

  files.sort((a, b) => a.localeCompare(b));

  if (files.length === 0) {
    fail("Nenhum src/plugins/*/plugin.ts foi encontrado.");
  }

  return files;
}

function createSourceFile(ts, filePath, sourceText) {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const diagnostics = sourceFile.parseDiagnostics ?? [];
  if (diagnostics.length > 0) {
    const detail = diagnostics
      .map((diagnostic) => {
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
        return `${filePath}:${String(diagnostic.start ?? 0)} ${message}`;
      })
      .join("\n");
    fail(`Falha ao parsear TypeScript:\n${detail}`);
  }

  return sourceFile;
}

function propertyNameText(ts, name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function findProperty(ts, objectLiteral, propertyName) {
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
      continue;
    }
    if (propertyNameText(ts, property.name) === propertyName) {
      return property;
    }
  }
  return null;
}

function hasDirectProperty(ts, objectLiteral, propertyName) {
  return findProperty(ts, objectLiteral, propertyName) !== null;
}

function looksLikeManifest(ts, objectLiteral) {
  return (
    hasDirectProperty(ts, objectLiteral, "id") &&
    hasDirectProperty(ts, objectLiteral, "name") &&
    hasDirectProperty(ts, objectLiteral, "version") &&
    hasDirectProperty(ts, objectLiteral, "kind")
  );
}

function lineIndentAt(sourceText, position) {
  const lineStart = sourceText.lastIndexOf("\n", Math.max(0, position - 1)) + 1;
  const prefix = sourceText.slice(lineStart, position);
  const match = prefix.match(/^[\t ]*/u);
  return match ? match[0] : "";
}

function newlineFor(sourceText) {
  return sourceText.includes("\r\n") ? "\r\n" : "\n";
}

function addPatch(patches, patch) {
  if (patch.start < 0 || patch.end < patch.start) {
    fail(`Patch inválido em ${patch.label}.`);
  }
  patches.push(patch);
}

function applyPatches(sourceText, patches) {
  const ordered = [...patches].sort((a, b) => {
    if (a.start !== b.start) return b.start - a.start;
    return b.end - a.end;
  });

  let lastStart = sourceText.length + 1;
  let output = sourceText;

  for (const patch of ordered) {
    if (patch.end > lastStart) {
      fail(`Patches sobrepostos: ${patch.label}`);
    }
    output = output.slice(0, patch.start) + patch.text + output.slice(patch.end);
    lastStart = patch.start;
  }

  return output;
}

function captureDependsOnInitializers(ts, sourceFile, sourceText) {
  const values = [];

  function visit(node) {
    if (ts.isPropertyAssignment(node) && propertyNameText(ts, node.name) === "dependsOn") {
      values.push(sourceText.slice(node.initializer.getStart(sourceFile), node.initializer.end));
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return values;
}

function findRequirementObjectLiterals(ts, expression) {
  const results = [];

  function visit(node) {
    if (ts.isObjectLiteralExpression(node)) {
      const hasId = hasDirectProperty(ts, node, "id");
      const hasRange = hasDirectProperty(ts, node, "range");
      if (hasId && hasRange) {
        results.push(node);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(expression);
  return results;
}

function makePropertyInsertion(sourceText, sourceFile, objectLiteral, propertyText, label) {
  const nl = newlineFor(sourceText);
  const objectStart = objectLiteral.getStart(sourceFile);
  const closeBracePos = objectLiteral.end - 1;
  const objectIndent = lineIndentAt(sourceText, objectStart);
  const childIndent = `${objectIndent}  `;
  const properties = objectLiteral.properties;
  const objectText = sourceText.slice(objectStart, objectLiteral.end);
  const isSingleLine = !objectText.includes("\n") && !objectText.includes("\r");

  if (properties.length === 0) {
    if (isSingleLine) {
      return [
        {
          start: closeBracePos,
          end: closeBracePos,
          text: propertyText,
          label,
        },
      ];
    }

    const closeLineStart = sourceText.lastIndexOf("\n", closeBracePos - 1) + 1;
    return [
      {
        start: closeLineStart,
        end: closeLineStart,
        text: `${childIndent}${propertyText},${nl}`,
        label,
      },
    ];
  }

  const last = properties[properties.length - 1];
  const between = sourceText.slice(last.end, closeBracePos);
  const hasTrailingComma = /^\s*,/u.test(between);

  if (isSingleLine) {
    if (!hasTrailingComma) {
      return [
        {
          start: last.end,
          end: last.end,
          text: `, ${propertyText}`,
          label,
        },
      ];
    }

    return [
      {
        start: closeBracePos,
        end: closeBracePos,
        text: ` ${propertyText},`,
        label,
      },
    ];
  }

  const closeLineStart = sourceText.lastIndexOf("\n", closeBracePos - 1) + 1;
  const result = [
    {
      start: closeLineStart,
      end: closeLineStart,
      text: `${childIndent}${propertyText},${nl}`,
      label,
    },
  ];

  if (!hasTrailingComma) {
    result.push({
      start: last.end,
      end: last.end,
      text: ",",
      label: `${label}: vírgula`,
    });
  }

  return result;
}

function addPropertyInsertion(patches, sourceText, sourceFile, objectLiteral, propertyText, label) {
  const insertions = makePropertyInsertion(
    sourceText,
    sourceFile,
    objectLiteral,
    propertyText,
    label,
  );
  for (const insertion of insertions) {
    addPatch(patches, insertion);
  }
}
function planPluginNormalization(ts, filePath, sourceText) {
  const sourceFile = createSourceFile(ts, filePath, sourceText);
  const patches = [];
  const manifestObjects = [];
  const beforeDependsOn = captureDependsOnInitializers(ts, sourceFile, sourceText);

  function visit(node) {
    if (ts.isObjectLiteralExpression(node) && looksLikeManifest(ts, node)) {
      manifestObjects.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  if (manifestObjects.length === 0) {
    fail(`Nenhum manifesto concreto foi localizado em ${filePath}.`);
  }

  let normalizedConsumes = 0;
  let addedConflicts = 0;
  let addedCapabilities = 0;

  for (const manifestObject of manifestObjects) {
    const capabilitiesProperty = findProperty(ts, manifestObject, "capabilities");

    if (!capabilitiesProperty || !ts.isPropertyAssignment(capabilitiesProperty)) {
      addPropertyInsertion(
        patches,
        sourceText,
        sourceFile,
        manifestObject,
        "capabilities: { conflicts: [] }",
        `${filePath}: adicionar capabilities.conflicts`,
      );
      addedCapabilities += 1;
      addedConflicts += 1;
      continue;
    }

    const capabilitiesInitializer = capabilitiesProperty.initializer;
    if (!ts.isObjectLiteralExpression(capabilitiesInitializer)) {
      fail(`capabilities deve ser objeto literal em ${filePath}.`);
    }

    const conflictsProperty = findProperty(ts, capabilitiesInitializer, "conflicts");
    if (!conflictsProperty) {
      addPropertyInsertion(
        patches,
        sourceText,
        sourceFile,
        capabilitiesInitializer,
        "conflicts: []",
        `${filePath}: adicionar conflicts`,
      );
      addedConflicts += 1;
    }

    const consumesProperty = findProperty(ts, capabilitiesInitializer, "consumes");
    if (consumesProperty && ts.isPropertyAssignment(consumesProperty)) {
      const requirementObjects = findRequirementObjectLiterals(ts, consumesProperty.initializer);

      for (const requirementObject of requirementObjects) {
        if (findProperty(ts, requirementObject, "optional")) {
          continue;
        }

        addPropertyInsertion(
          patches,
          sourceText,
          sourceFile,
          requirementObject,
          "optional: false",
          `${filePath}: consumes.optional=false`,
        );
        normalizedConsumes += 1;
      }
    }
  }

  const output = applyPatches(sourceText, patches);
  const outputSourceFile = createSourceFile(ts, filePath, output);
  const afterDependsOn = captureDependsOnInitializers(ts, outputSourceFile, output);

  if (JSON.stringify(beforeDependsOn) !== JSON.stringify(afterDependsOn)) {
    fail(`Proteção de lifecycle falhou: dependsOn seria alterado em ${filePath}.`);
  }

  return {
    output,
    changed: output !== sourceText,
    manifestCount: manifestObjects.length,
    normalizedConsumes,
    addedConflicts,
    addedCapabilities,
  };
}

function planContractNormalization(ts, filePath, sourceText) {
  const sourceFile = createSourceFile(ts, filePath, sourceText);
  const patches = [];
  const nl = newlineFor(sourceText);

  let hasConflictInterface = false;
  let manifestInterface = null;
  let capabilitiesMember = null;

  for (const statement of sourceFile.statements) {
    if (!ts.isInterfaceDeclaration(statement)) continue;

    if (statement.name.text === "CapabilityConflict") {
      hasConflictInterface = true;
    }

    if (statement.name.text === "PluginManifest") {
      manifestInterface = statement;
      for (const member of statement.members) {
        if (!ts.isPropertySignature(member) || !member.name) continue;
        if (propertyNameText(ts, member.name) === "capabilities") {
          capabilitiesMember = member;
        }
      }
    }
  }

  if (!manifestInterface) {
    fail(`${MANIFEST_CONTRACT}: interface PluginManifest não encontrada.`);
  }

  if (!capabilitiesMember?.type || !ts.isTypeLiteralNode(capabilitiesMember.type)) {
    fail(`${MANIFEST_CONTRACT}: PluginManifest.capabilities deve ser type literal.`);
  }

  if (!hasConflictInterface) {
    const insertPos = manifestInterface.getFullStart();
    const block = [
      "/** Declara incompatibilidade com uma capability em determinada faixa semver. */",
      "export interface CapabilityConflict {",
      "  readonly id: string;",
      "  readonly range: string;",
      "}",
      "",
      "",
    ].join(nl);

    addPatch(patches, {
      start: insertPos,
      end: insertPos,
      text: block,
      label: `${MANIFEST_CONTRACT}: CapabilityConflict`,
    });
  }

  const capabilitiesType = capabilitiesMember.type;
  const hasConflictsMember = capabilitiesType.members.some(
    (member) =>
      ts.isPropertySignature(member) &&
      member.name &&
      propertyNameText(ts, member.name) === "conflicts",
  );

  if (!hasConflictsMember) {
    const closeBracePos = capabilitiesType.end - 1;
    const closeLineStart = sourceText.lastIndexOf("\n", closeBracePos - 1) + 1;
    const indent = lineIndentAt(sourceText, capabilitiesMember.getStart(sourceFile));
    const memberIndent = `${indent}  `;

    addPatch(patches, {
      start: closeLineStart,
      end: closeLineStart,
      text: `${memberIndent}readonly conflicts?: readonly CapabilityConflict[];${nl}`,
      label: `${MANIFEST_CONTRACT}: capabilities.conflicts`,
    });
  }

  const output = applyPatches(sourceText, patches);

  return {
    output,
    changed: output !== sourceText,
    addedConflictInterface: !hasConflictInterface,
    addedConflictsMember: !hasConflictsMember,
  };
}

function validateContract(ts, filePath, sourceText) {
  const sourceFile = createSourceFile(ts, filePath, sourceText);
  let hasConflictInterface = false;
  let hasConflictsMember = false;

  for (const statement of sourceFile.statements) {
    if (!ts.isInterfaceDeclaration(statement)) continue;

    if (statement.name.text === "CapabilityConflict") {
      const id = statement.members.some(
        (member) => ts.isPropertySignature(member) && member.name && propertyNameText(ts, member.name) === "id",
      );
      const range = statement.members.some(
        (member) => ts.isPropertySignature(member) && member.name && propertyNameText(ts, member.name) === "range",
      );
      hasConflictInterface = id && range;
    }

    if (statement.name.text === "PluginManifest") {
      for (const member of statement.members) {
        if (
          ts.isPropertySignature(member) &&
          member.name &&
          propertyNameText(ts, member.name) === "capabilities" &&
          member.type &&
          ts.isTypeLiteralNode(member.type)
        ) {
          hasConflictsMember = member.type.members.some(
            (nested) =>
              ts.isPropertySignature(nested) &&
              nested.name &&
              propertyNameText(ts, nested.name) === "conflicts",
          );
        }
      }
    }
  }

  if (!hasConflictInterface || !hasConflictsMember) {
    fail(`${MANIFEST_CONTRACT}: contrato de conflicts não ficou normalizado.`);
  }
}

function validatePluginFile(ts, filePath, sourceText) {
  const sourceFile = createSourceFile(ts, filePath, sourceText);
  let manifests = 0;

  function visit(node) {
    if (ts.isObjectLiteralExpression(node) && looksLikeManifest(ts, node)) {
      manifests += 1;
      const capabilitiesProperty = findProperty(ts, node, "capabilities");
      if (!capabilitiesProperty || !ts.isPropertyAssignment(capabilitiesProperty)) {
        fail(`${filePath}: manifesto sem capabilities após normalização.`);
      }
      if (!ts.isObjectLiteralExpression(capabilitiesProperty.initializer)) {
        fail(`${filePath}: capabilities não é objeto literal após normalização.`);
      }

      const capabilities = capabilitiesProperty.initializer;
      const conflictsProperty = findProperty(ts, capabilities, "conflicts");
      if (!conflictsProperty || !ts.isPropertyAssignment(conflictsProperty)) {
        fail(`${filePath}: capabilities.conflicts ausente após normalização.`);
      }

      const consumesProperty = findProperty(ts, capabilities, "consumes");
      if (consumesProperty && ts.isPropertyAssignment(consumesProperty)) {
        const requirementObjects = findRequirementObjectLiterals(ts, consumesProperty.initializer);
        for (const requirement of requirementObjects) {
          const optionalProperty = findProperty(ts, requirement, "optional");
          if (!optionalProperty || !ts.isPropertyAssignment(optionalProperty)) {
            fail(`${filePath}: consume sem optional explícito após normalização.`);
          }
          if (
            optionalProperty.initializer.kind !== ts.SyntaxKind.TrueKeyword &&
            optionalProperty.initializer.kind !== ts.SyntaxKind.FalseKeyword
          ) {
            fail(`${filePath}: consumes.optional deve ser boolean literal.`);
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (manifests === 0) {
    fail(`${filePath}: nenhum manifesto concreto após normalização.`);
  }
}

function writeAtomically(filePath, content) {
  const directory = path.dirname(filePath);
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.stage20.tmp`,
  );

  fs.writeFileSync(tempPath, content, "utf8");
  fs.renameSync(tempPath, filePath);
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const rootDir = projectRootFromCwd();
  assertProjectRoot(rootDir);
  const ts = loadTypeScript(rootDir);

  const contractPath = path.join(rootDir, MANIFEST_CONTRACT);
  const pluginPaths = listPluginFiles(rootDir);

  const originalContract = fs.readFileSync(contractPath, "utf8");
  const contractPlan = planContractNormalization(ts, contractPath, originalContract);

  const pluginPlans = pluginPaths.map((pluginPath) => {
    const sourceText = fs.readFileSync(pluginPath, "utf8");
    return {
      pluginPath,
      sourceText,
      plan: planPluginNormalization(ts, pluginPath, sourceText),
    };
  });

  const changedPlugins = pluginPlans.filter((entry) => entry.plan.changed);
  const changedFileCount = changedPlugins.length + (contractPlan.changed ? 1 : 0);
  const totalManifests = pluginPlans.reduce((sum, entry) => sum + entry.plan.manifestCount, 0);
  const totalConsumes = pluginPlans.reduce((sum, entry) => sum + entry.plan.normalizedConsumes, 0);
  const totalConflicts = pluginPlans.reduce((sum, entry) => sum + entry.plan.addedConflicts, 0);

  if (options.mode === "check") {
    console.log(`[${STAGE_NAME}] modo check (read-only)`);
    console.log(`Plugins inspecionados: ${pluginPaths.length}`);
    console.log(`Manifestos concretos: ${totalManifests}`);
    console.log(`Arquivos pendentes: ${changedFileCount}`);
    console.log(`Consumes sem optional explícito: ${totalConsumes}`);
    console.log(`Blocos conflicts ausentes: ${totalConflicts}`);
    console.log(`Contrato conflicts pendente: ${contractPlan.changed ? "sim" : "não"}`);

    for (const entry of changedPlugins) {
      console.log(`  PENDENTE ${toPosix(path.relative(rootDir, entry.pluginPath))}`);
    }
    if (contractPlan.changed) {
      console.log(`  PENDENTE ${MANIFEST_CONTRACT}`);
    }

    if (changedFileCount > 0) {
      process.exitCode = 1;
      return;
    }

    console.log("Etapa 20 já está normalizada.");
    return;
  }

  const writes = [];
  if (contractPlan.changed) {
    writes.push({ filePath: contractPath, content: contractPlan.output });
  }
  for (const entry of changedPlugins) {
    writes.push({ filePath: entry.pluginPath, content: entry.plan.output });
  }

  for (const write of writes) {
    writeAtomically(write.filePath, write.content);
  }

  try {
    validateContract(ts, contractPath, fs.readFileSync(contractPath, "utf8"));
    for (const pluginPath of pluginPaths) {
      validatePluginFile(ts, pluginPath, fs.readFileSync(pluginPath, "utf8"));
    }

    const idempotenceContract = planContractNormalization(
      ts,
      contractPath,
      fs.readFileSync(contractPath, "utf8"),
    );
    if (idempotenceContract.changed) {
      fail("Falha de idempotência no contrato de manifesto.");
    }

    for (const pluginPath of pluginPaths) {
      const current = fs.readFileSync(pluginPath, "utf8");
      const idempotencePlugin = planPluginNormalization(ts, pluginPath, current);
      if (idempotencePlugin.changed) {
        fail(`Falha de idempotência em ${toPosix(path.relative(rootDir, pluginPath))}.`);
      }
    }
  } catch (error) {
    for (const entry of pluginPlans) {
      if (entry.plan.changed) {
        writeAtomically(entry.pluginPath, entry.sourceText);
      }
    }
    if (contractPlan.changed) {
      writeAtomically(contractPath, originalContract);
    }
    throw error;
  }

  console.log(`[${STAGE_NAME}] aplicado com sucesso.`);
  console.log(`Arquivos alterados: ${writes.length}`);
  console.log(`Plugins inspecionados: ${pluginPaths.length}`);
  console.log(`Manifestos concretos: ${totalManifests}`);
  console.log(`Consumes normalizados para optional:false: ${totalConsumes}`);
  console.log(`conflicts adicionados: ${totalConflicts}`);
  console.log("dependsOn preservado sem alterações.");
  console.log("Idempotência validada.");
}

try {
  main();
} catch (error) {
  console.error(`[${STAGE_NAME}] ERRO`);
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
}
