/**
 * `runtime_launch`: sobe o Vite (porta livre) com `VITE_PROJECT=<id>` e um
 * Chromium (Playwright, opcional) apontado para o bridge; espera o DevBridge
 * do jogo conectar. `stop()` fecha navegador e mata o grupo do Vite.
 *
 * Playwright: `playwright` (ou `playwright-core`) resolvido a partir da raiz
 * do repo e depois de `/opt/npm-tools`. Sem ele → PLAYWRIGHT_MISSING.
 * `PLAYWRIGHT_BROWSERS_PATH` é respeitado (o próprio Playwright o lê).
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import type { ToolContext } from "../core/context.ts";
import { McpToolError } from "../core/errors.ts";
import { TailBuffer, type RunningProcess } from "../core/exec.ts";
import type { BridgeServer, BridgeSession } from "./bridge-server.ts";

/* ============================================================================
 * Playwright (tipagem mínima, carregado sob demanda)
 * ========================================================================== */

export interface PwConsoleMessage {
  type(): string;
  text(): string;
}

export interface PwPage {
  goto(url: string, options?: { waitUntil?: "load" | "domcontentloaded" | "commit"; timeout?: number }): Promise<unknown>;
  on(event: "console", fn: (message: PwConsoleMessage) => void): unknown;
  on(event: "pageerror", fn: (error: Error) => void): unknown;
  on(event: "crash" | "close", fn: () => void): unknown;
}

export interface PwContext {
  newPage(): Promise<PwPage>;
}

export interface PwBrowser {
  newContext(options?: { viewport?: { width: number; height: number }; deviceScaleFactor?: number }): Promise<PwContext>;
  close(): Promise<void>;
  isConnected(): boolean;
  version(): string;
}

export interface PwBrowserType {
  launch(options?: { headless?: boolean; args?: string[]; timeout?: number; executablePath?: string }): Promise<PwBrowser>;
  executablePath(): string;
}

export interface PlaywrightModule {
  readonly chromium: PwBrowserType;
}

export interface LoadedPlaywright {
  readonly module: PlaywrightModule;
  /** Caminho resolvido do pacote. */
  readonly from: string;
}

/** Pastas extras padrão: `/opt/npm-tools` e as entradas de `NODE_PATH`. */
export function defaultPlaywrightDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const fromNodePath = (env.NODE_PATH ?? "").split(path.delimiter).filter((p) => p.trim() !== "");
  return ["/opt/npm-tools", ...fromNodePath];
}

function nodeModulesOf(dir: string): string {
  return path.basename(dir) === "node_modules" ? dir : path.join(dir, "node_modules");
}

/**
 * Procura `playwright`/`playwright-core` em `<root>/node_modules` e depois em
 * cada pasta extra (`<pasta>/node_modules` ou a própria, se já for
 * `node_modules`). Busca explícita: não sobe diretórios nem usa NODE_PATH
 * implicitamente (assim a lista é previsível e testável).
 */
export function loadPlaywright(root: string, extraDirs: readonly string[] = defaultPlaywrightDirs()): LoadedPlaywright | null {
  const roots = [nodeModulesOf(root), ...extraDirs.map(nodeModulesOf)];
  for (const nm of roots) {
    for (const name of ["playwright", "playwright-core"]) {
      const pkgDir = path.join(nm, name);
      if (!existsSync(path.join(pkgDir, "package.json"))) continue;
      try {
        const require = createRequire(path.join(nm, "noop.js"));
        const mod = require(pkgDir) as Partial<PlaywrightModule>;
        if (mod && typeof mod.chromium?.launch === "function") return { module: mod as PlaywrightModule, from: pkgDir };
      } catch {
        /* pacote quebrado: tenta o próximo */
      }
    }
  }
  return null;
}

/** Args do Chromium para WebGL por software (sem GPU / headless). */
export const CHROMIUM_ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

/* ============================================================================
 * Utilidades
 * ========================================================================== */

