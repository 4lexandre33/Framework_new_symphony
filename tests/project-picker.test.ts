// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mountProjectPicker, describeProjectSelection } from "../src/app/ProjectPicker";
import { resolveProjectSelection } from "../src/project";
import type { ProjectDefinition } from "../src/project-contract";

const fake = (id: string): ProjectDefinition => ({ id, name: `Jogo ${id}`, createPlugins: () => [] });

describe("G24 seletor de projeto do host", () => {
  it("ambíguo: mostra mensagem visível e um link ?project=<id> por projeto; dispose remove", () => {
    const sel = resolveProjectSelection([fake("a"), fake("b")], {});
    const handle = mountProjectPicker(sel, document);
    expect(handle).not.toBeNull();
    const root = document.querySelector("[data-project-picker]");
    expect(root?.textContent).toMatch(/VITE_PROJECT/);
    const links = [...document.querySelectorAll<HTMLAnchorElement>("[data-project-id]")];
    expect(links.map((l) => new URL(l.href).searchParams.get("project"))).toEqual(["a", "b"]);
    handle!.dispose();
    expect(document.querySelector("[data-project-picker]")).toBeNull();
  });

  it("selecionado ou none explícito: sem seletor", () => {
    expect(mountProjectPicker(resolveProjectSelection([fake("a")], {}), document)).toBeNull();
    expect(mountProjectPicker(resolveProjectSelection([fake("a"), fake("b")], { env: "none" }), document)).toBeNull();
    expect(describeProjectSelection(resolveProjectSelection([fake("a")], {}))).toMatch(/Projeto ativo/);
  });
});
