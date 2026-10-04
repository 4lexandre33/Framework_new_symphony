#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  ARCHITECTURE_MIGRATION_VERSION,
  CANONICAL_MODULES,
} from "./module-map.mjs";

export const STAGE_NAME =
  "stage-9-create-conceptual-readmes";

const EXPECTED_ARCHITECTURE_VERSION =
  "v20";

const SCAN_EXCLUDED_TOP_LEVEL =
  new Set([
    ".git",
    "node_modules",
    "dist",
    "coverage",
    "target",
  ]);

const SCAN_EXCLUDED_RELATIVE_PREFIXES =
  Object.freeze([
    ".cache/",
    ".turbo/",
    ".vite/",
    "src-tauri/target/",
  ]);

const SUPPORTING_DIRECTORIES =
  Object.freeze([
    "src",
    "src/domain",
    "src/services",
    "src/app",
    "src/engine",
  ]);

const CONCEPTUAL_AREAS =
  Object.freeze([
    Object.freeze({
      directory:
        "src/domain/ports",
      layer:
        "Camada 2 — Domínio",
      purpose:
        "Definir ports e interfaces puras usadas pelo domínio para declarar dependências externas sem conhecer implementações concretas.",
      allowedDependencies:
        Object.freeze([
          "Tipos e contratos puros de src/domain/**.",
          "Recursos nativos da linguagem TypeScript/JavaScript que não introduzam infraestrutura.",
        ]),
      prohibitedDependencies:
        Object.freeze([
          "src/engine/**, inclusive APIs e implementações concretas da engine.",
          "src/services/**, src/app/** e src/plugins/**.",
          "Tauri, Three.js, Babylon.js, Rapier, Steamworks SDK ou qualquer adaptador nativo/concreto.",
        ]),
      examples:
        Object.freeze([
          "SaveGamePort",
          "ClockPort",
          "InputIntentPort",
          "EntitlementPort",
        ]),
    }),
    Object.freeze({
      directory:
        "src/domain/entities",
      layer:
        "Camada 2 — Domínio",
      purpose:
        "Hospedar entidades e value objects puros de gameplay, com estado e invariantes do domínio independentes da engine concreta.",
      allowedDependencies:
        Object.freeze([
          "Outros tipos puros de src/domain/** quando necessários.",
          "Ports do domínio quando a modelagem exigir abstrações, sem depender de implementações.",
          "Recursos nativos da linguagem TypeScript/JavaScript sem efeitos de infraestrutura.",
        ]),
      prohibitedDependencies:
        Object.freeze([
          "src/engine/**, src/services/**, src/app/** e src/plugins/**.",
          "Tauri, Three.js, Babylon.js, Rapier, Steamworks SDK, DOM ou APIs concretas de persistência/render/input.",
        ]),
      examples:
        Object.freeze([
          "PlayerState",
          "InventoryModel",
          "QuestState",
          "WorldProgress",
        ]),
    }),
    Object.freeze({
      directory:
        "src/domain/economy",
      layer:
        "Camada 2 — Domínio",
      purpose:
        "Concentrar regras puras de economia, recompensas, moedas, custos e progressão, sem conhecimento de loja, Steam ou persistência concreta.",
      allowedDependencies:
        Object.freeze([
          "Entidades, value objects e ports de src/domain/**.",
          "Funções e tipos puros sem efeitos de infraestrutura.",
        ]),
      prohibitedDependencies:
        Object.freeze([
          "src/engine/**, src/services/**, src/app/** e src/plugins/**.",
          "Steam MicroTxn, monetização concreta, Tauri, banco de dados, rede ou APIs de plataforma.",
        ]),
      examples:
        Object.freeze([
          "CurrencyAccount",
          "RewardPolicy",
          "PurchaseRule",
          "ProgressionCurve",
        ]),
    }),
    Object.freeze({
      directory:
        "src/domain/mechanics",
      layer:
        "Camada 2 — Domínio",
      purpose:
        "Definir mecânicas e regras determinísticas de gameplay sem acoplamento ao loop, física, input ou renderização concretos.",
      allowedDependencies:
        Object.freeze([
          "Entidades, ports e demais regras puras de src/domain/**.",
          "Cálculos determinísticos e tipos sem dependências de infraestrutura.",
        ]),
      prohibitedDependencies:
        Object.freeze([
          "src/engine/**, src/services/**, src/app/** e src/plugins/**.",
          "Three.js, Babylon.js, Rapier, DOM, Pointer Lock, Gamepad API, Tauri ou Steamworks SDK.",
        ]),
      examples:
        Object.freeze([
          "DamageRule",
          "MovementRule",
          "InteractionRule",
          "CooldownRule",
        ]),
    }),
    Object.freeze({
      directory:
        "src/domain/narrative",
      layer:
        "Camada 2 — Domínio",
      purpose:
        "Modelar narrativa de alto nível, diálogos, quests e estados narrativos sem depender de UI, áudio, scripting ou persistência concretos.",
      allowedDependencies:
        Object.freeze([
          "Entidades, ports e regras puras de src/domain/**.",
          "Estruturas de dados determinísticas e serializáveis do domínio.",
        ]),
      prohibitedDependencies:
        Object.freeze([
          "src/engine/**, src/services/**, src/app/** e src/plugins/**.",
          "UI concreta, áudio concreto, filesystem, Tauri, Steamworks SDK ou bibliotecas de renderização.",
        ]),
      examples:
        Object.freeze([
          "DialogueGraph",
          "QuestDefinition",
          "NarrativeState",
          "StoryFlagSet",
        ]),
    }),
    Object.freeze({
      directory:
        "src/domain/evaluation",
      layer:
        "Camada 2 — Domínio",
      purpose:
        "Avaliar condições, regras e resultados do domínio de forma pura, reproduzível e independente de serviços ou infraestrutura.",
      allowedDependencies:
        Object.freeze([
          "Entidades, regras, narrativa, economia e ports de src/domain/**.",
          "Predicados e algoritmos puros, sem I/O ou acesso a runtime externo.",
        ]),
      prohibitedDependencies:
        Object.freeze([
          "src/engine/**, src/services/**, src/app/** e src/plugins/**.",
          "Tauri, Three.js, Babylon.js, Rapier, Steamworks SDK, rede, banco de dados ou relógio concreto.",
        ]),
      examples:
        Object.freeze([
          "ConditionEvaluator",
          "RuleSet",
          "OutcomeEvaluator",
          "RequirementEvaluator",
        ]),
    }),
    Object.freeze({
      directory:
        "src/services/ui",
      layer:
        "Camada 3 — Serviços de Aplicação",
      purpose:
        "Orquestrar casos de aplicação ligados à apresentação e UI através de ports, contratos e APIs públicas, sem acessar implementação privada de engine.",
      allowedDependencies:
        Object.freeze([
          "src/domain/**.",
          "APIs públicas estáveis de módulos em src/engine/<module>/public quando existirem.",
          "Contratos e capability tokens publicados que não exponham implementações concretas.",
        ]),
      prohibitedDependencies:
        Object.freeze([
          "src/engine/<module>/internal/**.",
          "Implementações internas de outros módulos, bridges concretas de plugin ou acesso direto a Tauri/Steamworks.",
          "Three.js, Babylon.js ou Rapier usados diretamente como detalhe de implementação da camada de serviço.",
        ]),
      examples:
        Object.freeze([
          "HUDProjectionService",
          "MenuNavigationService",
          "LocalizationPresentationService",
          "NotificationService",
        ]),
    }),
    Object.freeze({
      directory:
        "src/services/usecases",
      layer:
        "Camada 3 — Serviços de Aplicação",
      purpose:
        "Implementar casos de uso que orquestram domínio e ports, coordenando APIs públicas sem incorporar detalhes de infraestrutura.",
      allowedDependencies:
        Object.freeze([
          "src/domain/**.",
          "APIs públicas estáveis de src/engine/<module>/public quando a orquestração exigir recursos técnicos.",
          "Contratos e tokens públicos necessários à resolução de capacidades.",
        ]),
      prohibitedDependencies:
        Object.freeze([
          "src/engine/<module>/internal/** e internals de qualquer outro módulo.",
          "Detalhes concretos de Tauri, Steamworks SDK, Three.js, Babylon.js ou Rapier.",
          "Regras de domínio escondidas em adapters ou plugins.",
        ]),
      examples:
        Object.freeze([
          "StartGameUseCase",
          "SaveGameUseCase",
          "LoadWorldUseCase",
          "CompleteQuestUseCase",
        ]),
    }),
    Object.freeze({
      directory:
        "src/services/diagnostics",
      layer:
        "Camada 3 — Serviços de Aplicação",
      purpose:
        "Agregar e transformar sinais de diagnóstico através de contratos públicos, mantendo ferramentas e implementação concreta fora da lógica de domínio.",
      allowedDependencies:
        Object.freeze([
          "src/domain/** quando houver modelos de estado relevantes.",
          "APIs públicas, contratos e tokens publicados pelos módulos da engine.",
          "Interfaces públicas de observabilidade disponibilizadas pelo Core.",
        ]),
      prohibitedDependencies:
        Object.freeze([
          "src/engine/<module>/internal/**.",
          "Acesso direto a drivers Tauri/Steamworks ou objetos concretos de Three.js, Babylon.js e Rapier.",
          "Mutação de regras de domínio a partir de código de diagnóstico.",
        ]),
      examples:
        Object.freeze([
          "DiagnosticsService",
          "RuntimeHealthService",
          "PerformanceSnapshotService",
          "CapabilityStatusService",
        ]),
    }),
    Object.freeze({
      directory:
        "src/app/flows",
      layer:
        "Camada 4 — Aplicação / Fluxos",
      purpose:
        "Orquestrar fluxos de alto nível da aplicação e transições de estado usando serviços, domínio e contratos públicos, sem absorver implementação técnica dos módulos.",
      allowedDependencies:
        Object.freeze([
          "src/services/** e src/domain/**.",
          "APIs públicas, contracts, ports e capability tokens necessários à composição e orquestração.",
          "Dependências fornecidas pelo composition root por injeção, quando aplicável.",
        ]),
      prohibitedDependencies:
        Object.freeze([
          "src/engine/<module>/internal/** e internals cruzados entre módulos.",
          "Drivers concretos Tauri/Steamworks ou objetos de Three.js, Babylon.js e Rapier usados diretamente no fluxo.",
          "Implementação de regras de domínio que pertencem a src/domain/**.",
        ]),
      examples:
        Object.freeze([
          "GameFlowFSM",
          "BootFlow",
          "SessionFlow",
          "ShutdownFlow",
        ]),
    }),
  ]);

