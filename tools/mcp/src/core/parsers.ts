/**
 * Parsers das saídas dos gates (T4 — SPEC §3.3).
 *
 * Funções puras: recebem o texto (stdout+stderr) ou o JSON de um comando e
 * devolvem `GateFailure[]` normalizadas `{ file, line?, column?, code?, message }`.
 * Caminhos absolutos dentro de `root` viram relativos com `/`.
 */

import path from "node:path";

export interface GateFailure {
  /** Arquivo relativo à raiz (ou um rótulo como `npm run arch:check` se não há arquivo). */
  file: string;
  line?: number;
  column?: number;
  /** Código/regra (ex.: `TS2322`, `BND001`, `E0425`, `DOC_REF_MISSING`). */
  code?: string;
  message: string;
}

/* ============================================================================
 * Utilitários
 * ========================================================================== */

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

function lines(text: string): string[] {
  return stripAnsi(text).replace(/\r\n?/g, "\n").split("\n");
}

/** Converte caminho (absoluto, `file://`, `\`) em relativo à raiz quando possível. */
export function relativizePath(file: string, root?: string): string {
  let f = file.trim();
  if (f.startsWith("file://")) {
    try {
      f = decodeURIComponent(new URL(f).pathname);
    } catch {
      /* mantém */
    }
  }
  f = f.replace(/\\/g, "/");
  if (root) {
    const r = root.replace(/\\/g, "/").replace(/\/+$/, "");
    if (f === r) return ".";
    if (f.startsWith(`${r}/`)) return f.slice(r.length + 1);
    if (path.isAbsolute(f)) {
      const rel = path.relative(root, f).replace(/\\/g, "/");
      if (!rel.startsWith("..")) return rel;
    }
  }
  return f.replace(/^\.\//, "");
}

function int(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

function failure(file: string, message: string, extra: { line?: number | undefined; column?: number | undefined; code?: string | undefined } = {}): GateFailure {
  const out: GateFailure = { file, message: message.trim() };
  if (extra.line !== undefined) out.line = extra.line;
  if (extra.column !== undefined) out.column = extra.column;
  if (extra.code !== undefined && extra.code !== "") out.code = extra.code;
  return out;
}

/** `src/x.ts:12:3` / `src/x.ts:12` / `src/x.ts` → partes. */
export function splitLocation(scope: string, root?: string): { file: string; line?: number; column?: number } {
  const m = /^(.*?):(\d+)(?::(\d+))?$/.exec(scope.trim());
  if (m && m[1] && !/^[a-z]$/i.test(m[1])) {
    const out: { file: string; line?: number; column?: number } = { file: relativizePath(m[1], root) };
    const line = int(m[2]);
    const column = int(m[3]);
    if (line !== undefined) out.line = line;
    if (column !== undefined) out.column = column;
    return out;
  }
  return { file: relativizePath(scope, root) };
}

/** Remove duplicatas (mesmo arquivo/linha/coluna/código/mensagem). */
export function dedupeFailures(list: readonly GateFailure[]): GateFailure[] {
  const seen = new Set<string>();
  const out: GateFailure[] = [];
  for (const f of list) {
    const key = `${f.file}|${f.line ?? ""}|${f.column ?? ""}|${f.code ?? ""}|${f.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/** Últimos `maxChars` caracteres (sem ANSI), cortando no início de uma linha. */
export function tailText(text: string, maxChars = 4000): string {
  const clean = stripAnsi(text).replace(/\r\n?/g, "\n").trimEnd();
  if (clean.length <= maxChars) return clean;
  const cut = clean.slice(-maxChars);
  const nl = cut.indexOf("\n");
  return nl >= 0 && nl < 200 ? cut.slice(nl + 1) : cut;
}

/* ============================================================================
 * TypeScript (tsc)
 * ========================================================================== */

const TSC_RE = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.*)$/;
const TSC_GLOBAL_RE = /^(error|warning) (TS\d+): (.*)$/;

/** `file(line,col): error TSxxxx: msg` (+ linhas de continuação indentadas). */
export function parseTsc(text: string, root?: string): GateFailure[] {
  const out: GateFailure[] = [];
  let last: GateFailure | null = null;
  for (const raw of lines(text)) {
    const m = TSC_RE.exec(raw);
    if (m) {
      if (m[4] !== "error") {
        last = null;
        continue;
      }
      last = failure(relativizePath(m[1]!, root), m[6]!, { line: int(m[2]), column: int(m[3]), code: m[5] });
      out.push(last);
      continue;
    }
    const g = TSC_GLOBAL_RE.exec(raw.trim());
    if (g && g[1] === "error") {
      last = failure("tsconfig", g[3]!, { code: g[2] });
      out.push(last);
      continue;
    }
    if (last && /^\s{2,}\S/.test(raw) && last.message.length < 2000) {
      last.message += `\n${raw.trim()}`;
      continue;
    }
    last = null;
  }
  return out;
}

/* ============================================================================
 * Vitest (reporter JSON)
 * ========================================================================== */

export type TestStatus = "passed" | "failed" | "skipped" | "pending" | "todo" | "disabled";

export interface VitestTestResult {
  name: string;
  fullName: string;
  ancestors: string[];
  status: TestStatus;
  durationMs?: number;
  failureMessages?: string[];
  line?: number;
  column?: number;
}

export interface VitestFileResult {
  file: string;
  status: "passed" | "failed" | "skipped";
  /** Erro de carga/suíte (ex.: import quebrado). */
  message?: string;
  durationMs?: number;
  tests: VitestTestResult[];
}

export interface VitestReport {
  success: boolean;
  counts: { files: number; failedFiles: number; tests: number; passed: number; failed: number; skipped: number; todo: number };
  files: VitestFileResult[];
  failures: GateFailure[];
}

interface VitestJsonAssertion {
  ancestorTitles?: string[];
  fullName?: string;
  title?: string;
  status?: string;
  duration?: number | null;
  failureMessages?: string[];
  location?: { line?: number; column?: number } | null;
}
interface VitestJsonFile {
  name?: string;
  status?: string;
  message?: string;
  startTime?: number;
  endTime?: number;
  assertionResults?: VitestJsonAssertion[];
}
interface VitestJson {
  success?: boolean;
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
  numTodoTests?: number;
  testResults?: VitestJsonFile[];
}

const MAX_FAILURE_MESSAGE = 4000;

function firstLine(text: string): string {
  return (text.split("\n").find((l) => l.trim() !== "") ?? text).trim();
}

/** Linha/coluna do primeiro frame da pilha que aponta para o próprio arquivo de teste. */
function locationInStack(messages: readonly string[], absFile: string): { line?: number; column?: number } {
  const target = absFile.replace(/\\/g, "/");
  for (const msg of messages) {
    for (const l of msg.split("\n")) {
      const norm = l.replace(/\\/g, "/");
      const idx = norm.indexOf(target);
      if (idx < 0) continue;
      const m = /^:(\d+):(\d+)/.exec(norm.slice(idx + target.length));
      if (m) return { line: Number(m[1]), column: Number(m[2]) };
    }
  }
  return {};
}

function normalizeStatus(s: string | undefined): TestStatus {
  switch (s) {
    case "passed":
    case "failed":
    case "skipped":
    case "pending":
    case "todo":
    case "disabled":
      return s;
    default:
      return "failed";
  }
}

/** Converte o JSON do `vitest --reporter=json` em resultados por arquivo/teste + `failures`. */
export function parseVitestJson(input: string | object, root?: string): VitestReport {
  const json = (typeof input === "string" ? JSON.parse(input) : input) as VitestJson;
  const files: VitestFileResult[] = [];
  const failures: GateFailure[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let todo = 0;
  for (const tf of json.testResults ?? []) {
    const abs = tf.name ?? "";
    const file = relativizePath(abs, root);
    const tests: VitestTestResult[] = [];
    for (const a of tf.assertionResults ?? []) {
      const status = normalizeStatus(a.status);
      const msgs = (a.failureMessages ?? []).map((m) => stripAnsi(m).slice(0, MAX_FAILURE_MESSAGE));
      const loc = a.location && typeof a.location.line === "number" ? { line: a.location.line, column: a.location.column } : locationInStack(msgs, abs);
      const t: VitestTestResult = {
        name: a.title ?? a.fullName ?? "",
        fullName: a.fullName ?? a.title ?? "",
        ancestors: a.ancestorTitles ?? [],
        status,
      };
      if (typeof a.duration === "number") t.durationMs = Math.round(a.duration * 100) / 100;
      if (msgs.length > 0) t.failureMessages = msgs;
      if (loc.line !== undefined) t.line = loc.line;
      if (loc.column !== undefined) t.column = loc.column;
      tests.push(t);
      if (status === "passed") passed++;
      else if (status === "failed") {
        failed++;
        failures.push(failure(file, `${t.fullName}: ${firstLine(msgs[0] ?? "falhou")}`, { line: t.line, column: t.column, code: "TEST_FAILED" }));
      } else if (status === "todo") todo++;
      else skipped++;
    }
    const fileFailed = tf.status === "failed" || tests.some((t) => t.status === "failed");
    const allSkipped = tests.length > 0 && tests.every((t) => t.status !== "passed" && t.status !== "failed");
    const fr: VitestFileResult = { file, status: fileFailed ? "failed" : allSkipped ? "skipped" : "passed", tests };
    const message = tf.message ? stripAnsi(tf.message).trim() : "";
    if (message) {
      fr.message = message.slice(0, MAX_FAILURE_MESSAGE);
      failures.push(failure(file, firstLine(message), { code: "SUITE_FAILED" }));
    } else if (tf.status === "failed" && tests.length === 0) {
      failures.push(failure(file, "suíte falhou sem testes executados", { code: "SUITE_FAILED" }));
    }
    if (typeof tf.startTime === "number" && typeof tf.endTime === "number") fr.durationMs = Math.round(tf.endTime - tf.startTime);
    files.push(fr);
  }
  return {
    success: json.success ?? failures.length === 0,
    counts: {
      files: files.length,
      failedFiles: files.filter((f) => f.status === "failed").length,
      tests: json.numTotalTests ?? passed + failed + skipped + todo,
      passed: json.numPassedTests ?? passed,
      failed: json.numFailedTests ?? failed,
      skipped: (json.numPendingTests ?? skipped),
      todo: json.numTodoTests ?? todo,
    },
    files,
    failures,
  };
}

/** Saída de texto do vitest (reporter padrão): `FAIL  arquivo > suíte > teste`. */
export function parseVitestText(text: string, root?: string): GateFailure[] {
  const out: GateFailure[] = [];
  for (const raw of lines(text)) {
    const m = /^\s*FAIL\s+(\S+\.(?:test|spec)\.[cm]?[jt]sx?)(?:\s+>\s+(.*))?$/.exec(raw);
    if (!m) continue;
    out.push(failure(relativizePath(m[1]!, root), m[2] ? m[2].trim() : "arquivo de teste falhou", { code: "TEST_FAILED" }));
  }
  return dedupeFailures(out);
}

/* ============================================================================
 * arch:check (check-boundaries / check-dependencies)
 * ========================================================================== */

/**
 * Depois de `[ERRO] Violações …`:
 *   `[BND001] src/a.ts:12:3` + linhas indentadas (tipo, destino, mensagem)
 *   `[DEP002] plugin.id | src/plugins/x/index.ts` + mensagem/detalhes
 * e `[ERRO] Etapa NN não concluída.` + erro.
 */
export function parseArch(text: string, root?: string): GateFailure[] {
  const out: GateFailure[] = [];
  let inViolations = false;
  let current: { f: GateFailure; extra: string[] } | null = null;
  let stageError: { label: string; lines: string[] } | null = null;
  const flush = (): void => {
    if (current) {
      const msg = current.extra.filter((l) => !/^detalhes:/.test(l));
      const main = msg.length > 0 ? msg[msg.length - 1]! : current.f.message;
      const context = msg.slice(0, -1).join("; ");
      current.f.message = context ? `${main} (${context})` : main;
      out.push(current.f);
      current = null;
    }
  };
  for (const raw of lines(text)) {
    const l = raw.trimEnd();
    if (stageError) {
      if (l.trim() === "" && stageError.lines.length > 0) {
        out.push(failure("scripts/architecture", `${stageError.label}: ${stageError.lines[0]}`, { code: "ARCH_ERROR" }));
        stageError = null;
      } else if (l.trim() !== "") stageError.lines.push(l.trim());
      continue;
    }
    const stage = /^\[ERRO\] (Etapa \d+ não concluída\.)/.exec(l);
    if (stage) {
      flush();
      stageError = { label: stage[1]!, lines: [] };
      continue;
    }
    if (/^\[ERRO\] Violações/.test(l)) {
      inViolations = true;
      continue;
    }
    if (!inViolations) continue;
    if (/^\[OK\]/.test(l) || /^={5,}/.test(l)) {
      flush();
      inViolations = false;
      continue;
    }
    const bnd = /^\[([A-Z]+\d+[A-Z0-9_]*)\] (.+?):(\d+):(\d+)$/.exec(l);
    if (bnd) {
      flush();
      current = { f: failure(relativizePath(bnd[2]!, root), "", { line: int(bnd[3]), column: int(bnd[4]), code: bnd[1] }), extra: [] };
      continue;
    }
    const dep = /^\[([A-Z]+\d+[A-Z0-9_]*)\] (.+?) \| (.+)$/.exec(l);
    if (dep) {
      flush();
      current = { f: failure(relativizePath(dep[3]!, root), `plugin ${dep[2]}`, { code: dep[1] }), extra: [] };
      if (dep[2] !== "<grafo>") current.extra.push(`plugin ${dep[2]}`);
      continue;
    }
    if (current && /^\s+\S/.test(l)) {
      current.extra.push(l.trim());
      continue;
    }
    if (l.trim() === "") continue;
    flush();
  }
  flush();
  if (stageError && stageError.lines.length > 0) out.push(failure("scripts/architecture", `${stageError.label}: ${stageError.lines[0]}`, { code: "ARCH_ERROR" }));
  return out;
}

/* ============================================================================
 * Auditorias Layer-1 (stage71..90)
 * ========================================================================== */

const NOT_A_CODE = new Set(["OK", "INFO", "ERRO", "FAIL", "ALLOW", "SUCESSO", "AVISO", "WARN", "PASS"]);
const CODE_RE = /^[A-Z][A-Z0-9_]*$/;

/**
 * Formatos de texto das auditorias:
 *   `[FAIL] CODE scope: message`            (85, 84)
 *   `- [NET008] path: message`              (82, 83)
 *   `[DOC_REF_MISSING] scope — message`     (71–81, 86–89)
 *   `[FAIL] check.id — detalhe`             (checks semânticos 86–89)
 * Linhas-resumo (`[FAIL] Violações …: N`, `[FAIL] Violations: N`) são ignoradas.
 */
export function parseLayer1Audit(text: string, root?: string): GateFailure[] {
  const out: GateFailure[] = [];
  for (const raw of lines(text)) {
    const l = raw.trim();
    if (l === "") continue;
    let m = /^- \[([A-Z][A-Z0-9_]*)\] (.+?): (.+)$/.exec(l);
    if (m) {
      out.push(failure(splitLocation(m[2]!, root).file, m[3]!, { ...splitLocation(m[2]!, root), code: m[1] }));
      continue;
    }
    if (/^\[FAIL\] (Violações|Violations)\b[^:]*: \d+$/.test(l)) continue;
    m = /^\[FAIL\] ([A-Z][A-Z0-9_]*) (\S+): (.+)$/.exec(l);
    if (m) {
      out.push(failure(splitLocation(m[2]!, root).file, m[3]!, { ...splitLocation(m[2]!, root), code: m[1] }));
      continue;
    }
    m = /^\[FAIL\] ([\w.-]+)(?: — (.*))?$/.exec(l);
    if (m) {
      const detail = m[2] ?? "";
      const looksPath = /^[\w./-]+\.\w+(:\d+)?$/.test(detail);
      const loc = looksPath ? splitLocation(detail, root) : { file: "" };
      out.push(failure(loc.file || "(auditoria)", looksPath ? `verificação ${m[1]} falhou` : detail || `verificação ${m[1]} falhou`, { ...loc, code: m[1] }));
      continue;
    }
    m = /^\[([A-Z][A-Z0-9_]*)\] (.+?) — (.+)$/.exec(l);
    if (m && CODE_RE.test(m[1]!) && !NOT_A_CODE.has(m[1]!)) {
      const loc = splitLocation(m[2]!, root);
      out.push(failure(loc.file, m[3]!, { ...loc, code: m[1] }));
    }
  }
  return out;
}

interface AuditJsonViolation {
  code?: string;
  rule?: string;
  scope?: string;
  path?: string;
  file?: string;
  line?: number;
  column?: number;
  message?: string;
}

/** `--json` das auditorias (71–85): `{ ok, violations: [{ code, scope|path|file, message }] }`. */
export function normalizeAuditJson(json: unknown, root?: string): { ok: boolean; failures: GateFailure[] } {
  const obj = (json ?? {}) as { ok?: unknown; violations?: unknown };
  const list = Array.isArray(obj.violations) ? (obj.violations as AuditJsonViolation[]) : [];
  const failures = list.map((v) => {
    const scope = v.scope ?? v.path ?? v.file ?? "";
    const loc = splitLocation(String(scope), root);
    return failure(loc.file || "(auditoria)", String(v.message ?? JSON.stringify(v)), {
      line: typeof v.line === "number" ? v.line : loc.line,
      column: typeof v.column === "number" ? v.column : loc.column,
      code: v.code ?? v.rule,
    });
  });
  return { ok: obj.ok === true && failures.length === 0, failures };
}

/* ============================================================================
 * agents.mjs (freeze-invariants + freeze-lock + arch)
 * ========================================================================== */

export function parseAgents(text: string, root?: string): GateFailure[] {
  const out: GateFailure[] = [];
  let inInvariants = false;
  for (const raw of lines(text)) {
    const l = raw.trimEnd();
    let m = /\[VIOLAÇÃO DETECTADA\] O arquivo congelado '(.+?)' foi alterado!/.exec(l);
    if (m) {
      out.push(failure(relativizePath(m[1]!, root), "arquivo congelado foi alterado (freeze-lock)", { code: "FREEZE_CHANGED" }));
      continue;
    }
    m = /\[ERRO DE CONGELAMENTO\] (.+?): (.+)$/.exec(l);
    if (m) {
      out.push(failure(relativizePath(m[2]!, root), m[1]!, { code: "FREEZE_DRIFT" }));
      continue;
    }
    m = /\[ALERTA\] (.+?): (.+)$/.exec(l);
    if (m) {
      out.push(failure(relativizePath(m[2]!, root), m[1]!, { code: "FREEZE_MISSING" }));
      continue;
    }
    if (/\[FALHA NAS INVARIANTES\]/.test(l)) {
      inInvariants = true;
      continue;
    }
    if (inInvariants) {
      const v = /^\s+- (.+)$/.exec(l);
      if (v) {
        const msg = v[1]!.trim();
        const p = /((?:src|tests|scripts|docs|src-tauri)\/[\w./-]+)/.exec(msg);
        out.push(failure(p ? relativizePath(p[1]!, root) : "(invariantes)", msg, { code: "INVARIANT" }));
        continue;
      }
      if (l.trim() !== "") inInvariants = false;
    }
    m = /^\[ERRO\] (Argumento.*|--lock.*)$/.exec(l);
    if (m) out.push(failure("agents.mjs", m[1]!, { code: "AGENTS_ARGS" }));
  }
  return [...out, ...parseArch(text, root)];
}

/* ============================================================================
 * cargo (check / test)
 * ========================================================================== */

/**
 * `error[E0425]: msg` seguido de ` --> src/lib.rs:10:5` (relativo a `src-tauri/`),
 * `error: msg` sem local, falhas de `cargo test` (`test x ... FAILED` +
 * `thread 'x' panicked at src/a.rs:1:2:`).
 */
export function parseCargo(text: string, options: { root?: string; crateDir?: string } = {}): GateFailure[] {
  const crate = (options.crateDir ?? "src-tauri").replace(/\\/g, "/").replace(/\/+$/, "");
  const fixPath = (p: string): string => {
    const rel = relativizePath(p, options.root);
    if (path.isAbsolute(rel) || rel.startsWith(`${crate}/`) || crate === "") return rel;
    return `${crate}/${rel}`;
  };
  const out: GateFailure[] = [];
  const panics = new Map<string, { file: string; line?: number; column?: number; message: string }>();
  const failedTests: string[] = [];
  let pending: { code?: string; message: string } | null = null;
  const all = lines(text);
  for (let i = 0; i < all.length; i++) {
    const l = all[i]!;
    const err = /^error(?:\[(E\d{4})\])?: (.+)$/.exec(l);
    if (err) {
      if (pending) out.push(failure(crate || "Cargo.toml", pending.message, { code: pending.code }));
      const message = err[2]!;
      if (/^(could not compile|aborting due to|test failed, to rerun|\d+ target(s)? failed)/.test(message)) {
        pending = null;
        continue;
      }
      pending = { message, ...(err[1] ? { code: err[1] } : {}) };
      continue;
    }
    const loc = /^\s*--> (.+?):(\d+):(\d+)$/.exec(l);
    if (loc && pending) {
      out.push(failure(fixPath(loc[1]!), pending.message, { line: int(loc[2]), column: int(loc[3]), code: pending.code }));
      pending = null;
      continue;
    }
    if (/^warning(\[|:)/.test(l) && pending) {
      out.push(failure(crate || "Cargo.toml", pending.message, { code: pending.code }));
      pending = null;
      continue;
    }
    const t = /^test (\S+) \.\.\. FAILED$/.exec(l);
    if (t) {
      failedTests.push(t[1]!);
      continue;
    }
    const p = /^thread '([^']+)' panicked at (.+?):(\d+):(\d+):?\s*(.*)$/.exec(l);
    if (p) {
      const msg = p[5] && p[5].trim() !== "" ? p[5].trim() : (all[i + 1] ?? "").trim();
      panics.set(p[1]!, { file: fixPath(p[2]!), line: Number(p[3]), column: Number(p[4]), message: msg || "panic" });
    }
  }
  if (pending) out.push(failure(crate || "Cargo.toml", pending.message, { code: pending.code }));
  for (const name of failedTests) {
    const pan = panics.get(name);
    if (pan) out.push(failure(pan.file, `teste ${name} falhou: ${pan.message}`, { line: pan.line, column: pan.column, code: "TEST_FAILED" }));
    else out.push(failure(crate || "Cargo.toml", `teste ${name} falhou`, { code: "TEST_FAILED" }));
  }
  return out;
}

/* ============================================================================
 * git diff --check
 * ========================================================================== */

/** `arquivo:linha: trailing whitespace.` (+ linha `+conteúdo`). */
export function parseDiffCheck(text: string, root?: string): GateFailure[] {
  const out: GateFailure[] = [];
  for (const raw of lines(text)) {
    const m = /^(.+?):(\d+): (.+?)\.?$/.exec(raw);
    if (!m || raw.startsWith("+") || raw.startsWith("-")) continue;
    out.push(failure(relativizePath(m[1]!, root), m[3]!, { line: int(m[2]), code: "WHITESPACE" }));
  }
  return out;
}

/* ============================================================================
 * Genérico (build, stage90, isolamento)
 * ========================================================================== */

/** Linhas de erro soltas: `Error: …`, `[ERRO] …`, `error during build:` (+ próxima linha). */
export function parseGenericErrors(text: string, label: string, root?: string): GateFailure[] {
  const out: GateFailure[] = [];
  const all = lines(text);
  for (let i = 0; i < all.length; i++) {
    const l = all[i]!.trim();
    let m = /^(?:Uncaught )?(?:[A-Z]\w*)?Error: (.+)$/.exec(l);
    if (m && !/^\s*at /.test(l)) {
      out.push(failure(label, m[1]!, { code: "ERROR" }));
      continue;
    }
    m = /^\[ERRO\] (.+)$/.exec(l);
    if (m && !/^Violações/.test(m[1]!) && !/^Etapa \d+ não concluída/.test(m[1]!)) {
      out.push(failure(label, m[1]!, { code: "ERROR" }));
      continue;
    }
    if (/^error during build:/.test(l)) {
      const next = (all[i + 1] ?? "").trim();
      const loc = /^(.+?\.\w+):(\d+):(\d+)/.exec(next);
      if (loc) out.push(failure(relativizePath(loc[1]!, root), next, { line: int(loc[2]), column: int(loc[3]), code: "BUILD" }));
      else out.push(failure(label, next || "vite build falhou", { code: "BUILD" }));
    }
    m = /^(.+?) falhou \(exit (\d+)\)$/.exec(l);
    if (m) out.push(failure(label, `${m[1]} falhou (exit ${m[2]})`, { code: "STEP_FAILED" }));
  }
  return out;
}

/** Saídas compostas (isolamento, stage90, build): junta todos os parsers. */
export function parseComposite(text: string, label: string, root?: string): GateFailure[] {
  return dedupeFailures([
    ...parseTsc(text, root),
    ...parseArch(text, root),
    ...parseLayer1Audit(text, root),
    ...parseVitestText(text, root),
    ...parseGenericErrors(text, label, root),
  ]);
}
