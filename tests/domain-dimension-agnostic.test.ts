import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

import {
  describe,
  expect,
  it,
} from "vitest";

const DOMAIN_ROOT =
  path.resolve(
    process.cwd(),
    "src/domain",
  );

const BANNED_RUNTIME_GLOBALS =
  new Set([
    "document",
    "window",
    "navigator",
    "localStorage",
    "sessionStorage",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "performance",
    "HTMLElement",
    "HTMLCanvasElement",
    "WebGLRenderingContext",
    "WebGL2RenderingContext",
  ]);

function listTypeScriptFiles(
  root: string,
): string[] {
  const files: string[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const current =
      stack.pop();

    if (current === undefined) {
      continue;
    }

    const entries =
      fs.readdirSync(
        current,
        {
          withFileTypes: true,
        },
      );

    for (const entry of entries) {
      const full =
        path.join(
          current,
          entry.name,
        );

      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }

      if (
        entry.isFile() &&
        entry.name.endsWith(
          ".ts",
        )
      ) {
        files.push(full);
      }
    }
  }

  files.sort();
  return files;
}

function collectModuleSpecifiers(
  sourceFile:
    ts.SourceFile,
): string[] {
  const values: string[] = [];

  function pushLiteral(
    node:
      ts.Expression |
      ts.TypeNode,
  ): void {
    if (
      ts.isStringLiteralLike(
        node,
      )
    ) {
      values.push(node.text);
    }
  }

  function visit(
    node: ts.Node,
  ): void {
    if (
      ts.isImportDeclaration(
        node,
      ) ||
      ts.isExportDeclaration(
        node,
      )
    ) {
      if (
        node.moduleSpecifier !==
        undefined
      ) {
        pushLiteral(
          node.moduleSpecifier,
        );
      }
    }

    if (
      ts.isCallExpression(
        node,
      ) &&
      node.expression.kind ===
        ts.SyntaxKind
          .ImportKeyword &&
      node.arguments.length > 0
    ) {
      const first =
        node.arguments[0];

      if (first !== undefined) {
        pushLiteral(first);
      }
    }

    if (
      ts.isImportTypeNode(node)
    ) {
      const argument =
        node.argument;

      if (
        ts.isLiteralTypeNode(
          argument,
        )
      ) {
        pushLiteral(
          argument.literal,
        );
      }
    }

    ts.forEachChild(
      node,
      visit,
    );
  }

  visit(sourceFile);
  return values;
}

function collectForbiddenGlobals(
  sourceFile:
    ts.SourceFile,
): string[] {
  const values = new Set<
    string
  >();

  function visit(
    node: ts.Node,
  ): void {
    if (
      ts.isIdentifier(node) &&
      BANNED_RUNTIME_GLOBALS.has(
        node.text,
      )
    ) {
      values.add(node.text);
    }

    ts.forEachChild(
      node,
      visit,
    );
  }

  visit(sourceFile);
  return [...values].sort();
}

function resolvesInsideDomain(
  importer: string,
  specifier: string,
): boolean {
  if (
    !specifier.startsWith(".")
  ) {
    return false;
  }

  const resolved =
    path.resolve(
      path.dirname(importer),
      specifier,
    );

  const relative =
    path.relative(
      DOMAIN_ROOT,
      resolved,
    );

  return (
    relative !== ".." &&
    !relative.startsWith(
      `..${path.sep}`,
    ) &&
    !path.isAbsolute(relative)
  );
}

describe(
  "Etapa 44.0 — L2 dimension agnostic",
  () => {
    it(
      "mantém todo src/domain independente de infraestrutura 2D/2.5D/3D",
      () => {
        const violations:
          string[] = [];

        for (
          const file of
          listTypeScriptFiles(
            DOMAIN_ROOT,
          )
        ) {
          const sourceText =
            fs.readFileSync(
              file,
              "utf8",
            );

          const sourceFile =
            ts.createSourceFile(
              file,
              sourceText,
              ts.ScriptTarget
                .ES2020,
              true,
              ts.ScriptKind.TS,
            );

          const relativeFile =
            path.relative(
              process.cwd(),
              file,
            );

          for (
            const specifier of
            collectModuleSpecifiers(
              sourceFile,
            )
          ) {
            if (
              !resolvesInsideDomain(
                file,
                specifier,
              )
            ) {
              violations.push(
                `${relativeFile}: import externo proibido "${specifier}"`,
              );
            }
          }

          for (
            const globalName of
            collectForbiddenGlobals(
              sourceFile,
            )
          ) {
            violations.push(
              `${relativeFile}: global de infraestrutura proibido "${globalName}"`,
            );
          }
        }

        expect(
          violations,
          violations.join("\n"),
        ).toEqual([]);
      },
    );
  },
);
