// @vitest-environment node
/**
 * e2e do runtime (SPEC §5.3) — só com ENGINE_MCP_E2E=1 e o jogo de exemplo.
 *
 *   ENGINE_MCP_E2E=1 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npx vitest run tests/mcp/e2e
 *
 * runtime_launch physics-sandbox (headless) → kernel_inspect → loop
 * pause/step → world_spawn → world_entities → screenshot (PNG) →
 * scene_load_live (inline, 2 entidades) → runtime_stop (processos somem).
 * WebGL roda por software (SwiftShader); sem GPU o fps é baixo, mas o canvas
 * é desenhado.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestClient, HAS_SAMPLE_GAME, waitFor, type TestClient } from "../harness.ts";

const E2E = process.env.ENGINE_MCP_E2E === "1";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** true se algum processo do grupo `pgid` ainda existe. */
function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** pids cujo cmdline contém `marker` (Linux; vazio em outros SOs). */
function pidsWithMarker(marker: string): number[] {
  if (!existsSync("/proc")) return [];
  const out: number[] = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      if (readFileSync(`/proc/${entry}/cmdline`, "utf8").includes(marker)) out.push(Number(entry));
    } catch {
      /* processo sumiu */
    }
  }
  return out;
}

describe.skipIf(!E2E || !HAS_SAMPLE_GAME)("runtime e2e: physics-sandbox headless", () => {
  let t: TestClient;

  beforeAll(async () => {
    if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync("/opt/pw-browsers")) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = "/opt/pw-browsers";
    }
    t = await createTestClient({ config: { bridgePort: 0 } });
  });

  afterAll(async () => {
    await t?.close();
  });

  it("launch → inspect → loop → spawn → entities → screenshot → scene → stop", { timeout: 240_000 }, async () => {
    const launch = await t.callTool("runtime_launch", { id: "physics-sandbox", headless: true, width: 800, height: 600, timeoutMs: 120_000 });
    expect(launch).toMatchObject({ headless: true, sessionId: expect.stringMatching(/^physics-sandbox-\d+$/) });
    expect(launch.vitePort).toBeGreaterThan(0);
    expect(launch.bridgePort).toBeGreaterThan(0);
    expect(launch.url).not.toMatch(/devtoken=[A-Za-z0-9_-]{16}/);
    const { sessionId, launchId, vitePid } = launch as { sessionId: string; launchId: string; vitePid: number };
    expect(vitePid).toBeGreaterThan(0);
    expect(pidsWithMarker(`--engine-mcp-launch=${launchId}`).length).toBeGreaterThan(0);

    try {
      const status = await t.callTool("runtime_status");
      expect(status.sessions).toEqual([expect.objectContaining({ sessionId, project: "physics-sandbox", launched: true })]);
      expect(status.launches).toEqual([expect.objectContaining({ launchId, project: "physics-sandbox", viteAlive: true })]);

      // O KernelStatus pronto da engine é "running" (não existe "ready").
      const kernel = await t.callTool("kernel_inspect", { sessionId });
      expect(kernel.status).toBe("running");
      expect(kernel.plugins.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining(["debug.devbridge"]));

      expect((await t.callTool("loop_control", { action: "pause" })).stats.isPaused).toBe(true);
      const step = await t.callTool("loop_control", { action: "step", ticks: 5 });
      expect(step.ticksRun).toBe(5);

      const spawn = await t.callTool("world_spawn", { entityId: "e2e-caixa", type: "e2e", position: { x: 0, y: 2, z: 0 }, tags: ["e2e"] });
      expect(spawn).toMatchObject({ spawned: true, entity: { entityId: "e2e-caixa" } });
      const listed = await t.callTool("world_entities", { tag: "e2e" });
      expect(listed.entities.map((e: { entityId: string }) => e.entityId)).toContain("e2e-caixa");

      await t.callTool("loop_control", { action: "resume" });
      const raw = await t.callToolRaw("screenshot", { sessionId, maxWidth: 640 });
      expect(raw.isError).toBeFalsy();
      const image = raw.content.find((c) => c.type === "image") as { data: string; mimeType: string } | undefined;
      expect(image?.mimeType).toBe("image/png");
      const png = Buffer.from(image!.data, "base64");
      expect(png.length).toBeGreaterThan(100);
      expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
      expect(raw.structuredContent).toMatchObject({ width: 640, bytes: png.length });

      const scene = await t.callTool("scene_load_live", {
        id: "physics-sandbox",
        scene: {
          format: "engine.scene",
          version: 1,
          sceneId: "e2e-cena",
          sceneName: "Cena e2e",
          entities: [
            { id: "e2e-a", type: "e2e-scene", position: { x: -2, y: 1, z: 0 }, tags: ["e2e-scene"] },
            { id: "e2e-b", type: "e2e-scene", position: { x: 2, y: 1, z: 0 }, tags: ["e2e-scene"], data: { cor: "azul" } },
          ],
        },
      });
      expect(scene).toMatchObject({ loaded: true, sceneId: "e2e-cena", sessionId });
      const fromScene = await t.callTool("world_entities", { type: "e2e-scene" });
      expect(fromScene.entities.map((e: { entityId: string }) => e.entityId).sort()).toEqual(["e2e-a", "e2e-b"]);

      const logs = await t.callTool("logs_tail", { level: "error" });
      expect(Array.isArray(logs.logs)).toBe(true);
    } finally {
      const stop = await t.callTool("runtime_stop", { sessionId });
      expect(stop).toMatchObject({ launched: true, closedBrowser: true, killedVite: true });
    }

    await waitFor(() => !groupAlive(vitePid), 10_000, "grupo do vite encerrado");
    await waitFor(() => pidsWithMarker(`--engine-mcp-launch=${launchId}`).length === 0, 10_000, "Chromium encerrado");
    const after = await t.callTool("runtime_status", { refresh: false });
    expect(after.sessions).toEqual([]);
    expect(after.launches).toEqual([]);
    await expect(t.callTool("kernel_inspect")).rejects.toMatchObject({ code: "NO_RUNTIME" });
  });
});
