/**
 * DOM (jsdom) instalado à mão em ambiente `node`.
 *
 * Por que não `// @vitest-environment jsdom`: nesse modo o Vite transforma o
 * código para web e reescreve `new URL(rel, import.meta.url)` para
 * `http://localhost:3000/...`, quebrando `fileURLToPath` nos domínios do MCP.
 * Importado PRIMEIRO em tests/mcp/runtime.test.ts.
 */
import { createRequire } from "node:module";

interface JsdomModule {
  JSDOM: new (html: string, options?: { url?: string; pretendToBeVisual?: boolean }) => { window: Record<string, unknown> & Window };
}

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as JsdomModule;
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1/", pretendToBeVisual: true });
const win = dom.window;

const KEYS = [
  "window",
  "document",
  "location",
  "HTMLElement",
  "HTMLCanvasElement",
  "ErrorEvent",
  "KeyboardEvent",
  "MouseEvent",
  "WheelEvent",
  "FocusEvent",
  "PromiseRejectionEvent",
] as const;

for (const key of KEYS) {
  const value = key === "window" ? win : win[key];
  if (value === undefined) continue;
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}

export const jsdomWindow = win;