function fail(
  message,
) {
  throw new Error(
    message,
  );
}

function normalizeAbsolute(
  inputPath,
) {
  const normalized =
    path.normalize(
      path.resolve(
        inputPath,
      ),
    );

  return process.platform ===
    "win32"
    ? normalized.toLowerCase()
    : normalized;
}

function toPosixRelative(
  rootDir,
  absolutePath,
) {
  return path
    .relative(
      rootDir,
      absolutePath,
    )
    .split(
      path.sep,
    )
    .join(
      "/",
    );
}

function fromPosixRelative(
  rootDir,
  relativePath,
) {
  return path.join(
    rootDir,
    ...relativePath.split(
      "/",
    ),
  );
}

function runCommand(
  executable,
  args,
  cwd,
  allowFailure = false,
) {
  const result =
    spawnSync(
      executable,
      args,
      {
        cwd,
        encoding:
          "utf8",
        windowsHide:
          true,
        stdio: [
          "ignore",
          "pipe",
          "pipe",
        ],
      },
    );

  if (
    result.error
  ) {
    if (
      allowFailure
    ) {
      return {
        status:
          result.status ??
          1,
        stdout:
          String(
            result.stdout ??
              "",
          ),
        stderr:
          String(
            result.stderr ??
              "",
          ),
      };
    }

    throw result.error;
  }

  const status =
    result.status ??
    1;

  const stdout =
    String(
      result.stdout ??
        "",
    );

  const stderr =
    String(
      result.stderr ??
        "",
    );

  if (
    status !== 0 &&
    !allowFailure
  ) {
    fail(
      stderr.trim().length >
        0
        ? stderr.trim()
        : `${executable} ${args.join(" ")} falhou com código ${String(status)}.`,
    );
  }

  return {
    status,
    stdout,
    stderr,
  };
}

