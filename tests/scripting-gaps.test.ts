import { describe, expect, it } from "vitest";

import type { PluginContext } from "@core";
import type { DialogueTreeDescriptor, QuestDescriptor } from "../src/contracts/scripting/types";
import { ScriptingService } from "../src/engine/scripting/internal/ScriptingService";
import type { WorldApi } from "../src/tokens/world";
import type { CameraApi } from "../src/tokens/camera";
import type { AudioApi } from "../src/tokens/audio";
import type { AnimationApi } from "../src/tokens/anim";
import type { VfxApi } from "../src/tokens/vfx";

interface Emitted {
  type: string;
  payload: any;
}

interface Calls {
  list: string[];
}

function setup(): {
  service: ScriptingService;
  emitted: Emitted[];
  calls: Calls;
  entities: Map<string, { entityId: string; position: { x: number; y: number; z: number }; tags: string[] }>;
} {
  const emitted: Emitted[] = [];
  const calls: Calls = { list: [] };
  const ctx = {
    events: {
      emit: (type: string, payload: unknown): void => {
        emitted.push({ type, payload });
      },
    },
  } as unknown as PluginContext;
  const entities = new Map<string, { entityId: string; position: { x: number; y: number; z: number }; tags: string[] }>();
  let soundHandle = 0;
  const world = {
    getEntityState: (id: string) => entities.get(id) ?? null,
    getAllEntities: () => Array.from(entities.values()),
  } as unknown as WorldApi;
  const camera = {
    setActiveCamera: (id: string, blend?: number) => { calls.list.push(`camera.setActive:${id}:${String(blend)}`); return true; },
    addTrauma: (amount: number) => { calls.list.push(`camera.trauma:${amount}`); },
  } as unknown as CameraApi;
  const audio = {
    playSound: (url: string, channel?: string, _v?: number, loop?: boolean) => { soundHandle += 1; calls.list.push(`audio.play:${url}:${String(channel)}:${String(loop ?? false)}`); return soundHandle; },
    stopSound: (handle: number) => { calls.list.push(`audio.stop:${handle}`); return true; },
    crossfadeMusic: async () => undefined,
    stopMusic: async () => undefined,
  } as unknown as AudioApi;
  const anim = {
    playAnimation: (entity: string, state: string) => { calls.list.push(`anim.play:${entity}:${state}`); return true; },
    setParam: () => undefined,
  } as unknown as AnimationApi;
  const vfx = {
    triggerVFXPresetById: (id: string, options?: { position?: unknown }) => { calls.list.push(`vfx.preset:${id}:${options?.position ? "pos" : "nopos"}`); return { presetId: id, emitterId: null, decalId: null }; },
    pulseBloom: () => undefined,
    stopParticleEmitter: () => true,
  } as unknown as VfxApi;
  const service = new ScriptingService(ctx);
  service.bindDependencies({ world, camera, audio, anim, vfx });
  return { service, emitted, calls, entities };
}

function of(emitted: Emitted[], type: string): any[] {
  return emitted.filter((e) => e.type === `game.scripting.${type}`).map((e) => e.payload);
}

const guardTree: DialogueTreeDescriptor = {
  treeId: "guard",
  startNodeId: "ask",
  nodes: [
    {
      nodeId: "ask",
      speakerName: "Guarda",
      text: "Senha?",
      audioClipUrl: "vo/ask.ogg",
      animationState: "Talk",
      speakerEntityId: "guard_1",
      choices: [
        { choiceIndex: 0, text: "VIP", nextNodeId: "ok", conditionVariable: "hasPass", requiredValue: true },
        { choiceIndex: 1, text: "Nada", nextNodeId: "no" },
      ],
    },
    { nodeId: "ok", speakerName: "Guarda", text: "Passe." },
    { nodeId: "no", speakerName: "Guarda", text: "Fora." },
  ],
};

const herbQuest: QuestDescriptor = {
  questId: "herbs",
  title: "Ervas",
  description: "",
  rewardXp: 50,
  rewardItems: ["potion"],
  steps: [
    { stepId: "a", description: "", targetCount: 2, currentCount: 0, isCompleted: false, targetEntityId: "herb" },
    { stepId: "b", description: "", targetCount: 3, currentCount: 0, isCompleted: false },
  ],
};

