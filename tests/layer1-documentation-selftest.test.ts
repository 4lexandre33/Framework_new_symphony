// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");

function read(relative: string): string {
  return fs.readFileSync(path.join(ROOT, ...relative.split("/")), "utf8").replace(/\r\n/gu, "\n");
}

describe("Stage 89 — autoverificação do pacote", () => {
  const manifest = JSON.parse(read("ETAPA89_MANIFEST.json")) as {
    stage: number;
    files: string[];
    explicitlyDeferred: string[];
  };
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

  it("todos os arquivos do manifesto existem", () => {
    expect(manifest.stage).toBe(89);
    for (const file of manifest.files) {
      expect(fs.existsSync(path.join(ROOT, ...file.split("/"))), file).toBe(true);
    }
  });

  it("package.json expõe os scripts da stage", () => {
    expect(pkg.scripts["stage89:audit"]).toContain("stage89-audit-documentation.mjs");
    expect(pkg.scripts["stage89:validate"]).toContain("stage89-validate-documentation.mjs");
    expect(pkg.scripts["stage89:finalize"]).toContain("stage89-finalize-documentation.mjs");
  });

  it("o finalize reexecuta o validate antes de gravar evidências", () => {
    const finalize = read("scripts/architecture/stage89-finalize-documentation.mjs");
    expect(finalize).toContain("stage89-validate-documentation.mjs");
    expect(finalize.indexOf("stage89-validate-documentation.mjs")).toBeLessThan(
      finalize.indexOf("ETAPA89_AUTOMATED_PASS.json"),
    );
  });

  it("a documentação não declara LAYER 1 PASS e adia o gate à Stage 90", () => {
    expect(manifest.explicitlyDeferred.join(" ")).toContain("Stage 90");
    for (const file of ["README.md", ...fs.readdirSync(path.join(ROOT, "docs", "layer1")).map((f) => `docs/layer1/${f}`)]) {
      for (const line of read(file).split("\n")) {
        if (line.includes("LAYER 1 PASS")) expect(line.toLowerCase(), `${file}: ${line}`).toContain("não");
      }
    }
  });

  it("a stage não altera Rust nem configuração Tauri", () => {
    expect(manifest.files.some((f) => f.startsWith("src-tauri/"))).toBe(false);
  });
});
