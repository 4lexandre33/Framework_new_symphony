import { describe, expect, it } from "vitest";
import {
  STEAMWORKS_RUNTIME_FILES,
  auditLayer1Steamworks,
} from "../scripts/architecture/lib/layer1-steamworks-v1.mjs";

describe("Layer 1 Stage 84 — audit selftest", (): void => {
  it("não possui arquivos Stage84 duplicados", (): void => {
    expect(new Set(STEAMWORKS_RUNTIME_FILES).size).toBe(STEAMWORKS_RUNTIME_FILES.length);
  });

  it("audita o snapshot aplicado sem violações", async (): Promise<void> => {
    const result = await auditLayer1Steamworks({ projectRoot: process.cwd() });
    expect(result.violations).toEqual([]);
    expect(result.compatibility).toEqual({
      stage72: true,
      stage73: true,
      stage74: true,
      stage83: true,
    });
    expect(result.ok).toBe(true);
  });
});
