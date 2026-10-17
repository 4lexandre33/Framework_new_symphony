import type { ProjectSelection } from "../project";
import { PROJECT_URL_PARAM } from "../project";

/**
 * Seletor de projeto do host (G24). Mostrado quando `selectProject()` não
 * escolheu um jogo (vários projetos sem `VITE_PROJECT`, ou `?project=`
 * inexistente). Cada opção recarrega a página com `?project=<id>`; a engine
 * continua rodando sem projeto até lá.
 *
 * Só DOM do host (src/app); nenhuma dependência de engine/internal.
 */
export function describeProjectSelection(selection: ProjectSelection): string {
  if (selection.status === "selected") {
    return `Projeto ativo: ${selection.project.name} (${selection.project.id}, via ${selection.source}).`;
  }
  const ids = selection.available.map((p) => p.id).join(", ");
  switch (selection.reason) {
    case "explicit-none":
      return "Engine sem projeto (seleção \"none\").";
    case "no-projects":
      return "Nenhum projeto em src/projects: engine sem projeto.";
    case "unknown-url":
      return `Projeto "${selection.requested ?? ""}" (URL) não existe. Disponíveis: ${ids}. Escolha um projeto.`;
    case "ambiguous":
      return `Vários projetos (${ids}) e VITE_PROJECT não definido: engine sem projeto. Escolha um projeto ou fixe VITE_PROJECT=<id> no build.`;
  }
}

export interface ProjectPickerHandle {
  readonly element: HTMLElement;
  dispose(): void;
}

export function mountProjectPicker(
  selection: ProjectSelection,
  doc: Document = document,
): ProjectPickerHandle | null {
  if (selection.status === "selected") return null;
  if (selection.reason !== "ambiguous" && selection.reason !== "unknown-url") return null;
  if (doc.body === null) return null;

  const root = doc.createElement("div");
  root.setAttribute("data-project-picker", "");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Escolher projeto");
  root.style.cssText =
    "position:fixed;inset:auto 16px 16px auto;max-width:min(420px,calc(100vw - 32px));z-index:2147483646;" +
    "background:#111c;color:#fff;font:14px/1.4 system-ui,sans-serif;padding:12px 14px;border-radius:8px;" +
    "box-shadow:0 4px 16px #0008;pointer-events:auto";

  const message = doc.createElement("p");
  message.style.margin = "0 0 8px";
  message.textContent = describeProjectSelection(selection);
  root.appendChild(message);

  const list = doc.createElement("div");
  list.style.cssText = "display:flex;flex-wrap:wrap;gap:6px";
  for (const project of selection.available) {
    const link = doc.createElement("a");
    const url = new URL(doc.location?.href ?? "http://localhost/");
    url.searchParams.set(PROJECT_URL_PARAM, project.id);
    link.href = url.toString();
    link.textContent = project.name;
    link.title = project.id;
    link.setAttribute("data-project-id", project.id);
    link.style.cssText =
      "color:#fff;background:#2a5bd7;padding:4px 10px;border-radius:4px;text-decoration:none";
    list.appendChild(link);
  }
  root.appendChild(list);
  doc.body.appendChild(root);

  return {
    element: root,
    dispose(): void {
      root.remove();
    },
  };
}
