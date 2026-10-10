/**
 * Sanitização mínima e sem dependências para HTML vindo de jogo/rede
 * (G11). Remove elementos executáveis/embutidos, atributos `on*`, `style`
 * com `url(`/`expression(` e URLs `javascript:`/`vbscript:`/`data:` (exceto
 * `data:image/` em `src`). Para texto puro use `escapeHtml` ou `contentText`.
 */

const BLOCKED_ELEMENTS = new Set([
  "script",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "link",
  "meta",
  "base",
  "style",
  "template",
  "noscript",
  "form",
  "animate",
  "set",
  "animatemotion",
  "animatetransform",
  "foreignobject",
  "use",
]);

const URL_ATTRIBUTES = new Set([
  "href",
  "src",
  "xlink:href",
  "action",
  "formaction",
  "poster",
  "background",
  "srcset",
  "ping",
]);

const UNSAFE_URL = /^\s*(?:javascript|vbscript|data)\s*:/iu;
const SAFE_DATA_IMAGE = /^\s*data:image\/(?:png|gif|jpe?g|webp|avif);/iu;

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "`": "&#96;",
};

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"'`]/gu, (char: string): string => ESCAPES[char] ?? char);
}

function sanitizeNode(node: ParentNode): void {
  const children = Array.from(node.children);

  for (const child of children) {
    const tag = child.tagName.toLowerCase();

    if (BLOCKED_ELEMENTS.has(tag) || tag.includes(":")) {
      child.remove();
      continue;
    }

    for (const attribute of Array.from(child.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;

      if (name.startsWith("on") || name === "srcdoc" || name === "formaction") {
        child.removeAttribute(attribute.name);
        continue;
      }

      if (name === "style" && /(?:url\s*\(|expression\s*\(|javascript:)/iu.test(value)) {
        child.removeAttribute(attribute.name);
        continue;
      }

      if (URL_ATTRIBUTES.has(name) && UNSAFE_URL.test(value)) {
        if (!(name === "src" && SAFE_DATA_IMAGE.test(value))) {
          child.removeAttribute(attribute.name);
        }
      }
    }

    sanitizeNode(child);
  }
}

/** Devolve um fragmento sanitizado (requer DOM). */
export function sanitizeHtmlToFragment(html: string, doc: Document): DocumentFragment {
  // O conteúdo de <template> vive num documento inerte: nada carrega nem
  // executa enquanto sanitizamos. Só depois os nós são adotados.
  const template = doc.createElement("template");
  template.innerHTML = html;
  sanitizeNode(template.content);
  return doc.importNode(template.content, true);
}

/** Sanitiza e serializa de volta para string (requer DOM). */
export function sanitizeHtml(html: string, doc: Document): string {
  const wrapper = doc.createElement("div");
  wrapper.appendChild(sanitizeHtmlToFragment(html, doc));
  return wrapper.innerHTML;
}