describe("scripting gaps (G10, G123–G129)", () => {
  it("G10: keyframes executam via capabilities e emitem evento por keyframe", () => {
    const { service, emitted, calls } = setup();
    service.registerDialogueTree(guardTree);
    service.registerCutscene({
      cutsceneId: "intro",
      durationSeconds: 2,
      tracks: [
        { trackId: "cam", trackType: "camera", keyframes: [{ timeSeconds: 0, actionType: "set-active", targetId: "cineCam", payload: { blendDurationSeconds: 0.5 } }] },
        { trackId: "sfx", trackType: "audio", keyframes: [{ timeSeconds: 0.5, actionType: "play", targetId: "boom.ogg", payload: { loop: true } }] },
        { trackId: "anim", trackType: "animation", keyframes: [{ timeSeconds: 0.5, actionType: "play", targetId: "hero", payload: { state: "Wave" } }] },
        { trackId: "fx", trackType: "vfx", keyframes: [{ timeSeconds: 1, actionType: "preset", targetId: "smoke", payload: { position: { x: 1, y: 0, z: 0 } } }] },
        { trackId: "talk", trackType: "dialogue", keyframes: [{ timeSeconds: 1.5, actionType: "start", targetId: "guard", payload: {} }] },
        { trackId: "ev", trackType: "event", keyframes: [{ timeSeconds: 1.5, actionType: "open-door", targetId: "door", payload: { fast: true } }] },
      ],
    });
    expect(service.playCutscene("intro")).toBe(true);
    for (let i = 0; i < 25; i += 1) service.update(0.1);
    expect(calls.list).toContain("camera.setActive:cineCam:0.5");
    expect(calls.list).toContain("audio.play:boom.ogg:sfx:true");
    expect(calls.list).toContain("anim.play:hero:Wave");
    expect(calls.list).toContain("vfx.preset:smoke:pos");
    expect(service.getCurrentDialogueNode()?.nodeId).toBe("ask");
    const keyframes = of(emitted, "cutscene-keyframe");
    expect(keyframes).toHaveLength(6);
    expect(keyframes.find((k) => k.actionType === "open-door")).toMatchObject({ cutsceneId: "intro", trackType: "event", handled: false, payload: { fast: true } });
    expect(keyframes.find((k) => k.trackType === "camera")?.handled).toBe(true);
    // Loop iniciado pela cutscene parou no fim.
    expect(calls.list).toContain("audio.stop:1");
    expect(of(emitted, "cutscene-finished")).toEqual([{ cutsceneId: "intro", reason: "completed", elapsedSeconds: 2 }]);
  });

  it("G10/G125: zonas verificadas sozinhas para entidades do mundo com targetTags; manual continua", () => {
    const { service, emitted, entities } = setup();
    entities.set("hero", { entityId: "hero", position: { x: 10, y: 0, z: 0 }, tags: ["player"] });
    entities.set("rat", { entityId: "rat", position: { x: 10, y: 0, z: 0 }, tags: ["critter"] });
    service.registerTriggerZone({ zoneId: "gate", shape: "sphere", position: { x: 0, y: 0, z: 0 }, dimensions: { x: 0, y: 0, z: 0 }, radius: 2, triggerOnce: false, targetTags: ["player"] });
    service.update(0.016);
    expect(of(emitted, "trigger-entered")).toHaveLength(0);
    entities.set("hero", { entityId: "hero", position: { x: 1, y: 0, z: 0 }, tags: ["player"] });
    entities.set("rat", { entityId: "rat", position: { x: 1, y: 0, z: 0 }, tags: ["critter"] });
    service.update(0.016);
    expect(of(emitted, "trigger-entered")).toEqual([{ zoneId: "gate", entityId: "hero", position: { x: 1, y: 0, z: 0 } }]);
    // Manual: rat sem tag que case não dispara; com tag passada dispara.
    service.checkEntityInZones("rat", { x: 0, y: 0, z: 0 });
    expect(of(emitted, "trigger-entered")).toHaveLength(1);
    service.checkEntityInZones("rat", { x: 0, y: 0, z: 0 }, { tags: ["player"] });
    expect(of(emitted, "trigger-entered")).toHaveLength(2);
    // Entidade nova no mundo (spawn) também é rastreada.
    entities.set("hero2", { entityId: "hero2", position: { x: 0, y: 0, z: 0 }, tags: ["player"] });
    service.handleWorldEntitySpawned("hero2");
    service.update(0.016);
    expect(of(emitted, "trigger-entered").map((p) => p.entityId)).toContain("hero2");
    // Despawn: some do mundo -> exited (entity-removed).
    entities.delete("hero");
    service.update(0.016);
    expect(of(emitted, "trigger-exited")).toContainEqual({ zoneId: "gate", entityId: "hero", reason: "entity-removed" });
  });

  it("G123: variáveis públicas liberam escolhas", () => {
    const { service } = setup();
    service.registerDialogueTree(guardTree);
    service.startDialogue("guard");
    expect(service.getAvailableChoices().map((c) => c.choiceIndex)).toEqual([1]);
    expect(service.advanceDialogue(0)?.nodeId).toBe("ask"); // bloqueada: fica
    service.setVariable("hasPass", true);
    expect(service.getVariable("hasPass")).toBe(true);
    expect(service.getAvailableChoices().map((c) => c.choiceIndex)).toEqual([0, 1]);
    expect(service.advanceDialogue(0)?.nodeId).toBe("ok");
  });

  it("G124: escolhas/árvore validadas, dialogue-ended, fila e substituição explícita", () => {
    const { service, emitted } = setup();
    expect(service.registerDialogueTree({ treeId: "bad", startNodeId: "x", nodes: [{ nodeId: "a", speakerName: "", text: "", defaultNextNodeId: "zz" }] })).toBe(false);
    expect(service.validateDialogueTree({ treeId: "bad", startNodeId: "x", nodes: [{ nodeId: "a", speakerName: "", text: "" }] })).toEqual(["startNodeId inexistente: x"]);
    expect(service.registerDialogueTree(guardTree)).toBe(true);
    service.registerDialogueTree({ treeId: "bye", startNodeId: "b", nodes: [{ nodeId: "b", speakerName: "", text: "tchau" }] });

    service.startDialogue("guard");
    expect(service.advanceDialogue(99)?.nodeId).toBe("ask"); // índice inexistente: fica
    expect(service.advanceDialogue()?.nodeId).toBe("ask"); // sem índice e sem default: fica
    expect(service.startDialogue("nao-existe")).toBeNull();
    expect(service.getCurrentDialogueNode()?.nodeId).toBe("ask"); // ativo preservado
    expect(service.startDialogue("bye", undefined, { ifActive: "reject" })).toBeNull();
    expect(service.startDialogue("bye", undefined, { ifActive: "queue" })).toBeNull();
    expect(service.advanceDialogue(1)?.nodeId).toBe("no");
    // fim do guard -> dialogue-ended + começa o "bye" da fila
    expect(service.advanceDialogue()?.nodeId).toBe("b");
    expect(of(emitted, "dialogue-ended")).toEqual([{ treeId: "guard", lastNodeId: "no", reason: "completed" }]);
    // replace explícito (padrão) emite "replaced"
    service.startDialogue("guard");
    expect(of(emitted, "dialogue-ended")[1]).toEqual({ treeId: "bye", lastNodeId: "b", reason: "replaced" });
    expect(service.stopDialogue()).toBe(true);
    expect(of(emitted, "dialogue-ended")[2]).toMatchObject({ treeId: "guard", reason: "stopped" });
    expect(service.isDialogueActive()).toBe(false);
  });

  it("G125: fala/animação do nó, alvo e recompensas da quest", () => {
    const { service, emitted, calls } = setup();
    service.registerDialogueTree(guardTree);
    service.startDialogue("guard");
    expect(calls.list).toContain("audio.play:vo/ask.ogg:voice:false");
    expect(calls.list).toContain("anim.play:guard_1:Talk");
    service.setVariable("hasPass", true);
    service.advanceDialogue(0);
    expect(calls.list).toContain("audio.stop:1"); // fala anterior interrompida

    service.registerQuest(herbQuest);
    service.startQuest("herbs");
    expect(service.reportQuestTarget("rock")).toEqual([]);
    expect(service.reportQuestTarget("herb", 2)[0]?.currentStepIndex).toBe(1);
    service.advanceQuestProgress("herbs", 3);
    expect(of(emitted, "quest-completed")).toEqual([
      expect.objectContaining({ questId: "herbs", rewardXp: 50, rewardItems: ["potion"] }),
    ]);
  });

  it("G126: start idempotente, restart explícito, register sem apagar, fail/complete, sobra de progresso", () => {
    const { service, emitted } = setup();
    service.registerQuest(herbQuest);
    expect(service.startQuest("herbs")).toBe(true);
    service.advanceQuestProgress("herbs", 1);
    expect(service.startQuest("herbs")).toBe(false);
    expect(service.getQuestState("herbs")?.steps[0]?.currentCount).toBe(1);
    expect(service.registerQuest({ ...herbQuest, title: "Ervas 2" })).toBe(true);
    expect(service.getQuestState("herbs")?.steps[0]?.currentCount).toBe(1);

    // sobra: 1 + 3 -> etapa a (2) completa, 2 vão para a etapa b
    const state = service.advanceQuestProgress("herbs", 3);
    expect(state?.steps.map((s) => s.currentCount)).toEqual([2, 2]);
    expect(state?.currentStepIndex).toBe(1);

    expect(service.failQuest("herbs", "npc morreu")?.status).toBe("failed");
    expect(of(emitted, "quest-failed")).toEqual([expect.objectContaining({ questId: "herbs", reason: "npc morreu" })]);
    expect(service.startQuest("herbs")).toBe(false);
    expect(service.restartQuest("herbs")).toBe(true);
    expect(service.getQuestState("herbs")?.status).toBe("active");
    expect(service.completeQuest("herbs")?.status).toBe("completed");
    expect(of(emitted, "quest-completed")).toHaveLength(1);
    expect(service.startQuest("herbs")).toBe(false); // concluída não reinicia (sem recompensa dupla)
    expect(of(emitted, "quest-completed")).toHaveLength(1);
    expect(service.registerQuest(herbQuest, { resetState: true })).toBe(true);
    expect(service.getQuestState("herbs")).toBeNull();
  });

  it("G127: triggerOnce por entidade, exited ao remover zona/entidade e no re-registro", () => {
    const { service, emitted } = setup();
    const zone = { zoneId: "z", shape: "box" as const, position: { x: 0, y: 0, z: 0 }, dimensions: { x: 2, y: 2, z: 2 }, triggerOnce: true };
    service.registerTriggerZone(zone);
    service.checkEntityInZones("a", { x: 0, y: 0, z: 0 });
    service.checkEntityInZones("b", { x: 0, y: 0, z: 0 });
    expect(of(emitted, "trigger-entered").map((p) => p.entityId)).toEqual(["a", "b"]);
    service.checkEntityInZones("a", { x: 5, y: 0, z: 0 }, { sweep: false });
    expect(of(emitted, "trigger-exited")).toEqual([{ zoneId: "z", entityId: "a", reason: "left" }]);
    service.checkEntityInZones("a", { x: 0, y: 0, z: 0 }, { sweep: false });
    expect(of(emitted, "trigger-entered")).toHaveLength(2); // "a" já disparou uma vez

    service.removeEntityFromZones("b");
    expect(of(emitted, "trigger-exited")[1]).toEqual({ zoneId: "z", entityId: "b", reason: "entity-removed" });

    service.registerTriggerZone({ ...zone, zoneId: "y", triggerOnce: false });
    service.checkEntityInZones("c", { x: 0, y: 0, z: 0 });
    service.registerTriggerZone({ ...zone, zoneId: "y", triggerOnce: false }); // re-registro
    expect(of(emitted, "trigger-exited")).toContainEqual({ zoneId: "y", entityId: "c", reason: "zone-removed" });
    service.checkEntityInZones("c", { x: 0, y: 0, z: 0 });
    expect(service.unregisterTriggerZone("y")).toBe(true);
    expect(of(emitted, "trigger-exited").filter((p) => p.zoneId === "y")).toHaveLength(2);
  });

  it("G128: pausa/retomada, finished vs stopped/skipped/replaced, tempo decorrido", () => {
    const { service, emitted } = setup();
    service.registerCutscene({ cutsceneId: "a", durationSeconds: 2, tracks: [{ trackId: "e", trackType: "event", keyframes: [{ timeSeconds: 1.5, actionType: "x", targetId: "t", payload: {} }] }] });
    service.registerCutscene({ cutsceneId: "b", durationSeconds: 1, tracks: [] });
    service.playCutscene("a");
    service.update(0.5);
    expect(service.pauseCutscene()).toBe(true);
    service.update(1);
    expect(service.getCutsceneElapsedSeconds()).toBeCloseTo(0.5, 6);
    expect(service.isCutscenePaused()).toBe(true);
    expect(service.resumeCutscene()).toBe(true);
    service.update(0.5);
    expect(service.getCutsceneElapsedSeconds()).toBeCloseTo(1, 6);
    expect(of(emitted, "cutscene-paused").map((p) => p.paused)).toEqual([true, false]);

    service.playCutscene("b"); // troca: a termina como "replaced"
    expect(of(emitted, "cutscene-finished")[0]).toEqual({ cutsceneId: "a", reason: "replaced", elapsedSeconds: 1 });
    service.stopCutscene();
    expect(of(emitted, "cutscene-finished")[1]).toMatchObject({ cutsceneId: "b", reason: "stopped" });

    service.playCutscene("a");
    expect(service.skipCutscene({ runRemainingKeyframes: true })).toBe(true);
    expect(of(emitted, "cutscene-finished")[2]).toEqual({ cutsceneId: "a", reason: "skipped", elapsedSeconds: 2 });
    expect(of(emitted, "cutscene-keyframe")).toHaveLength(1);
  });

  it("G129: dimensões por forma, rotação, varredura de entidade rápida, clear seguro, comandos sem payload", () => {
    const { service, emitted } = setup();
    // cylinder: radius/height explícitos
    service.registerTriggerZone({ zoneId: "cyl", shape: "cylinder", position: { x: 0, y: 0, z: 0 }, dimensions: { x: 0, y: 0, z: 0 }, radius: 1, height: 4, triggerOnce: false });
    service.checkEntityInZones("p", { x: 0.9, y: 1.9, z: 0 });
    expect(of(emitted, "trigger-entered")).toHaveLength(1);

    // box girada 45° em Y: (1.2, 0, 1.2) está dentro da caixa 4x2x0.4 girada? não; (1.2,0,-1.2) sim
    const s = Math.sin(Math.PI / 8);
    const c = Math.cos(Math.PI / 8);
    service.registerTriggerZone({ zoneId: "rot", shape: "box", position: { x: 0, y: 0, z: 0 }, dimensions: { x: 4, y: 2, z: 0.4 }, rotation: { x: 0, y: s, z: 0, w: c }, triggerOnce: false });
    service.checkEntityInZones("q", { x: 1.2, y: 0, z: 1.2 });
    expect(of(emitted, "trigger-entered").filter((p) => p.zoneId === "rot")).toHaveLength(0);
    service.checkEntityInZones("r", { x: 1.2, y: 0, z: -1.2 });
    expect(of(emitted, "trigger-entered").filter((p) => p.zoneId === "rot")).toHaveLength(1);

    // varredura: atravessa uma esfera de raio 0,5 num único passo
    service.registerTriggerZone({ zoneId: "thin", shape: "sphere", position: { x: 50, y: 0, z: 0 }, dimensions: { x: 0, y: 0, z: 0 }, radius: 0.5, triggerOnce: false });
    service.checkEntityInZones("bullet", { x: 40, y: 0, z: 0 });
    service.checkEntityInZones("bullet", { x: 60, y: 0, z: 0 });
    expect(of(emitted, "trigger-entered").filter((p) => p.zoneId === "thin")).toHaveLength(1);
    expect(of(emitted, "trigger-exited").filter((p) => p.zoneId === "thin")).toEqual([{ zoneId: "thin", entityId: "bullet", reason: "left" }]);
    // teleporte (sweep:false) não dispara
    service.checkEntityInZones("bullet", { x: 40, y: 0, z: 0 }, { sweep: false });
    expect(of(emitted, "trigger-entered").filter((p) => p.zoneId === "thin")).toHaveLength(1);

    // clear seguro: emite exited de quem estava dentro
    service.clearTriggerZones();
    expect(of(emitted, "trigger-exited")).toContainEqual({ zoneId: "cyl", entityId: "p", reason: "zone-removed" });

    // posição inválida não lança
    expect(() => service.checkEntityInZones("x", undefined as never)).not.toThrow();
    expect(service.registerTriggerZone({ zoneId: "", shape: "box", position: { x: 0, y: 0, z: 0 }, dimensions: { x: 1, y: 1, z: 1 }, triggerOnce: false })).toBe(false);
  });

  it("G129: comandos do plugin toleram payload ausente", async () => {
    const { createScriptingPlugin } = await import("../src/plugins/scripting/plugin");
    const handlers = new Map<string, (env: { payload: unknown }) => unknown>();
    const ctx = {
      caps: { provide: () => undefined, get: () => undefined },
      events: { define: () => undefined, on: () => () => undefined, emit: () => undefined },
      commands: {
        define: () => undefined,
        handle: (type: string, fn: (env: { payload: unknown }) => unknown) => {
          handlers.set(type, fn);
          return () => undefined;
        },
      },
      lifecycle: { onDispose: () => undefined, ready: () => undefined },
    } as unknown as PluginContext;
    createScriptingPlugin().setup(ctx);
    expect(handlers.get("game.scripting.play-cutscene")?.({ payload: undefined })).toBe(false);
    expect(handlers.get("game.scripting.advance-dialogue")?.({ payload: undefined })).toBeNull();
    expect(handlers.get("game.scripting.start-quest")?.({ payload: null })).toBe(false);
  });
});
