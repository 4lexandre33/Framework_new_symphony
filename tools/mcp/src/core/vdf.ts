/**
 * VDF (KeyValues da Valve) — serializador e parser usados pelo SteamPipe
 * (`app_build_<appId>.vdf`, `depot_build_<depotId>.vdf`).
 *
 * Formato: pares `"chave" "valor"` ou `"chave" { ... }`, um por linha,
 * indentação com tab. Escapes reconhecidos pelo Steam: `\\`, `\"`, `\n`, `\t`.
 *
 * - `serializeVdf(root)`: objeto ordenado → texto (CRLF não; `\n`).
 *   Valores `number`/`boolean` viram texto (`true` → "1").
 * - `parseVdf(text)`: texto → objeto (chave repetida: a última vence).
 *   Aceita tokens sem aspas, comentários `//` e ignora condicionais `[$WIN32]`.
 */

export type VdfScalar = string | number | boolean;
export interface VdfObject {
  [key: string]: VdfValue;
}
export type VdfValue = VdfScalar | VdfObject;

/** Escapa `\`, `"`, quebra de linha e tab; remove outros caracteres de controle. */
export function escapeVdf(value: string): string {
  let out = "";
  for (const ch of value) {
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\r") continue;
    else if (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f) continue;
    else out += ch;
  }
  return out;
}

function scalarToString(value: VdfScalar): string {
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`VDF: número inválido ${value}`);
    return String(value);
  }
  return value;
}

function writeObject(obj: VdfObject, depth: number, lines: string[]): void {
  const indent = "\t".repeat(depth);
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && typeof value === "object") {
      lines.push(`${indent}"${escapeVdf(key)}"`);
      lines.push(`${indent}{`);
      writeObject(value, depth + 1, lines);
      lines.push(`${indent}}`);
    } else {
      lines.push(`${indent}"${escapeVdf(key)}"\t"${escapeVdf(scalarToString(value))}"`);
    }
  }
}

/** Serializa um objeto VDF (ex.: `{ AppBuild: { AppID: 480, ... } }`). Termina com `\n`. */
export function serializeVdf(root: VdfObject): string {
  const lines: string[] = [];
  writeObject(root, 0, lines);
  return lines.join("\n") + "\n";
}

/* ============================================================================
 * Parser
 * ========================================================================== */

type Token = { kind: "string"; value: string; line: number } | { kind: "open" | "close"; line: number };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  const n = text.length;
  while (i < n) {
    const ch = text[i]!;
    if (ch === "\n") {
      line++;
      i++;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "﻿") {
      i++;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (ch === "{") {
      tokens.push({ kind: "open", line });
      i++;
      continue;
    }
    if (ch === "}") {
      tokens.push({ kind: "close", line });
      i++;
      continue;
    }
    if (ch === "[") {
      // condicional de plataforma ([$WIN32]) — ignorado
      while (i < n && text[i] !== "]" && text[i] !== "\n") i++;
      if (text[i] === "]") i++;
      continue;
    }
    if (ch === '"') {
      const startLine = line;
      i++;
      let value = "";
      let closed = false;
      while (i < n) {
        const c = text[i]!;
        if (c === "\\" && i + 1 < n) {
          const next = text[i + 1]!;
          value += next === "n" ? "\n" : next === "t" ? "\t" : next === "\\" ? "\\" : next === '"' ? '"' : `\\${next}`;
          i += 2;
          continue;
        }
        if (c === '"') {
          closed = true;
          i++;
          break;
        }
        if (c === "\n") line++;
        value += c;
        i++;
      }
      if (!closed) throw new Error(`VDF: aspas não fechadas (linha ${startLine})`);
      tokens.push({ kind: "string", value, line: startLine });
      continue;
    }
    // token sem aspas
    let value = "";
    while (i < n && !/[\s{}"]/u.test(text[i]!)) value += text[i++];
    tokens.push({ kind: "string", value, line });
  }
  return tokens;
}

/** Faz o parse de um texto VDF. Lança `Error` com a linha em caso de sintaxe inválida. */
export function parseVdf(text: string): VdfObject {
  const tokens = tokenize(text);
  let pos = 0;
  const parseBody = (closing: boolean): VdfObject => {
    const obj: VdfObject = {};
    for (;;) {
      const tok = tokens[pos];
      if (tok === undefined) {
        if (closing) throw new Error("VDF: '}' faltando no fim do arquivo");
        return obj;
      }
      if (tok.kind === "close") {
        if (!closing) throw new Error(`VDF: '}' inesperado (linha ${tok.line})`);
        pos++;
        return obj;
      }
      if (tok.kind !== "string") throw new Error(`VDF: '{' sem chave (linha ${tok.line})`);
      pos++;
      const next = tokens[pos];
      if (next === undefined) throw new Error(`VDF: chave "${tok.value}" sem valor (linha ${tok.line})`);
      if (next.kind === "open") {
        pos++;
        obj[tok.value] = parseBody(true);
      } else if (next.kind === "string") {
        pos++;
        obj[tok.value] = next.value;
      } else {
        throw new Error(`VDF: chave "${tok.value}" sem valor (linha ${tok.line})`);
      }
    }
  };
  return parseBody(false);
}
