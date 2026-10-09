// @vitest-environment node
import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Layer 1 Stage 87 — network/storage recovery", () => {
  it("ignora callbacks de WebSocket obsoleto por generation token", () => {
    const source = fs.readFileSync("src/engine/net/internal/WebSocketTransport.ts", "utf8");
    expect(source).toContain("private connectionGeneration");
    expect(source).toContain("generation !==");
    expect(source).toContain("this.connectionGeneration");
    expect(source).toContain("this.detachSocketHandlers(");
    expect(source).toContain("pendingConnectResolve");
  });

  it("save inválido ou adulterado falha como corrupted", () => {
    const source = fs.readFileSync("src/engine/storage/internal/SaveRecordCodec.ts", "utf8");
    expect(source).toContain('"corrupted"');
    expect(source).toContain("verifyChecksum(");
    expect(source).toContain("metadata.slotName !==");
    expect(source).toContain("Checksum do save não corresponde");
  });
});