function runGit(
  args,
  cwd,
  allowFailure = false,
) {
  return runCommand(
    "git",
    args,
    cwd,
    allowFailure,
  );
}

function assertRepositoryRoot(
  cwd,
) {
  const inside =
    runGit(
      [
        "rev-parse",
        "--is-inside-work-tree",
      ],
      cwd,
    ).stdout.trim();

  if (
    inside !==
    "true"
  ) {
    fail(
      "O diretório atual não pertence a um repositório Git.",
    );
  }

  const gitRootRaw =
    runGit(
      [
        "rev-parse",
        "--show-toplevel",
      ],
      cwd,
    ).stdout.trim();

  if (
    gitRootRaw.length ===
    0
  ) {
    fail(
      "Não foi possível determinar a raiz do repositório Git.",
    );
  }

  if (
    normalizeAbsolute(
      cwd,
    ) !==
    normalizeAbsolute(
      gitRootRaw,
    )
  ) {
    fail(
      [
        "Este script deve ser executado exatamente na raiz do repositório.",
        `Diretório atual: ${cwd}`,
        `Raiz detectada: ${gitRootRaw}`,
      ].join(
        "\n",
      ),
    );
  }

  return path.resolve(
    gitRootRaw,
  );
}

function parseArguments(
  argv,
) {
  if (
    argv.length ===
    0
  ) {
    return {
      help: false,
    };
  }

  if (
    argv.length ===
      1 &&
    (
      argv[0] ===
        "--help" ||
      argv[0] ===
        "-h"
    )
  ) {
    return {
      help: true,
    };
  }

  fail(
    [
      "Argumentos inválidos.",
      "Uso:",
      "  node scripts/architecture/stage9-create-conceptual-readmes.mjs",
    ].join(
      "\n",
    ),
  );
}