/** Porta TCP livre em 127.0.0.1 (o SO escolhe). */
export function findFreePort(host = "127.0.0.1"): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", reject);
    srv.listen(0, host, () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Linhas recentes (console do navegador). */
export class LineRing {
  private readonly lines: string[] = [];
  constructor(private readonly limit = 200) {}
  push(line: string): void {
    this.lines.push(line.length > 2000 ? `${line.slice(0, 2000)}…` : line);
    if (this.lines.length > this.limit) this.lines.splice(0, this.lines.length - this.limit);
  }
  tail(n = 50): string[] {
    return this.lines.slice(-n);
  }
}

/* ============================================================================
 * Lançamento
 * ========================================================================== */

export interface LaunchOptions {
  readonly id: string;
  readonly headless: boolean;
  readonly width: number;
  readonly height: number;
  readonly bootTimeoutMs: number;
  readonly signal?: AbortSignal;
  readonly playwrightDirs?: readonly string[];
  readonly progress?: (step: number, message: string) => void;
}

export interface LaunchInfo {
  readonly launchId: string;
  readonly project: string;
  readonly url: string;
  readonly vitePort: number;
  readonly vitePid: number | null;
  readonly bridgePort: number;
  readonly headless: boolean;
  readonly startedAt: string;
  /** Sessão inicial (o DevBridge pode reconectar com outro id). */
  readonly sessionId: string;
  readonly browserVersion: string | null;
}

export class LaunchedRuntime {
  private stopping: Promise<{ closedBrowser: boolean; killedVite: boolean }> | null = null;
  viteExited = false;

  constructor(
    readonly info: LaunchInfo,
    readonly token: string,
    private readonly vite: RunningProcess,
    private readonly browser: PwBrowser | null,
    readonly consoleLines: LineRing,
    private readonly bridge: BridgeServer,
  ) {
    void vite.exited.then(() => {
      this.viteExited = true;
    });
  }

  get stopped(): boolean {
    return this.stopping !== null;
  }

  /** Fecha navegador, mata o Vite (grupo) e as sessões deste lançamento. */
  stop(): Promise<{ closedBrowser: boolean; killedVite: boolean }> {
    this.stopping ??= (async () => {
      // Revoga antes: o DevBridge não consegue reconectar no meio da parada.
      this.bridge.revokeToken(this.token);
      let closedBrowser = false;
      if (this.browser) {
        try {
          await Promise.race([this.browser.close(), sleep(10_000)]);
          closedBrowser = true;
        } catch {
          closedBrowser = !this.browser.isConnected();
        }
      }
      for (const s of this.bridge.list()) {
        if (s.launchId === this.info.launchId) this.bridge.closeSession(s.sessionId, "runtime_stop");
      }
      const wasAlive = !this.viteExited;
      await this.vite.kill();
      return { closedBrowser, killedVite: wasAlive };
    })();
    return this.stopping;
  }
}

function bootError(code: string, message: string, hint: string, details: Record<string, unknown>): McpToolError {
  return new McpToolError(code, message, hint, details);
}

async function waitHttpReady(url: string, deadline: number, vite: { exited: boolean }, signal?: AbortSignal): Promise<boolean> {
  while (Date.now() < deadline) {
    if (signal?.aborted || vite.exited) return false;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      await res.body?.cancel().catch(() => undefined);
      if (res.status < 500) return true;
    } catch {
      /* ainda subindo */
    }
    await sleep(150);
  }
  return false;
}

let launchCounter = 0;

/**
 * Sobe Vite + Chromium e espera a sessão do DevBridge. Em qualquer falha,
 * desfaz o que já subiu antes de lançar o erro.
 */
