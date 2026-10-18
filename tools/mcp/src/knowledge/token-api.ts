/**
 * Extrai a API pública de um arquivo de token (`src/tokens/<key>.ts`) com o
 * compilador do TypeScript (só AST, sem type-checker): interfaces com
 * métodos/propriedades, assinaturas, JSDoc, aliases de tipo e capabilities
 * (`defineCapability<Api>("id", "versão")`).
 */

import ts from "typescript";

export interface TokenMember {
  name: string;
  kind: "method" | "property" | "call" | "index";
  optional: boolean;
  readonly: boolean;
  signature: string;
  doc: string | null;
  tags: Array<{ tag: string; text: string | null }>;
}

export interface TokenInterface {
  name: string;
  exported: boolean;
  extends: string[];
  typeParameters: string | null;
  doc: string | null;
  members: TokenMember[];
}

export interface TokenTypeAlias {
  name: string;
  signature: string;
  doc: string | null;
}

export interface TokenCapability {
  constName: string;
  api: string | null;
  id: string | null;
  version: string | null;
}

export interface TokenFileApi {
  interfaces: TokenInterface[];
  types: TokenTypeAlias[];
  capabilities: TokenCapability[];
}

function squash(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\s*;\s*$/, "").trim();
}

interface JSDocHolder {
  jsDoc?: ts.JSDoc[];
}

function docOf(node: ts.Node): { doc: string | null; tags: Array<{ tag: string; text: string | null }> } {
  const docs = (node as JSDocHolder).jsDoc ?? [];
  const parts: string[] = [];
  const tags: Array<{ tag: string; text: string | null }> = [];
  for (const d of docs) {
    const c = ts.getTextOfJSDocComment(d.comment);
    if (c) parts.push(c.trim());
    for (const t of d.tags ?? []) {
      const text = ts.getTextOfJSDocComment(t.comment);
      tags.push({ tag: t.tagName.text, text: text ? squash(text) : null });
    }
  }
  const doc = parts.join("\n").trim();
  return { doc: doc ? doc.replace(/[ \t]*\n[ \t]*/g, " ").replace(/\s+/g, " ") : null, tags };
}

function isExported(node: ts.Node): boolean {
  return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
}

function memberName(m: ts.TypeElement, sf: ts.SourceFile): string {
  if (m.name) return m.name.getText(sf);
  if (ts.isCallSignatureDeclaration(m)) return "(call)";
  if (ts.isConstructSignatureDeclaration(m)) return "(new)";
  if (ts.isIndexSignatureDeclaration(m)) return "[index]";
  return "(anônimo)";
}

function memberOf(m: ts.TypeElement, sf: ts.SourceFile): TokenMember {
  const { doc, tags } = docOf(m);
  const kind: TokenMember["kind"] = ts.isMethodSignature(m)
    ? "method"
    : ts.isPropertySignature(m)
      ? "property"
      : ts.isIndexSignatureDeclaration(m)
        ? "index"
        : "call";
  const readonly = (ts.getCombinedModifierFlags(m as unknown as ts.Declaration) & ts.ModifierFlags.Readonly) !== 0;
  return {
    name: memberName(m, sf),
    kind,
    optional: m.questionToken !== undefined,
    readonly,
    signature: squash(m.getText(sf)),
    doc,
    tags,
  };
}

/** Analisa o código-fonte de um arquivo de token. */
export function parseTokenSource(source: string, fileName = "token.ts"): TokenFileApi {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: TokenFileApi = { interfaces: [], types: [], capabilities: [] };
  for (const stmt of sf.statements) {
    if (ts.isInterfaceDeclaration(stmt)) {
      const { doc } = docOf(stmt);
      out.interfaces.push({
        name: stmt.name.text,
        exported: isExported(stmt),
        extends: (stmt.heritageClauses ?? []).flatMap((h) => h.types.map((t) => squash(t.getText(sf)))),
        typeParameters: stmt.typeParameters ? `<${stmt.typeParameters.map((p) => squash(p.getText(sf))).join(", ")}>` : null,
        doc,
        members: stmt.members.map((m) => memberOf(m, sf)),
      });
    } else if (ts.isTypeAliasDeclaration(stmt)) {
      out.types.push({ name: stmt.name.text, signature: squash(stmt.getText(sf)).replace(/^export\s+/, ""), doc: docOf(stmt).doc });
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        const init = decl.initializer;
        if (!init || !ts.isCallExpression(init)) continue;
        const callee = init.expression.getText(sf);
        if (!/defineCapability$/.test(callee)) continue;
        const [idArg, versionArg] = init.arguments;
        const lit = (n: ts.Expression | undefined): string | null => (n && ts.isStringLiteralLike(n) ? n.text : null);
        out.capabilities.push({
          constName: decl.name.getText(sf),
          api: init.typeArguments?.[0] ? squash(init.typeArguments[0].getText(sf)) : null,
          id: lit(idArg),
          version: lit(versionArg),
        });
      }
    }
  }
  return out;
}