function printHelp() {
  console.log(`
Projeto1 — Etapa 9: README.txt conceituais

Uso:
  node scripts/architecture/stage9-create-conceptual-readmes.mjs

Pré-condições:
  - arquitetura v20;
  - Etapa 7 materializada: 69/69 diretórios canônicos;
  - Etapa 8 materializada: 10/10 diretórios conceituais;
  - cada diretório conceitual ainda sem implementação.

Esta etapa cria exclusivamente 10 arquivos:
  src/domain/ports/README.txt
  src/domain/entities/README.txt
  src/domain/economy/README.txt
  src/domain/mechanics/README.txt
  src/domain/narrative/README.txt
  src/domain/evaluation/README.txt
  src/services/ui/README.txt
  src/services/usecases/README.txt
  src/services/diagnostics/README.txt
  src/app/flows/README.txt

Cada README documenta:
  - função futura;
  - camada arquitetural;
  - dependências permitidas;
  - dependências proibidas;
  - exemplos de classes futuras.

Esta etapa NÃO:
  - cria arquivos .ts;
  - cria diretórios;
  - move implementações;
  - reescreve imports;
  - cria public/index.ts;
  - altera aliases;
  - altera manifests;
  - altera guardrails;
  - altera freeze-lock;
  - grava artefatos em .migration.
`);
}

function assertArchitectureVersion() {
  if (
    ARCHITECTURE_MIGRATION_VERSION !==
    EXPECTED_ARCHITECTURE_VERSION
  ) {
    fail(
      `Versão arquitetural inesperada: ${String(ARCHITECTURE_MIGRATION_VERSION)}. Esperado: ${EXPECTED_ARCHITECTURE_VERSION}.`,
    );
  }
}

function assertRealDirectory(
  rootDir,
  relativePath,
  label,
) {
  const absolutePath =
    fromPosixRelative(
      rootDir,
      relativePath,
    );

  if (
    !fs.existsSync(
      absolutePath,
    )
  ) {
    fail(
      `${label} ausente: ${relativePath}/`,
    );
  }

  const stat =
    fs.lstatSync(
      absolutePath,
    );

  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory()
  ) {
    fail(
      `${label} inválido; esperado diretório real: ${relativePath}/`,
    );
  }
}

function validateStage7Structure(
  rootDir,
) {
  const expected =
    [];

  for (
    const moduleRecord of
      CANONICAL_MODULES
  ) {
    expected.push(
      moduleRecord.engine.root,
      moduleRecord.engine.publicRoot,
      moduleRecord.engine.internalRoot,
    );
  }

  if (
    expected.length !==
    69
  ) {
    fail(
      `Module map não produz 69 diretórios estruturais da Etapa 7; atual: ${String(expected.length)}.`,
    );
  }

  for (
    const relativePath of
      expected
  ) {
    assertRealDirectory(
      rootDir,
      relativePath,
      "Pré-condição da Etapa 7",
    );
  }

  return expected;
}

function validateStage8Structure(
  rootDir,
) {
  for (
    const relativePath of
      SUPPORTING_DIRECTORIES
  ) {
    assertRealDirectory(
      rootDir,
      relativePath,
      "Pré-condição estrutural",
    );
  }

  for (
    const area of
      CONCEPTUAL_AREAS
  ) {
    assertRealDirectory(
      rootDir,
      area.directory,
      "Pré-condição da Etapa 8",
    );
  }

  if (
    CONCEPTUAL_AREAS.length !==
    10
  ) {
    fail(
      `Quantidade inválida de áreas conceituais: ${String(CONCEPTUAL_AREAS.length)}. Esperado: 10.`,
    );
  }
}

