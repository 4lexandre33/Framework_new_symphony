interface Ver { major: number; minor: number; patch: number; }

export function satisfies(version: string, range: string): boolean {
  const v = parse(version);
  if (!v) return false;
  const trimmed = range.trim();
  if (trimmed === "*" || trimmed === "") return true;

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length > 1) return parts.every((p) => satisfies(version, p));

  if (trimmed.startsWith("^")) return caret(v, parse(trimmed.slice(1)));
  if (trimmed.startsWith("~")) return tilde(v, parse(trimmed.slice(1)));
  if (trimmed.startsWith(">=")) return gte(v, parse(trimmed.slice(2)));
  if (trimmed.startsWith("<=")) return lte(v, parse(trimmed.slice(2)));
  if (trimmed.startsWith(">")) return gt(v, parse(trimmed.slice(1)));
  if (trimmed.startsWith("<")) return lt(v, parse(trimmed.slice(1)));
  if (trimmed.startsWith("=")) return eq(v, parse(trimmed.slice(1)));
  return eqWildcard(v, trimmed);
}

function parse(s: string): Ver | null {
  const m = /^(\d+)(?:\.(\d+|\*|x))?(?:\.(\d+|\*|x))?/.exec(s.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: m[2] === undefined || m[2] === "*" || m[2] === "x" ? -1 : Number(m[2]),
    patch: m[3] === undefined || m[3] === "*" || m[3] === "x" ? -1 : Number(m[3]),
  };
}

function compare(a: Ver, b: Ver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (b.minor === -1) return 0;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (b.patch === -1) return 0;
  return a.patch - b.patch;
}

function eq(a: Ver, b: Ver | null): boolean {
  if (!b) return false;
  if (a.major !== b.major) return false;
  if (b.minor === -1) return true;
  if (a.minor !== b.minor) return false;
  if (b.patch === -1) return true;
  return a.patch === b.patch;
}

function gt(a: Ver, b: Ver | null): boolean {
  if (!b) return false;
  const c = compare(a, b);
  if (c > 0) return true;
  if (c < 0) return false;
  // igual nos campos declarados: só é ">" se b tem wildcard no final
  if (b.minor === -1) return a.major > b.major;
  if (b.patch === -1) return a.minor > b.minor;
  return false;
}

function lt(a: Ver, b: Ver | null): boolean {
  if (!b) return false;
  const c = compare(a, b);
  if (c < 0) return true;
  if (c > 0) return false;
  // igual: só é "<" se b tem wildcard no final
  if (b.minor === -1) return false;
  if (b.patch === -1) return false;
  return false;
}

function gte(a: Ver, b: Ver | null): boolean {
  if (!b) return false;
  return eq(a, b) || gt(a, b);
}

function lte(a: Ver, b: Ver | null): boolean {
  if (!b) return false;
  return eq(a, b) || lt(a, b);
}

function caret(v: Ver, base: Ver | null): boolean {
  if (!base) return false;
  if (!gte(v, base)) return false;
  if (base.major > 0) return v.major === base.major;
  if (base.minor > 0) return v.major === 0 && v.minor === base.minor;
  return v.major === 0 && v.minor === 0 && v.patch === base.patch;
}

function tilde(v: Ver, base: Ver | null): boolean {
  if (!base) return false;
  if (!gte(v, base)) return false;
  return v.major === base.major && v.minor === base.minor;
}

function eqWildcard(v: Ver, range: string): boolean {
  const r = parse(range);
  if (!r) return false;
  if (r.minor === -1) return v.major === r.major;
  if (r.patch === -1) return v.major === r.major && v.minor === r.minor;
  return v.major === r.major && v.minor === r.minor && v.patch === r.patch;
}