export async function launchRuntime(ctx: ToolContext, bridge: BridgeServer, options: LaunchOptions): Promise<{ launch: LaunchedRuntime; session: BridgeSession }> {
  const { id } = options;
  const projectIndex = ctx.paths.resolve(`src/projects/${id}/index.ts`);
  if (!existsSync(projectIndex)) {
    throw new McpToolError("NOT_FOUND", `jogo ${id} não existe (src/projects/${id}/index.ts)`, "Use project_list para ver os jogos.");
  }
  const pw = loadPlaywright(ctx.root, options.playwrightDirs);
  if (pw === null) {
    throw new McpToolError(
      "PLAYWRIGHT_MISSING",
      "Playwright não está instalado (procurei em node_modules do repo e em /opt/npm-tools)",
      "Instale com `npm i -D playwright` + `npx playwright install chromium`, ou use runtime_connect_info e abra o jogo no seu navegador / tauri dev.",
    );
  }

  const listen = await bridge.start();
  launchCounter += 1;
  const launchId = `launch-${launchCounter}-${Date.now().toString(36)}`;
  const token = bridge.issueToken(launchId);
  const deadline = Date.now() + options.bootTimeoutMs;
  const viteOut = new TailBuffer(32 * 1024);
  const consoleLines = new LineRing();
  let vite: RunningProcess | null = null;
  let browser: PwBrowser | null = null;
  const viteState = { exited: false };

  const cleanup = async (): Promise<void> => {
    bridge.revokeToken(token);
    if (browser) await Promise.race([browser.close().catch(() => undefined), sleep(10_000)]);
    if (vite) await vite.kill();
  };

  try {
    // 1) Vite numa porta livre (tenta de novo se outra pessoa pegou a porta).
    let vitePort = 0;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      vitePort = await findFreePort();
      viteState.exited = false;
      options.progress?.(1, `subindo vite na porta ${vitePort}`);
      vite = ctx.exec.spawnAllowed("npx", ["vite", "--port", String(vitePort), "--strictPort", "--host", "127.0.0.1"], {
        timeoutMs: 0,
        env: {
          VITE_PROJECT: id,
          VITE_DEVBRIDGE_URL: undefined,
          VITE_DEVBRIDGE_TOKEN: undefined,
          BROWSER: "none",
        },
        onStdout: (c) => viteOut.push(c),
        onStderr: (c) => viteOut.push(c),
        // Sem `signal`: o Vite sobrevive à chamada; cancelamento cai no cleanup.
      });
      const proc = vite;
      void proc.exited.then(() => {
        if (vite === proc) viteState.exited = true;
      });
      if (await waitHttpReady(`http://127.0.0.1:${vitePort}/`, deadline, viteState, options.signal)) break;
      if (options.signal?.aborted) throw new McpToolError("TIMEOUT", "runtime_launch cancelado pelo cliente");
      if (!viteState.exited || Date.now() >= deadline) {
        throw bootError("TIMEOUT", `vite não respondeu em http://127.0.0.1:${vitePort}/ dentro de ${options.bootTimeoutMs} ms`, "Veja details.viteOutput.", {
          viteOutput: viteOut.toString().slice(-4000),
        });
      }
      const output = viteOut.toString();
      if (attempt === 2 || !/already in use|EADDRINUSE/i.test(output)) {
        throw bootError("COMMAND_FAILED", "vite terminou antes de ficar pronto", "Veja details.viteOutput (rode `npx vite` à mão para depurar).", {
          viteOutput: output.slice(-4000),
        });
      }
    }

    // 2) Chromium.
    const url =
      `http://127.0.0.1:${vitePort}/?project=${encodeURIComponent(id)}` +
      `&devbridge=${encodeURIComponent(listen.url)}&devtoken=${encodeURIComponent(token)}`;
    options.progress?.(2, "abrindo Chromium");
    try {
      browser = await pw.module.chromium.launch({
        headless: options.headless,
        args: [...CHROMIUM_ARGS, `--engine-mcp-launch=${launchId}`],
        timeout: Math.max(5000, deadline - Date.now()),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const missingBrowser = /Executable doesn't exist|browserType\.launch: .*not found|playwright install/i.test(message);
      throw bootError(
        missingBrowser ? "PLAYWRIGHT_MISSING" : "COMMAND_FAILED",
        `falha ao abrir o Chromium: ${message.split("\n")[0]}`,
        missingBrowser
          ? "Rode `npx playwright install chromium` ou defina PLAYWRIGHT_BROWSERS_PATH; alternativa: runtime_connect_info."
          : "Em ambiente sem display use headless: true.",
        { playwright: pw.from, message: message.slice(0, 4000) },
      );
    }
    const context = await browser.newContext({ viewport: { width: options.width, height: options.height } });
    const page = await context.newPage();
    page.on("console", (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
    page.on("pageerror", (e) => consoleLines.push(`[pageerror] ${e.message}`));
    page.on("crash", () => consoleLines.push("[crash] a página travou (crash)"));

    // 3) Espera a sessão do DevBridge com o token deste lançamento.
    const sessionWait = bridge.waitForSession((s) => s.launchId === launchId, Math.max(1, deadline - Date.now()), options.signal);
    options.progress?.(3, `carregando ${url.split("&devtoken=")[0]}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: Math.max(1000, deadline - Date.now()) }).catch((error: unknown) => {
      consoleLines.push(`[goto] ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    });
    const session = await sessionWait;
    if (session === null) {
      if (options.signal?.aborted) throw new McpToolError("TIMEOUT", "runtime_launch cancelado pelo cliente");
      throw bootError(
        "TIMEOUT",
        `o jogo ${id} não conectou no DevBridge em ${options.bootTimeoutMs} ms`,
        "Veja details.console (erros do jogo) e details.viteOutput. O jogo precisa rodar em DEV e chamar setupDevBridge (src/app/bootstrap.ts).",
        { console: consoleLines.tail(50), viteOutput: viteOut.toString().slice(-2000), url: url.replace(token, "<token>") },
      );
    }

    const info: LaunchInfo = {
      launchId,
      project: id,
      url: url.replace(token, "<token>"),
      vitePort,
      vitePid: vite?.pid ?? null,
      bridgePort: listen.port,
      headless: options.headless,
      startedAt: new Date().toISOString(),
      sessionId: session.sessionId,
      browserVersion: (() => {
        try {
          return browser?.version() ?? null;
        } catch {
          return null;
        }
      })(),
    };
    const launch = new LaunchedRuntime(info, token, vite!, browser, consoleLines, bridge);
    return { launch, session };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