function buildReadmeContent(
  area,
) {
  const lines = [
    "PROJETO1 — ÁREA CONCEITUAL",
    "",
    `Path: ${area.directory}`,
    `Camada arquitetural: ${area.layer}`,
    "Status: reservado para implementação futura; este README não é implementação.",
    "",
    "FUNÇÃO FUTURA",
    area.purpose,
    "",
    "DEPENDÊNCIAS PERMITIDAS",
    ...area.allowedDependencies.map(
      (item) =>
        `- ${item}`,
    ),
    "",
    "DEPENDÊNCIAS PROIBIDAS",
    ...area.prohibitedDependencies.map(
      (item) =>
        `- ${item}`,
    ),
    "",
    "EXEMPLOS DE CLASSES FUTURAS",
    "Os nomes abaixo são apenas exemplos arquiteturais e NÃO são criados nesta etapa:",
    ...area.examples.map(
      (item) =>
        `- ${item}`,
    ),
    "",
    "REGRA DESTA ETAPA",
    "Nenhum arquivo .ts placeholder deve existir aqui apenas para completar a árvore.",
    "Implementações futuras devem ser adicionadas somente quando houver requisito funcional real e devem respeitar as fronteiras acima.",
    "",
  ];

  return lines.join(
    "\n",
  );
}

function sha256Buffer(
  buffer,
) {
  return crypto
    .createHash(
      "sha256",
    )
    .update(
      buffer,
    )
    .digest(
      "hex",
    );
}

function sha256Text(
  text,
) {
  return crypto
    .createHash(
      "sha256",
    )
    .update(
      text,
      "utf8",
    )
    .digest(
      "hex",
    );
}

function shouldExcludePath(
  relativePath,
  isDirectory,
) {
  if (
    relativePath.length ===
    0
  ) {
    return false;
  }

  const topLevel =
    relativePath.split(
      "/",
    )[0];

  if (
    isDirectory &&
    SCAN_EXCLUDED_TOP_LEVEL.has(
      topLevel,
    )
  ) {
    return true;
  }

  const normalized =
    isDirectory
      ? `${relativePath}/`
      : relativePath;

  return SCAN_EXCLUDED_RELATIVE_PREFIXES.some(
    (prefix) =>
      normalized ===
        prefix ||
      normalized.startsWith(
        prefix,
      ),
  );
}

function walkProjectEntries(
  rootDir,
) {
  const records =
    [];

  const stack =
    [
      rootDir,
    ];

  while (
    stack.length >
    0
  ) {
    const currentDir =
      stack.pop();

    if (
      currentDir ===
      undefined
    ) {
      continue;
    }

    const entries =
      fs.readdirSync(
        currentDir,
        {
          withFileTypes:
            true,
        },
      );

    entries.sort(
      (a, b) =>
        a.name.localeCompare(
          b.name,
          "en",
        ),
    );

    for (
      let index =
        entries.length -
        1;
      index >=
      0;
      index -=
      1
    ) {
      const entry =
        entries[index];

      const absolutePath =
        path.join(
          currentDir,
          entry.name,
        );

      const relativePath =
        toPosixRelative(
          rootDir,
          absolutePath,
        );

      if (
        shouldExcludePath(
          relativePath,
          entry.isDirectory(),
        )
      ) {
        continue;
      }

      if (
        entry.isSymbolicLink()
      ) {
        records.push({
          kind:
            "symlink",
          path:
            relativePath,
          target:
            fs.readlinkSync(
              absolutePath,
            ),
        });
        continue;
      }

      if (
        entry.isDirectory()
      ) {
        records.push({
          kind:
            "directory",
          path:
            relativePath,
        });
        stack.push(
          absolutePath,
        );
        continue;
      }

      if (
        entry.isFile()
      ) {
        const data =
          fs.readFileSync(
            absolutePath,
          );

        records.push({
          kind:
            "file",
          path:
            relativePath,
          bytes:
            data.length,
          sha256:
            sha256Buffer(
              data,
            ),
        });
      }
    }
  }

  records.sort(
    (a, b) => {
      const byPath =
        a.path.localeCompare(
          b.path,
          "en",
        );

      if (
        byPath !==
        0
      ) {
        return byPath;
      }

      return a.kind.localeCompare(
        b.kind,
        "en",
      );
    },
  );

  return records;
}

function getTargetReadmePaths() {
  return CONCEPTUAL_AREAS.map(
    (area) =>
      `${area.directory}/README.txt`,
  );
}

function snapshotProtectedEntries(
  rootDir,
) {
  const targetSet =
    new Set(
      getTargetReadmePaths(),
    );

  return walkProjectEntries(
    rootDir,
  ).filter(
    (record) =>
      (
        record.path ===
          "src" ||
        record.path.startsWith(
          "src/",
        )
      ) &&
      !targetSet.has(
        record.path,
      ),
  );
}

