import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const LAYER1_BASELINE_AUDIT_VERSION =
  "1.0.0";

export const LAYER1_BASELINE_FILE =
  "LAYER1_BASELINE_V1.json";

function normalizeSlashes(
  value,
) {
  return value.replace(
    /\\/gu,
    "/",
  );
}

function stableStringify(
  value,
) {
  if (
    value === null ||
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
    return (
      "[" +
      value
        .map(
          stableStringify,
        )
        .join(",") +
      "]"
    );
  }

  const record =
    value;

  const keys =
    Object.keys(
      record,
    )
      .sort();

  return (
    "{" +
    keys
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableStringify(record[key])}`,
      )
      .join(",") +
    "}"
  );
}

function fileExists(
  projectRoot,
  relativePath,
) {
  const target =
    path.join(
      projectRoot,
      ...relativePath
        .split("/"),
    );

  return (
    fs.existsSync(
      target,
    ) &&
    fs.statSync(
      target,
    ).isFile()
  );
}

function directoryExists(
  projectRoot,
  relativePath,
) {
  const target =
    path.join(
      projectRoot,
      ...relativePath
        .split("/"),
    );

  return (
    fs.existsSync(
      target,
    ) &&
    fs.statSync(
      target,
    ).isDirectory()
  );
}

function listChildDirectories(
  projectRoot,
  relativePath,
) {
  const root =
    path.join(
      projectRoot,
      ...relativePath
        .split("/"),
    );

  if (
    !fs.existsSync(
      root,
    ) ||
    !fs.statSync(
      root,
    ).isDirectory()
  ) {
    return [];
  }

  return fs
    .readdirSync(
      root,
      {
        withFileTypes:
          true,
      },
    )
    .filter(
      (entry) =>
        entry
          .isDirectory(),
    )
    .map(
      (entry) =>
        entry.name,
    )
    .sort();
}

function listTokenFiles(
  projectRoot,
) {
  const root =
    path.join(
      projectRoot,
      "src",
      "tokens",
    );

  if (
    !fs.existsSync(
      root,
    ) ||
    !fs.statSync(
      root,
    ).isDirectory()
  ) {
    return [];
  }

  return fs
    .readdirSync(
      root,
      {
        withFileTypes:
          true,
      },
    )
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(
          ".ts",
        ),
    )
    .map(
      (entry) =>
        `src/tokens/${entry.name}`,
    )
    .sort();
}

function uniqueSorted(
  values,
) {
  return [
    ...new Set(
      values,
    ),
  ].sort();
}

function violation(
  code,
  scope,
  message,
) {
  return Object.freeze({
    code,
    scope,
    message,
  });
}

function findByKey(
  records,
  key,
) {
  return (
    records.find(
      (record) =>
        record.key === key,
    ) ??
    null
  );
}

function includesTokenIdentity(
  currentTokens,
  baselineToken,
) {
  return currentTokens.some(
    (currentToken) =>
      currentToken.path ===
        baselineToken.path &&
      currentToken.capabilityId ===
        baselineToken.capabilityId &&
      currentToken.primary ===
        baselineToken.primary,
  );
}

function allStringsIncluded(
  current,
  baseline,
) {
  const currentSet =
    new Set(
      current,
    );

  return baseline.every(
    (value) =>
      currentSet.has(
        value,
      ),
  );
}

export function projectLayer1Module(
  moduleRecord,
) {
  return Object.freeze({
    layer:
      moduleRecord.layer,
    key:
      moduleRecord.key,
    displayName:
      moduleRecord.displayName,
    category:
      moduleRecord.category,
    firstParty:
      moduleRecord.firstParty,
    bootstrapped:
      moduleRecord.bootstrapped,
    capabilityId:
      moduleRecord.capabilityId,
    capabilityVersion:
      moduleRecord.capabilityVersion,
    engine:
      Object.freeze({
        directoryName:
          moduleRecord.engine
            .directoryName,
        root:
          normalizeSlashes(
            moduleRecord.engine
              .root,
          ),
        publicRoot:
          normalizeSlashes(
            moduleRecord.engine
              .publicRoot,
          ),
        internalRoot:
          normalizeSlashes(
            moduleRecord.engine
              .internalRoot,
          ),
        presentInStage3:
          moduleRecord.engine
            .presentInStage3,
        implementationOrigin:
          moduleRecord.engine
            .implementationOrigin,
      }),
    contracts:
      Object.freeze(
        [
          ...moduleRecord
            .contracts,
        ].map(
          normalizeSlashes,
        ),
      ),
    tokens:
      Object.freeze(
        moduleRecord.tokens
          .map(
            (token) =>
              Object.freeze({
                path:
                  normalizeSlashes(
                    token.path,
                  ),
                capabilityId:
                  token.capabilityId,
                version:
                  token.version,
                primary:
                  token.primary,
              }),
          ),
      ),
    plugin:
      normalizeSlashes(
        moduleRecord.plugin,
      ),
    nativeFiles:
      Object.freeze(
        [
          ...moduleRecord
            .nativeFiles,
        ].map(
          normalizeSlashes,
        ),
      ),
    tests:
      Object.freeze(
        [
          ...moduleRecord
            .tests,
        ].map(
          normalizeSlashes,
        ),
      ),
    extraFiles:
      Object.freeze(
        [
          ...moduleRecord
            .extraFiles,
        ].map(
          normalizeSlashes,
        ),
      ),
  });
}

export function compareLayer1BaselineCompatibility(
  baseline,
  currentModules,
) {
  const violations = [];
  const additionalModuleKeys = [];

  for (
    const baselineModule of
    baseline.modules
  ) {
    const current =
      findByKey(
        currentModules,
        baselineModule.key,
      );

    if (
      current === null
    ) {
      violations.push(
        violation(
          "L1BASE001",
          baselineModule.key,
          "módulo da baseline v1 desapareceu.",
        ),
      );

      continue;
    }

    const scalarChecks =
      [
        [
          "layer",
          baselineModule.layer,
          current.layer,
        ],
        [
          "category",
          baselineModule.category,
          current.category,
        ],
        [
          "firstParty",
          baselineModule.firstParty,
          current.firstParty,
        ],
        [
          "bootstrapped",
          baselineModule.bootstrapped,
          current.bootstrapped,
        ],
        [
          "capabilityId",
          baselineModule.capabilityId,
          current.capabilityId,
        ],
        [
          "engine.directoryName",
          baselineModule.engine
            .directoryName,
          current.engine
            .directoryName,
        ],
        [
          "engine.root",
          baselineModule.engine
            .root,
          current.engine.root,
        ],
        [
          "engine.publicRoot",
          baselineModule.engine
            .publicRoot,
          current.engine
            .publicRoot,
        ],
        [
          "engine.internalRoot",
          baselineModule.engine
            .internalRoot,
          current.engine
            .internalRoot,
        ],
        [
          "engine.implementationOrigin",
          baselineModule.engine
            .implementationOrigin,
          current.engine
            .implementationOrigin,
        ],
        [
          "plugin",
          baselineModule.plugin,
          current.plugin,
        ],
      ];

    for (
      const [
        field,
        expected,
        actual,
      ] of
      scalarChecks
    ) {
      if (
        stableStringify(
          expected,
        ) !==
        stableStringify(
          actual,
        )
      ) {
        violations.push(
          violation(
            "L1BASE002",
            baselineModule.key,
            `${field} mudou sem nova baseline. Esperado ${stableStringify(expected)}; atual ${stableStringify(actual)}.`,
          ),
        );
      }
    }

    if (
      !allStringsIncluded(
        current.contracts,
        baselineModule
          .contracts,
      )
    ) {
      violations.push(
        violation(
          "L1BASE003",
          baselineModule.key,
          "um ou mais contracts certificados pela baseline v1 desapareceram.",
        ),
      );
    }

    for (
      const baselineToken of
      baselineModule.tokens
    ) {
      if (
        !includesTokenIdentity(
          current.tokens,
          baselineToken,
        )
      ) {
        violations.push(
          violation(
            "L1BASE004",
            baselineModule.key,
            `token certificado desapareceu ou mudou de identidade: ${baselineToken.path}.`,
          ),
        );
      }
    }

    const fileCollections =
      [
        [
          "nativeFiles",
          current.nativeFiles,
          baselineModule
            .nativeFiles,
        ],
        [
          "tests",
          current.tests,
          baselineModule
            .tests,
        ],
        [
          "extraFiles",
          current.extraFiles,
          baselineModule
            .extraFiles,
        ],
      ];

    for (
      const [
        field,
        currentValues,
        baselineValues,
      ] of
      fileCollections
    ) {
      if (
        !allStringsIncluded(
          currentValues,
          baselineValues,
        )
      ) {
        violations.push(
          violation(
            "L1BASE005",
            baselineModule.key,
            `${field} certificados pela baseline v1 foram removidos.`,
          ),
        );
      }
    }
  }

  const baselineKeys =
    new Set(
      baseline.modules.map(
        (moduleRecord) =>
          moduleRecord.key,
      ),
    );

  for (
    const current of
    currentModules
  ) {
    if (
      !baselineKeys.has(
        current.key,
      )
    ) {
      additionalModuleKeys.push(
        current.key,
      );
    }
  }

  additionalModuleKeys.sort();

  return Object.freeze({
    ok:
      violations.length ===
      0,
    preservedBaselineModules:
      baseline.modules.length -
      new Set(
        violations
          .filter(
            (item) =>
              item.code ===
              "L1BASE001",
          )
          .map(
            (item) =>
              item.scope,
          ),
      ).size,
    baselineModuleCount:
      baseline.modules.length,
    additionalModuleKeys:
      Object.freeze(
        additionalModuleKeys,
      ),
    violations:
      Object.freeze(
        violations,
      ),
  });
}

export function loadLayer1Baseline(
  projectRoot =
    process.cwd(),
) {
  const target =
    path.join(
      path.resolve(
        projectRoot,
      ),
      LAYER1_BASELINE_FILE,
    );

  if (
    !fs.existsSync(
      target,
    ) ||
    !fs.statSync(
      target,
    ).isFile()
  ) {
    throw new Error(
      `Baseline Layer 1 ausente: ${LAYER1_BASELINE_FILE}`,
    );
  }

  const parsed =
    JSON.parse(
      fs.readFileSync(
        target,
        "utf8",
      ),
    );

  if (
    parsed.schemaVersion !==
      1 ||
    parsed.baselineId !==
      "layer1-v1-stage71" ||
    !Array.isArray(
      parsed.modules,
    )
  ) {
    throw new Error(
      "LAYER1_BASELINE_V1.json inválido.",
    );
  }

  return parsed;
}

async function loadModuleMap(
  projectRoot,
) {
  const target =
    path.join(
      projectRoot,
      "scripts",
      "architecture",
      "module-map.mjs",
    );

  if (
    !fs.existsSync(
      target,
    ) ||
    !fs.statSync(
      target,
    ).isFile()
  ) {
    throw new Error(
      "scripts/architecture/module-map.mjs ausente.",
    );
  }

  return import(
    pathToFileURL(
      target,
    ).href
  );
}

function validateCurrentRegistry({
  projectRoot,
  moduleMap,
  currentModules,
}) {
  const violations = [];

  const seenKeys =
    new Set();

  const seenPrimaryCapabilities =
    new Set();

  const seenOwnedCapabilities =
    new Set();

  const seenFunctionalLayers =
    new Set();

  for (
    const moduleRecord of
    currentModules
  ) {
    if (
      seenKeys.has(
        moduleRecord.key,
      )
    ) {
      violations.push(
        violation(
          "L1BASE010",
          moduleRecord.key,
          "module key duplicada.",
        ),
      );
    }

    seenKeys.add(
      moduleRecord.key,
    );

    if (
      moduleRecord.category ===
        "functional"
    ) {
      if (
        !Number.isInteger(
          moduleRecord.layer,
        ) ||
        moduleRecord.layer <
          1
      ) {
        violations.push(
          violation(
            "L1BASE011",
            moduleRecord.key,
            "functional layer deve ser inteiro positivo.",
          ),
        );
      } else if (
        seenFunctionalLayers.has(
          moduleRecord.layer,
        )
      ) {
        violations.push(
          violation(
            "L1BASE011",
            moduleRecord.key,
            `functional layer duplicada: ${String(moduleRecord.layer)}.`,
          ),
        );
      } else {
        seenFunctionalLayers.add(
          moduleRecord.layer,
        );
      }
    } else if (
      moduleRecord.category ===
        "runtime"
    ) {
      if (
        moduleRecord.layer !==
          null
      ) {
        violations.push(
          violation(
            "L1BASE012",
            moduleRecord.key,
            "runtime module deve possuir layer null.",
          ),
        );
      }
    } else {
      violations.push(
        violation(
          "L1BASE013",
          moduleRecord.key,
          `category canônica inválida: ${String(moduleRecord.category)}.`,
        ),
      );
    }

    if (
      moduleRecord.firstParty !==
        true ||
      moduleRecord.bootstrapped !==
        true
    ) {
      violations.push(
        violation(
          "L1BASE014",
          moduleRecord.key,
          "módulo canônico deve permanecer first-party e bootstrapped.",
        ),
      );
    }

    const expectedRoot =
      `src/engine/${moduleRecord.key}`;

    if (
      moduleRecord.engine
        .directoryName !==
        moduleRecord.key ||
      moduleRecord.engine.root !==
        expectedRoot ||
      moduleRecord.engine
        .publicRoot !==
        `${expectedRoot}/public` ||
      moduleRecord.engine
        .internalRoot !==
        `${expectedRoot}/internal`
    ) {
      violations.push(
        violation(
          "L1BASE015",
          moduleRecord.key,
          "ownership de src/engine não segue o layout canônico.",
        ),
      );
    }

    if (
      !directoryExists(
        projectRoot,
        moduleRecord.engine
          .root,
      ) ||
      !directoryExists(
        projectRoot,
        moduleRecord.engine
          .publicRoot,
      ) ||
      !directoryExists(
        projectRoot,
        moduleRecord.engine
          .internalRoot,
      ) ||
      !fileExists(
        projectRoot,
        `${moduleRecord.engine.publicRoot}/index.ts`,
      )
    ) {
      violations.push(
        violation(
          "L1BASE016",
          moduleRecord.key,
          "engine root/public/internal/public index incompleto.",
        ),
      );
    }

    if (
      !Array.isArray(
        moduleRecord.contracts,
      ) ||
      moduleRecord.contracts
        .length === 0
    ) {
      violations.push(
        violation(
          "L1BASE017",
          moduleRecord.key,
          "módulo canônico precisa declarar contract.",
        ),
      );
    }

    for (
      const contractPath of
      moduleRecord.contracts
    ) {
      if (
        !fileExists(
          projectRoot,
          contractPath,
        )
      ) {
        violations.push(
          violation(
            "L1BASE018",
            moduleRecord.key,
            `contract declarado ausente: ${contractPath}.`,
          ),
        );
      }
    }

    if (
      !Array.isArray(
        moduleRecord.tokens,
      ) ||
      moduleRecord.tokens
        .length === 0
    ) {
      violations.push(
        violation(
          "L1BASE019",
          moduleRecord.key,
          "módulo canônico precisa declarar token.",
        ),
      );
    }

    const primaryTokens =
      moduleRecord.tokens
        .filter(
          (token) =>
            token.primary ===
            true,
        );

    if (
      primaryTokens.length !==
        1 ||
      primaryTokens[0]
        ?.capabilityId !==
        moduleRecord.capabilityId
    ) {
      violations.push(
        violation(
          "L1BASE020",
          moduleRecord.key,
          "deve existir exatamente um primary token igual ao capabilityId do módulo.",
        ),
      );
    }

    if (
      seenPrimaryCapabilities.has(
        moduleRecord.capabilityId,
      )
    ) {
      violations.push(
        violation(
          "L1BASE021",
          moduleRecord.key,
          `primary capability duplicada: ${moduleRecord.capabilityId}.`,
        ),
      );
    }

    seenPrimaryCapabilities.add(
      moduleRecord.capabilityId,
    );

    for (
      const token of
      moduleRecord.tokens
    ) {
      if (
        !fileExists(
          projectRoot,
          token.path,
        )
      ) {
        violations.push(
          violation(
            "L1BASE022",
            moduleRecord.key,
            `token declarado ausente: ${token.path}.`,
          ),
        );
      }

      if (
        seenOwnedCapabilities.has(
          token.capabilityId,
        )
      ) {
        violations.push(
          violation(
            "L1BASE023",
            moduleRecord.key,
            `owned capability duplicada: ${token.capabilityId}.`,
          ),
        );
      }

      seenOwnedCapabilities.add(
        token.capabilityId,
      );
    }

    if (
      !fileExists(
        projectRoot,
        moduleRecord.plugin,
      )
    ) {
      violations.push(
        violation(
          "L1BASE024",
          moduleRecord.key,
          `plugin declarado ausente: ${moduleRecord.plugin}.`,
        ),
      );
    }

    for (
      const declaredPath of
      [
        ...moduleRecord
          .nativeFiles,
        ...moduleRecord
          .tests,
        ...moduleRecord
          .extraFiles,
      ]
    ) {
      if (
        !fileExists(
          projectRoot,
          declaredPath,
        )
      ) {
        violations.push(
          violation(
            "L1BASE025",
            moduleRecord.key,
            `arquivo declarado ausente: ${declaredPath}.`,
          ),
        );
      }
    }
  }

  const canonicalEngineDirectories =
    uniqueSorted(
      currentModules.map(
        (moduleRecord) =>
          moduleRecord.engine
            .directoryName,
      ),
    );

  const actualEngineDirectories =
    listChildDirectories(
      projectRoot,
      "src/engine",
    );

  if (
    stableStringify(
      canonicalEngineDirectories,
    ) !==
    stableStringify(
      actualEngineDirectories,
    )
  ) {
    violations.push(
      violation(
        "L1BASE026",
        "src/engine",
        `engine directories divergentes do module-map. Canônico: ${canonicalEngineDirectories.join(", ")}. Atual: ${actualEngineDirectories.join(", ")}.`,
      ),
    );
  }

  const expectedPluginDirectories =
    uniqueSorted([
      ...currentModules.map(
        (moduleRecord) =>
          path.posix.basename(
            path.posix.dirname(
              moduleRecord.plugin,
            ),
          ),
      ),
      ...moduleMap.TOOLING_PLUGINS.map(
        (record) =>
          path.posix.basename(
            path.posix.dirname(
              record.plugin,
            ),
          ),
      ),
      ...moduleMap.EXPERIMENTAL_PLUGINS.map(
        (record) =>
          path.posix.basename(
            path.posix.dirname(
              record.plugin,
            ),
          ),
      ),
    ]);

  const actualPluginDirectories =
    listChildDirectories(
      projectRoot,
      "src/plugins",
    );

  if (
    stableStringify(
      expectedPluginDirectories,
    ) !==
    stableStringify(
      actualPluginDirectories,
    )
  ) {
    violations.push(
      violation(
        "L1BASE027",
        "src/plugins",
        `plugin directories divergentes do registry. Declarado: ${expectedPluginDirectories.join(", ")}. Atual: ${actualPluginDirectories.join(", ")}.`,
      ),
    );
  }

  const expectedContractAreas =
    uniqueSorted(
      currentModules
        .flatMap(
          (moduleRecord) =>
            moduleRecord
              .contracts,
        )
        .map(
          (contractPath) =>
            contractPath
              .slice(
                "src/contracts/"
                  .length,
              )
              .split("/")[0],
        ),
    );

  const actualContractAreas =
    listChildDirectories(
      projectRoot,
      "src/contracts",
    );

  if (
    stableStringify(
      expectedContractAreas,
    ) !==
    stableStringify(
      actualContractAreas,
    )
  ) {
    violations.push(
      violation(
        "L1BASE028",
        "src/contracts",
        `contract areas divergentes do module-map. Declarado: ${expectedContractAreas.join(", ")}. Atual: ${actualContractAreas.join(", ")}.`,
      ),
    );
  }

  const expectedTokenFiles =
    uniqueSorted(
      currentModules
        .flatMap(
          (moduleRecord) =>
            moduleRecord.tokens,
        )
        .map(
          (token) =>
            token.path,
        ),
    );

  const actualTokenFiles =
    listTokenFiles(
      projectRoot,
    );

  if (
    stableStringify(
      expectedTokenFiles,
    ) !==
    stableStringify(
      actualTokenFiles,
    )
  ) {
    violations.push(
      violation(
        "L1BASE029",
        "src/tokens",
        `token files divergentes do module-map. Declarado: ${expectedTokenFiles.join(", ")}. Atual: ${actualTokenFiles.join(", ")}.`,
      ),
    );
  }

  const compositionPath =
    path.join(
      projectRoot,
      "src",
      "app",
      "createEnginePlugins.ts",
    );

  if (
    !fs.existsSync(
      compositionPath,
    ) ||
    !fs.statSync(
      compositionPath,
    ).isFile()
  ) {
    violations.push(
      violation(
        "L1BASE030",
        "composition-root",
        "src/app/createEnginePlugins.ts ausente.",
      ),
    );
  } else {
    const source =
      fs.readFileSync(
        compositionPath,
        "utf8",
      );

    const bootstrappedPluginPaths =
      [
        ...currentModules
          .filter(
            (record) =>
              record.bootstrapped ===
              true,
          )
          .map(
            (record) =>
              record.plugin,
          ),
        ...moduleMap
          .TOOLING_PLUGINS
          .filter(
            (record) =>
              record.bootstrapped ===
              true,
          )
          .map(
            (record) =>
              record.plugin,
          ),
      ];

    for (
      const pluginPath of
      bootstrappedPluginPaths
    ) {
      const importFragment =
        pluginPath
          .replace(
            /^src\/plugins\//u,
            "../plugins/",
          )
          .replace(
            /\.ts$/u,
            "",
          );

      if (
        !source.includes(
          importFragment,
        )
      ) {
        violations.push(
          violation(
            "L1BASE031",
            "composition-root",
            `plugin bootstrapped não aparece no composition root: ${pluginPath}.`,
          ),
        );
      }
    }

    for (
      const record of
      moduleMap
        .EXPERIMENTAL_PLUGINS
    ) {
      if (
        record.bootstrapped ===
          false
      ) {
        const importFragment =
          record.plugin
            .replace(
              /^src\/plugins\//u,
              "../plugins/",
            )
            .replace(
              /\.ts$/u,
              "",
            );

        if (
          source.includes(
            importFragment,
          )
        ) {
          violations.push(
            violation(
              "L1BASE032",
              "composition-root",
              `plugin experimental não-bootstrapped entrou na composição: ${record.plugin}.`,
            ),
          );
        }
      }
    }
  }

  return Object.freeze({
    violations:
      Object.freeze(
        violations,
      ),
    ownedCapabilityCount:
      seenOwnedCapabilities
        .size,
    functionalLayerCount:
      seenFunctionalLayers
        .size,
    engineDirectoryCount:
      actualEngineDirectories
        .length,
    pluginDirectoryCount:
      actualPluginDirectories
        .length,
    contractAreaCount:
      actualContractAreas
        .length,
    tokenFileCount:
      actualTokenFiles.length,
  });
}

function validateAuxiliaryRegistry({
  projectRoot,
  baselineRecords,
  currentRecords,
  kind,
}) {
  const violations = [];

  for (
    const baselineRecord of
    baselineRecords
  ) {
    const current =
      findByKey(
        currentRecords,
        baselineRecord.key,
      );

    if (
      current === null
    ) {
      violations.push(
        violation(
          "L1BASE040",
          kind,
          `${kind} da baseline desapareceu: ${baselineRecord.key}.`,
        ),
      );

      continue;
    }

    for (
      const field of
      [
        "pluginId",
        "plugin",
        "category",
        "bootstrapped",
        "canonicalEngineModule",
      ]
    ) {
      if (
        stableStringify(
          current[field],
        ) !==
        stableStringify(
          baselineRecord[field],
        )
      ) {
        violations.push(
          violation(
            "L1BASE041",
            kind,
            `${baselineRecord.key}.${field} divergiu da baseline.`,
          ),
        );
      }
    }
  }

  for (
    const record of
    currentRecords
  ) {
    if (
      !fileExists(
        projectRoot,
        record.plugin,
      )
    ) {
      violations.push(
        violation(
          "L1BASE042",
          kind,
          `plugin registrado ausente: ${record.plugin}.`,
        ),
      );
    }
  }

  return Object.freeze(
    violations,
  );
}

export async function auditLayer1Baseline({
  projectRoot =
    process.cwd(),
} = {}) {
  const absoluteRoot =
    path.resolve(
      projectRoot,
    );

  const baseline =
    loadLayer1Baseline(
      absoluteRoot,
    );

  const moduleMap =
    await loadModuleMap(
      absoluteRoot,
    );

  const currentModules =
    moduleMap
      .CANONICAL_MODULES
      .map(
        projectLayer1Module,
      );

  const violations = [];

  if (
    moduleMap
      .ARCHITECTURE_MIGRATION_VERSION !==
    baseline
      .capturedArchitectureMigrationVersion
  ) {
    violations.push(
      violation(
        "L1BASE050",
        "module-map",
        `architecture version mudou de ${baseline.capturedArchitectureMigrationVersion} para ${String(moduleMap.ARCHITECTURE_MIGRATION_VERSION)}; exige nova baseline formal.`,
      ),
    );
  }

  if (
    moduleMap
      .MODULE_MAP_SCHEMA_VERSION !==
    baseline
      .capturedModuleMapSchemaVersion
  ) {
    violations.push(
      violation(
        "L1BASE051",
        "module-map",
        `schema version mudou de ${String(baseline.capturedModuleMapSchemaVersion)} para ${String(moduleMap.MODULE_MAP_SCHEMA_VERSION)}; exige nova baseline formal.`,
      ),
    );
  }

  const compatibility =
    compareLayer1BaselineCompatibility(
      baseline,
      currentModules,
    );

  violations.push(
    ...compatibility
      .violations,
  );

  const registry =
    validateCurrentRegistry({
      projectRoot:
        absoluteRoot,
      moduleMap,
      currentModules,
    });

  violations.push(
    ...registry
      .violations,
  );

  violations.push(
    ...validateAuxiliaryRegistry({
      projectRoot:
        absoluteRoot,
      baselineRecords:
        baseline
          .toolingPlugins,
      currentRecords:
        moduleMap
          .TOOLING_PLUGINS,
      kind:
        "tooling",
    }),
  );

  violations.push(
    ...validateAuxiliaryRegistry({
      projectRoot:
        absoluteRoot,
      baselineRecords:
        baseline
          .experimentalPlugins,
      currentRecords:
        moduleMap
          .EXPERIMENTAL_PLUGINS,
      kind:
        "experimental",
    }),
  );

  for (
    const requiredFile of
    [
      ...baseline
        .workerInfrastructureFiles,
      ...baseline
        .nativeHostFiles,
    ]
  ) {
    if (
      !fileExists(
        absoluteRoot,
        requiredFile,
      )
    ) {
      violations.push(
        violation(
          "L1BASE060",
          "infrastructure",
          `arquivo de baseline ausente: ${requiredFile}.`,
        ),
      );
    }
  }

  violations.sort(
    (
      left,
      right,
    ) => {
      if (
        left.code !==
        right.code
      ) {
        return left.code
          .localeCompare(
            right.code,
          );
      }

      if (
        left.scope !==
        right.scope
      ) {
        return left.scope
          .localeCompare(
            right.scope,
          );
      }

      return left.message
        .localeCompare(
          right.message,
        );
    },
  );

  const currentFunctionalCount =
    currentModules.filter(
      (record) =>
        record.category ===
        "functional",
    ).length;

  const currentRuntimeCount =
    currentModules.filter(
      (record) =>
        record.category ===
        "runtime",
    ).length;

  return Object.freeze({
    version:
      LAYER1_BASELINE_AUDIT_VERSION,
    baselineId:
      baseline.baselineId,
    capturedCounts:
      Object.freeze(
        baseline
          .capturedCounts,
      ),
    currentCounts:
      Object.freeze({
        canonicalModules:
          currentModules.length,
        functionalModules:
          currentFunctionalCount,
        runtimeModules:
          currentRuntimeCount,
        ownedCapabilities:
          registry
            .ownedCapabilityCount,
        engineDirectories:
          registry
            .engineDirectoryCount,
        pluginDirectories:
          registry
            .pluginDirectoryCount,
        contractAreas:
          registry
            .contractAreaCount,
        tokenFiles:
          registry
            .tokenFileCount,
      }),
    compatibility:
      Object.freeze({
        preservedBaselineModules:
          compatibility
            .preservedBaselineModules,
        baselineModuleCount:
          compatibility
            .baselineModuleCount,
        additionalCanonicalModules:
          compatibility
            .additionalModuleKeys,
      }),
    policy:
      Object.freeze({
        additionalCanonicalModulesAllowed:
          baseline.policy
            .additionalCanonicalModulesAllowedAfterBaseline,
        moduleCountAtCaptureIsNotAPermanentLimit:
          baseline.policy
            .moduleCountAtCaptureIsNotAPermanentLimit,
      }),
    violations:
      Object.freeze(
        violations,
      ),
    ok:
      violations.length ===
      0,
  });
}

export function formatLayer1BaselineAudit(
  result,
) {
  const lines = [
    "============================================================",
    "  PROJETO1 — LAYER 1 BASELINE & INVENTORY AUDIT",
    "============================================================",
    "",
    `[INFO] Audit version: ${result.version}`,
    `[INFO] Baseline ID: ${result.baselineId}`,
    `[INFO] Canonical modules at capture: ${String(result.capturedCounts.canonicalModules)}`,
    `[INFO] Canonical modules atuais: ${String(result.currentCounts.canonicalModules)}`,
    `[INFO] Functional modules atuais: ${String(result.currentCounts.functionalModules)}`,
    `[INFO] Runtime modules atuais: ${String(result.currentCounts.runtimeModules)}`,
    `[INFO] Owned capabilities atuais: ${String(result.currentCounts.ownedCapabilities)}`,
    `[INFO] Engine directories atuais: ${String(result.currentCounts.engineDirectories)}`,
    `[INFO] Plugin directories atuais: ${String(result.currentCounts.pluginDirectories)}`,
    `[INFO] Contract areas atuais: ${String(result.currentCounts.contractAreas)}`,
    `[INFO] Token files atuais: ${String(result.currentCounts.tokenFiles)}`,
    `[INFO] Baseline modules preservados: ${String(result.compatibility.preservedBaselineModules)}/${String(result.compatibility.baselineModuleCount)}`,
    `[INFO] Additional canonical modules: ${String(result.compatibility.additionalCanonicalModules.length)}`,
    `[INFO] Extensible baseline: ${result.policy.additionalCanonicalModulesAllowed ? "YES" : "NO"}`,
    `[INFO] Capture count is permanent limit: ${result.policy.moduleCountAtCaptureIsNotAPermanentLimit ? "NO" : "YES"}`,
    "",
  ];

  if (
    result.compatibility
      .additionalCanonicalModules
      .length > 0
  ) {
    lines.push(
      `[INFO] New canonical modules: ${result.compatibility.additionalCanonicalModules.join(", ")}`,
      "",
    );
  }

  if (result.ok) {
    lines.push(
      "[OK] Violações da baseline Layer 1: 0",
      "[OK] Module map permanece a fonte canônica de verdade.",
      "[OK] Baseline v1 preservada e arquitetura continua extensível.",
    );
  } else {
    lines.push(
      `[FAIL] Violações da baseline Layer 1: ${String(result.violations.length)}`,
    );

    for (
      const item of
      result.violations
    ) {
      lines.push(
        `[${item.code}] ${item.scope} — ${item.message}`,
      );
    }
  }

  return lines.join(
    "\n",
  );
}
