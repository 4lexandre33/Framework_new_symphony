// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error — biblioteca .mjs sem declaração de tipos
import { auditLayer1Documentation } from "../scripts/architecture/lib/layer1-documentation-v1.mjs";

interface Violation {
  readonly code: string;
  readonly scope: string;
  readonly message: string;
}
interface AuditResult {
  readonly ok: boolean;
  readonly stage: number;
  readonly checks: ReadonlyArray<{ id: string; ok: boolean }>;
  readonly violations: ReadonlyArray<Violation>;
}

const audit = auditLayer1Documentation as (o: { projectRoot: string }) => Promise<AuditResult>;
const REAL_ROOT = path.resolve(__dirname, "..");
const temps: string[] = [];

const SINGLE_FILES = [
  "README.md",
  "package.json",
  "ETAPA88_AUTOMATED_PASS.json",
  "ETAPA89_MANIFEST.json",
  "ETAPA89_LAYER1_DOCUMENTATION.txt",
  "LAYER1_DOCUMENTATION_BASELINE_V1.json",
  "scripts/architecture/module-map.mjs",
  "src-tauri/tauri.conf.json",
  "src-tauri/steam_appid.txt",
  "src-tauri/src/lib.rs",
];

function copyInto(target: string, relative: string): void {
  const from = path.join(REAL_ROOT, ...relative.split("/"));
  const to = path.join(target, ...relative.split("/"));
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

/** Cria uma raiz mínima, mas completa para a auditoria, contendo cópias dos arquivos reais. */
function makeRoot(): string {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "layer1-doc-"));
  temps.push(target);
  for (const file of SINGLE_FILES) copyInto(target, file);
  for (const file of fs.readdirSync(REAL_ROOT)) {
    if (/^ETAPA(?:7\d|8\d)_.*\.txt$/u.test(file) && !file.endsWith("SHA256SUMS.txt")) copyInto(target, file);
  }
  for (const file of fs.readdirSync(path.join(REAL_ROOT, "docs", "layer1"))) copyInto(target, `docs/layer1/${file}`);
  stubReferencedPaths(target);
  return target;
}

/** Cria stubs vazios para os caminhos reais citados na documentação, sem copiar o repositório inteiro. */
function stubReferencedPaths(target: string): void {
  const docs = ["README.md", ...fs.readdirSync(path.join(target, "docs", "layer1")).map((f) => `docs/layer1/${f}`)];
  for (const doc of docs) {
    const text = fs.readFileSync(path.join(target, ...doc.split("/")), "utf8").replace(/```[\s\S]*?```/gu, "");
    for (const match of text.matchAll(/`([^`\n]+)`/gu)) {
      const token = match[1].trim().replace(/^\//u, "").replace(/\/$/u, "");
      if (/[<>*{}\s]/u.test(token)) continue;
      const real = path.join(REAL_ROOT, ...token.split("/"));
      const stub = path.join(target, ...token.split("/"));
      if (!fs.existsSync(real) || fs.existsSync(stub)) continue;
      if (fs.statSync(real).isDirectory()) fs.mkdirSync(stub, { recursive: true });
      else {
        fs.mkdirSync(path.dirname(stub), { recursive: true });
        fs.writeFileSync(stub, "");
      }
    }
  }
}

function mutate(root: string, relative: string, fn: (text: string) => string): void {
  const full = path.join(root, ...relative.split("/"));
  fs.writeFileSync(full, fn(fs.readFileSync(full, "utf8")), "utf8");
}

afterAll(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

describe("Stage 89 — auditoria da documentação (repositório real)", () => {
  it("passa sem violações e confirma 23 módulos e 37 comandos", async () => {
    const result = await audit({ projectRoot: REAL_ROOT });
    expect(result.stage).toBe(89);
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
    const baseline = JSON.parse(
      fs.readFileSync(path.join(REAL_ROOT, "LAYER1_DOCUMENTATION_BASELINE_V1.json"), "utf8"),
    ) as { moduleCount: number; tauriCommandCount: number; layer1FinalGate: string };
    expect(baseline.moduleCount).toBe(23);
    expect(baseline.tauriCommandCount).toBe(37);
    expect(baseline.layer1FinalGate).toBe("pending-stage-90");
  });
});

describe("Stage 89 — a auditoria detecta documentação errada", () => {
  it("raiz mínima sem mutação passa (controle)", async () => {
    const root = makeRoot();
    const result = await audit({ projectRoot: root });
    expect(result.violations).toEqual([]);
  });

  const cases: ReadonlyArray<{
    name: string;
    code: string;
    file: string;
    change: (text: string) => string;
  }> = [
    {
      name: "caminho citado que não existe",
      code: "DOC_REF_MISSING",
      file: "docs/layer1/README.md",
      change: (t) => `${t}\nVeja \`docs/nao-existe.md\`.\n`,
    },
    {
      name: "script npm inexistente",
      code: "DOC_NPM_SCRIPT_MISSING",
      file: "docs/layer1/validation-evidence.md",
      change: (t) => `${t}\nRode \`npm run script-inexistente\`.\n`,
    },
    {
      name: "contagem de comandos Tauri errada",
      code: "DOC_TAURI_COMMAND_COUNT",
      file: "docs/layer1/native-tauri-steam.md",
      change: (t) => t.replace(/\*\*37\*\*/u, "**36**"),
    },
    {
      name: "afirmação obsoleta no README",
      code: "DOC_STALE_CLAIM",
      file: "README.md",
      change: (t) => `${t}\nO estado vai até a Etapa 25.\n`,
    },
    {
      name: "LAYER 1 PASS declarado antes da Stage 90",
      code: "DOC_PREMATURE_PASS",
      file: "docs/layer1/README.md",
      change: (t) => `${t}\nLAYER 1 PASS\n`,
    },
    {
      name: "contagem de módulos errada",
      code: "DOC_MODULE_COUNT",
      file: "docs/layer1/README.md",
      change: (t) => t.replace(/\*\*23 módulos\*\*/u, "**22 módulos**"),
    },
    {
      name: "link relativo quebrado",
      code: "DOC_LINK_BROKEN",
      file: "docs/layer1/README.md",
      change: (t) => `${t}\n[quebrado](./nao-existe.md)\n`,
    },
  ];

  for (const item of cases) {
    it(`reprova: ${item.name}`, async () => {
      const root = makeRoot();
      mutate(root, item.file, item.change);
      const result = await audit({ projectRoot: root });
      expect(result.ok).toBe(false);
      expect(result.violations.map((v) => v.code)).toContain(item.code);
    });
  }
});