function stableStringify(
  value,
) {
  if (
    value ===
      null ||
    typeof value !==
      "object"
  ) {
    return JSON.stringify(
      value,
    );
  }

  if (
    Array.isArray(
      value,
    )
  ) {
    return `[${value
      .map(
        (entry) =>
          stableStringify(
            entry,
          ),
      )
      .join(
        ",",
      )}]`;
  }

  const keys =
    Object.keys(
      value,
    ).sort(
      (a, b) =>
        a.localeCompare(
          b,
          "en",
        ),
    );

  return `{${keys
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify(value[key])}`,
    )
    .join(
      ",",
    )}}`;
}

function digestValue(
  value,
) {
  return sha256Text(
    stableStringify(
      value,
    ),
  );
}

function inspectConceptualArea(
  rootDir,
  area,
) {
  const absoluteDirectory =
    fromPosixRelative(
      rootDir,
      area.directory,
    );

  const expectedReadme =
    `${area.directory}/README.txt`;

  const entries =
    fs.readdirSync(
      absoluteDirectory,
      {
        withFileTypes:
          true,
      },
    );

  const unexpected =
    [];

  let readmeState =
    "missing";

  for (
    const entry of
      entries
  ) {
    const relativePath =
      `${area.directory}/${entry.name}`;

    if (
      entry.name ===
      "README.txt"
    ) {
      if (
        entry.isSymbolicLink() ||
        !entry.isFile()
      ) {
        fail(
          `README.txt existente não é arquivo regular: ${expectedReadme}`,
        );
      }

      const expectedContent =
        buildReadmeContent(
          area,
        );

      const actualContent =
        fs.readFileSync(
          fromPosixRelative(
            rootDir,
            expectedReadme,
          ),
          "utf8",
        );

      if (
        actualContent !==
        expectedContent
      ) {
        fail(
          [
            `README.txt já existe com conteúdo diferente do contrato da Etapa 9: ${expectedReadme}`,
            "O arquivo não será sobrescrito automaticamente.",
          ].join(
            "\n",
          ),
        );
      }

      readmeState =
        "exact";
      continue;
    }

    unexpected.push({
      path:
        relativePath,
      kind:
        entry.isSymbolicLink()
          ? "symlink"
          : entry.isDirectory()
            ? "directory"
            : entry.isFile()
              ? "file"
              : "other",
    });
  }

  if (
    unexpected.length >
    0
  ) {
    fail(
      [
        `Área conceitual não está vazia para a Etapa 9: ${area.directory}/`,
        "Foram encontrados itens além do README.txt esperado:",
        ...unexpected.map(
          (record) =>
            `  - ${record.kind}: ${record.path}`,
        ),
        "A Etapa 9 só documenta pastas ainda sem implementação; nenhum item existente será removido ou alterado.",
      ].join(
        "\n",
      ),
    );
  }

  return {
    readmePath:
      expectedReadme,
    readmeState,
  };
}

function preflightConceptualAreas(
  rootDir,
) {
  const states =
    [];

  for (
    const area of
      CONCEPTUAL_AREAS
  ) {
    states.push(
      inspectConceptualArea(
        rootDir,
        area,
      ),
    );
  }

  return states;
}

function rollbackCreatedFiles(
  rootDir,
  createdPaths,
) {
  const failures =
    [];

  for (
    let index =
      createdPaths.length -
      1;
    index >=
      0;
    index -=
      1
  ) {
    const relativePath =
      createdPaths[index];

    const absolutePath =
      fromPosixRelative(
        rootDir,
        relativePath,
      );

    try {
      if (
        fs.existsSync(
          absolutePath,
        )
      ) {
        fs.unlinkSync(
          absolutePath,
        );
      }
    } catch (
      error
    ) {
      failures.push(
        `${relativePath}: ${
          error instanceof
          Error
            ? error.message
            : String(
                error,
              )
        }`,
      );
    }
  }

  if (
    failures.length >
    0
  ) {
    fail(
      [
        "Rollback da Etapa 9 encontrou falha(s):",
        ...failures.map(
          (failure) =>
            `  - ${failure}`,
        ),
      ].join(
        "\n",
      ),
    );
  }
}

function createReadmesTransactional(
  rootDir,
) {
  const created =
    [];

  const preserved =
    [];

  try {
    for (
      const area of
        CONCEPTUAL_AREAS
    ) {
      const relativePath =
        `${area.directory}/README.txt`;

      const absolutePath =
        fromPosixRelative(
          rootDir,
          relativePath,
        );

      const content =
        buildReadmeContent(
          area,
        );

      if (
        fs.existsSync(
          absolutePath,
        )
      ) {
        const stat =
          fs.lstatSync(
            absolutePath,
          );

        if (
          stat.isSymbolicLink() ||
          !stat.isFile()
        ) {
          fail(
            `Conflito no destino: ${relativePath}`,
          );
        }

        const actualContent =
          fs.readFileSync(
            absolutePath,
            "utf8",
          );

        if (
          actualContent !==
          content
        ) {
          fail(
            `README existente diverge do conteúdo esperado: ${relativePath}`,
          );
        }

        preserved.push({
          path:
            relativePath,
          sha256:
            sha256Text(
              content,
            ),
        });
        continue;
      }

      fs.writeFileSync(
        absolutePath,
        content,
        {
          encoding:
            "utf8",
          flag:
            "wx",
        },
      );

      created.push({
        path:
          relativePath,
        sha256:
          sha256Text(
            content,
        ),
      });
    }
  } catch (
    error
  ) {
    rollbackCreatedFiles(
      rootDir,
      created.map(
        (record) =>
          record.path,
      ),
    );

    throw error;
  }

  return {
    created,
    preserved,
  };
}

function verifyReadmes(
  rootDir,
) {
  const verified =
    [];

  for (
    const area of
      CONCEPTUAL_AREAS
  ) {
    const inspection =
      inspectConceptualArea(
        rootDir,
        area,
      );

    if (
      inspection.readmeState !==
      "exact"
    ) {
      fail(
        `README esperado ausente após Etapa 9: ${inspection.readmePath}`,
      );
    }

    const content =
      buildReadmeContent(
        area,
      );

    verified.push({
      path:
        inspection.readmePath,
      bytes:
        Buffer.byteLength(
          content,
          "utf8",
        ),
      sha256:
        sha256Text(
          content,
        ),
    });
  }

  return verified;
}

function verifyNoTypeScriptPlaceholders(
  rootDir,
) {
  const violations =
    [];

  for (
    const area of
      CONCEPTUAL_AREAS
  ) {
    const absoluteDirectory =
      fromPosixRelative(
        rootDir,
        area.directory,
      );

    const stack =
      [
        absoluteDirectory,
      ];

    while (
      stack.length >
      0
    ) {
      const currentDir =
        stack.pop();

      if (
        currentDir ===
        undefined
      ) {
        continue;
      }

      for (
        const entry of
          fs.readdirSync(
            currentDir,
            {
              withFileTypes:
                true,
            },
          )
      ) {
        const absolutePath =
          path.join(
            currentDir,
            entry.name,
          );

        const relativePath =
          toPosixRelative(
            rootDir,
            absolutePath,
          );

        if (
          entry.isSymbolicLink()
        ) {
          violations.push(
            `symlink: ${relativePath}`,
          );
          continue;
        }

        if (
          entry.isDirectory()
        ) {
          stack.push(
            absolutePath,
          );
          continue;
        }

        if (
          entry.isFile() &&
          (
            relativePath.endsWith(
              ".ts",
            ) ||
            relativePath.endsWith(
              ".tsx",
            ) ||
            relativePath.endsWith(
              ".mts",
            ) ||
            relativePath.endsWith(
              ".cts",
            )
          )
        ) {
          violations.push(
            `TypeScript: ${relativePath}`,
          );
        }
      }
    }
  }

  if (
    violations.length >
    0
  ) {
    fail(
      [
        "A Etapa 9 encontrou placeholder(s) TypeScript em área conceitual:",
        ...violations.map(
          (violation) =>
            `  - ${violation}`,
        ),
      ].join(
        "\n",
      ),
    );
  }
}

function verifyProtectedEntriesUnchanged(
  before,
  after,
) {
  const beforeDigest =
    digestValue(
      before,
    );

  const afterDigest =
    digestValue(
      after,
    );

  if (
    beforeDigest !==
    afterDigest
  ) {
    fail(
      [
        "A Etapa 9 alterou arquivo, diretório ou symlink fora dos 10 README.txt permitidos.",
        `Digest protegido antes: ${beforeDigest}`,
        `Digest protegido depois: ${afterDigest}`,
      ].join(
        "\n",
      ),
    );
  }

  return {
    beforeDigest,
    afterDigest,
  };
}

function printPlan() {
  console.log("");
  console.log(
    "=== ESCOPO EXATO DA ETAPA 9 ===",
  );
  console.log(
    `README.txt conceituais: ${String(CONCEPTUAL_AREAS.length)}`,
  );
  console.log(
    "Placeholders TypeScript: 0",
  );
  console.log(
    "Diretórios novos: 0",
  );
  console.log("");

  for (
    const area of
      CONCEPTUAL_AREAS
  ) {
    console.log(
      `  [README] ${area.directory}/README.txt`,
    );
  }
}

export function runStage9() {
  const options =
    parseArguments(
      process.argv.slice(
        2,
      ),
    );

  if (
    options.help
  ) {
    printHelp();
    return;
  }

  const rootDir =
    assertRepositoryRoot(
      process.cwd(),
    );

  console.log(
    "============================================================",
  );
  console.log(
    "  PROJETO1 — ETAPA 9: README.txt CONCEITUAIS             ",
  );
  console.log(
    "============================================================",
  );
  console.log("");
  console.log(
    `[OK] Raiz Git: ${rootDir}`,
  );

  assertArchitectureVersion();
  console.log(
    `[OK] Arquitetura: ${ARCHITECTURE_MIGRATION_VERSION}`,
  );

  const stage7Directories =
    validateStage7Structure(
      rootDir,
    );

  console.log(
    `[OK] Etapa 7 materializada: ${String(stage7Directories.length)}/69 diretórios.`,
  );

  validateStage8Structure(
    rootDir,
  );

  console.log(
    `[OK] Etapa 8 materializada: ${String(CONCEPTUAL_AREAS.length)}/10 diretórios conceituais.`,
  );

  const preflight =
    preflightConceptualAreas(
      rootDir,
    );

  const existingExact =
    preflight.filter(
      (record) =>
        record.readmeState ===
        "exact",
    ).length;

  console.log(
    `[OK] Preflight: ${String(existingExact)} README(s) exato(s), ${String(CONCEPTUAL_AREAS.length - existingExact)} pendente(s), nenhuma implementação existente.`,
  );

  printPlan();

  const protectedBefore =
    snapshotProtectedEntries(
      rootDir,
    );

  let creationResult =
    null;

  try {
    console.log("");
    console.log(
      "=== APLICAÇÃO TRANSACIONAL ===",
    );

    creationResult =
      createReadmesTransactional(
        rootDir,
      );

    const verified =
      verifyReadmes(
        rootDir,
      );

    verifyNoTypeScriptPlaceholders(
      rootDir,
    );

    const protectedAfter =
      snapshotProtectedEntries(
        rootDir,
      );

    const integrity =
      verifyProtectedEntriesUnchanged(
        protectedBefore,
        protectedAfter,
      );

    console.log(
      `[OK] Criados: ${String(creationResult.created.length)}`,
    );
    console.log(
      `[OK] Preservados idempotentemente: ${String(creationResult.preserved.length)}`,
    );
    console.log(
      `[OK] Verificados: ${String(verified.length)}/10 README.txt`,
    );
    console.log(
      "[OK] Placeholders .ts/.tsx/.mts/.cts: 0",
    );
    console.log(
      "[OK] Nenhum diretório foi criado ou removido.",
    );
    console.log(
      "[OK] Nenhum arquivo fora dos 10 README.txt foi alterado.",
    );
    console.log(
      `Digest protegido antes: ${integrity.beforeDigest}`,
    );
    console.log(
      `Digest protegido depois: ${integrity.afterDigest}`,
    );

    console.log("");
    console.log(
      "=== README.txt VERIFICADOS ===",
    );

    for (
      const record of
        verified
    ) {
      console.log(
        `  [OK] ${record.path} | ${String(record.bytes)} bytes | ${record.sha256}`,
      );
    }

    console.log("");
    console.log(
      "============================================================",
    );
    console.log(
      "  ETAPA 9 CONCLUÍDA COM SUCESSO                           ",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "As 10 áreas conceituais agora possuem somente README.txt arquiteturais; nenhum placeholder TypeScript foi criado.",
    );

    process.exitCode =
      0;
  } catch (
    error
  ) {
    if (
      creationResult !==
        null &&
      creationResult.created.length >
        0
    ) {
      rollbackCreatedFiles(
        rootDir,
        creationResult.created.map(
          (record) =>
            record.path,
        ),
      );
    }

    throw error;
  }
}

const executedAsMain =
  process.argv[1] !==
    undefined &&
  normalizeAbsolute(
    fileURLToPath(
      import.meta.url,
    ),
  ) ===
    normalizeAbsolute(
      process.argv[1],
    );

if (
  executedAsMain
) {
  try {
    runStage9();
  } catch (
    error
  ) {
    console.error("");
    console.error(
      "[ERRO] Etapa 9 não concluída.",
    );
    console.error(
      error instanceof
      Error
        ? (
            error.stack ??
            error.message
          )
        : String(
            error,
          ),
    );

    process.exitCode =
      1;
  }
}
