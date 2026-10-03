import { beforeEach, describe, expect, it } from "vitest";
import { CutsceneTimeline } from "../src/engine/scripting/CutsceneTimeline";
import { DialogueTreeParser } from "../src/engine/scripting/DialogueTreeParser";
import { QuestManager } from "../src/engine/scripting/QuestManager";
import { TriggerZoneManager } from "../src/engine/scripting/TriggerZoneManager";

describe("Camada de Cutscenes, Diálogos & Quests (game.scripting)", () => {
  let timeline: CutsceneTimeline;
  let dialogueParser: DialogueTreeParser;
  let questManager: QuestManager;
  let triggerManager: TriggerZoneManager;

  beforeEach(() => {
    timeline = new CutsceneTimeline();
    dialogueParser = new DialogueTreeParser();
    questManager = new QuestManager();
    triggerManager = new TriggerZoneManager();
  });

  describe("CutsceneTimeline", () => {
    it("deve registrar e iniciar uma cutscene corretamente", () => {
      timeline.registerCutscene({
        cutsceneId: "intro_boss",
        durationSeconds: 5,
        tracks: [],
      });

      expect(timeline.play("intro_boss")).toBe(true);
      expect(timeline.playing).toBe(true);
      expect(timeline.currentCutsceneId).toBe("intro_boss");
      expect(timeline.currentDurationSeconds).toBe(5);
    });

    it("deve retornar false ao tentar iniciar uma cutscene inexistente", () => {
      expect(timeline.play("cutscene_inexistente")).toBe(false);
      expect(timeline.playing).toBe(false);
      expect(timeline.currentCutsceneId).toBeNull();
    });

    it("deve pausar e parar uma cutscene em execução", () => {
      timeline.registerCutscene({
        cutsceneId: "cutscene_01",
        durationSeconds: 10,
        tracks: [],
      });

      timeline.play("cutscene_01");
      timeline.pause();
      expect(timeline.playing).toBe(false);

      timeline.stop();
      expect(timeline.currentCutsceneId).toBeNull();
    });

    it("deve disparar keyframes exatamente uma vez durante o progresso do tempo", () => {
      let firedCount = 0;
      let lastAction = "";

      timeline.registerCutscene({
        cutsceneId: "cinematic_event",
        durationSeconds: 3,
        tracks: [
          {
            trackId: "track_vfx",
            trackType: "vfx",
            keyframes: [
              {
                timeSeconds: 1,
                actionType: "spawn_explosion",
                targetId: "vfx_01",
                payload: { scale: 2 },
              },
              {
                timeSeconds: 2,
                actionType: "play_sound",
                targetId: "sfx_boom",
                payload: { volume: 1 },
              },
            ],
          },
        ],
      });

      timeline.play("cinematic_event");

      timeline.update(0.5, (action) => {
        firedCount += 1;
        lastAction = action;
      });
      expect(firedCount).toBe(0);

      timeline.update(0.6, (action) => {
        firedCount += 1;
        lastAction = action;
      });
      expect(firedCount).toBe(1);
      expect(lastAction).toBe("spawn_explosion");

      timeline.update(0.1, () => {
        firedCount += 1;
      });
      expect(firedCount).toBe(1);

      timeline.update(1, (action) => {
        firedCount += 1;
        lastAction = action;
      });
      expect(firedCount).toBe(2);
      expect(lastAction).toBe("play_sound");
    });

    it("deve disparar dois keyframes distintos mesmo com tempo e actionType iguais", () => {
      const targets: string[] = [];

      timeline.registerCutscene({
        cutsceneId: "simultaneous",
        durationSeconds: 2,
        tracks: [
          {
            trackId: "events",
            trackType: "event",
            keyframes: [
              {
                timeSeconds: 1,
                actionType: "activate",
                targetId: "door_a",
                payload: {},
              },
              {
                timeSeconds: 1,
                actionType: "activate",
                targetId: "door_b",
                payload: {},
              },
            ],
          },
        ],
      });

      timeline.play("simultaneous");
      timeline.update(1, (_action, targetId) => {
        targets.push(targetId);
      });

      expect(targets).toEqual(["door_a", "door_b"]);
    });

    it("deve finalizar automaticamente a cutscene ao atingir a duração total", () => {
      timeline.registerCutscene({
        cutsceneId: "short_cutscene",
        durationSeconds: 1,
        tracks: [],
      });

      timeline.play("short_cutscene");
      const finishedId = timeline.update(1.2, () => {});

      expect(finishedId).toBe("short_cutscene");
      expect(timeline.playing).toBe(false);
      expect(timeline.currentCutsceneId).toBeNull();
    });
  });

  describe("DialogueTreeParser", () => {
    it("deve iniciar o diálogo no nó inicial padrão", () => {
      dialogueParser.registerTree({
        treeId: "merchant_talk",
        startNodeId: "welcome_node",
        nodes: [
          {
            nodeId: "welcome_node",
            speakerName: "Comerciante",
            text: "Bem-vindo à loja!",
          },
        ],
      });

      const node = dialogueParser.startDialogue("merchant_talk");
      expect(node?.nodeId).toBe("welcome_node");
      expect(node?.speakerName).toBe("Comerciante");
      expect(dialogueParser.currentTreeId).toBe("merchant_talk");
    });

    it("deve avançar o diálogo via transição padrão (defaultNextNodeId)", () => {
      dialogueParser.registerTree({
        treeId: "story_intro",
        startNodeId: "part_1",
        nodes: [
          {
            nodeId: "part_1",
            speakerName: "Narrador",
            text: "Era uma vez...",
            defaultNextNodeId: "part_2",
          },
          {
            nodeId: "part_2",
            speakerName: "Narrador",
            text: "Em um reino distante.",
          },
        ],
      });

      dialogueParser.startDialogue("story_intro");
      expect(dialogueParser.advanceDialogue()?.nodeId).toBe("part_2");
      expect(dialogueParser.advanceDialogue()).toBeNull();
      expect(dialogueParser.getCurrentNode()).toBeNull();
      expect(dialogueParser.currentTreeId).toBeNull();
    });

    it("deve processar escolhas usando o choiceIndex declarado", () => {
      dialogueParser.registerTree({
        treeId: "guard_gate",
        startNodeId: "gate_check",
        nodes: [
          {
            nodeId: "gate_check",
            speakerName: "Guarda",
            text: "Identifique-se!",
            choices: [
              {
                choiceIndex: 10,
                text: "Tenho o passe VIP",
                nextNodeId: "pass_granted",
                conditionVariable: "hasVipPass",
                requiredValue: true,
              },
              {
                choiceIndex: 20,
                text: "Não tenho nada",
                nextNodeId: "denied",
              },
            ],
          },
          {
            nodeId: "pass_granted",
            speakerName: "Guarda",
            text: "Pode passar!",
          },
          {
            nodeId: "denied",
            speakerName: "Guarda",
            text: "Fora daqui!",
          },
        ],
      });

      dialogueParser.setVariable("hasVipPass", true);
      dialogueParser.startDialogue("guard_gate");

      const node = dialogueParser.advanceDialogue(10);
      expect(node?.nodeId).toBe("pass_granted");
      expect(node?.text).toBe("Pode passar!");
    });

    it("deve usar defaultNextNodeId quando nenhuma escolha for informada", () => {
      dialogueParser.registerTree({
        treeId: "default_choice",
        startNodeId: "question",
        nodes: [
          {
            nodeId: "question",
            speakerName: "NPC",
            text: "Escolha.",
            choices: [
              {
                choiceIndex: 0,
                text: "Opção",
                nextNodeId: "choice_node",
              },
            ],
            defaultNextNodeId: "default_node",
          },
          {
            nodeId: "choice_node",
            speakerName: "NPC",
            text: "Escolhida.",
          },
          {
            nodeId: "default_node",
            speakerName: "NPC",
            text: "Padrão.",
          },
        ],
      });

      dialogueParser.startDialogue("default_choice");
      expect(dialogueParser.advanceDialogue()?.nodeId).toBe("default_node");
    });
  });

  describe("QuestManager", () => {
    it("deve registrar e iniciar uma quest no estado active", () => {
      questManager.registerQuest({
        questId: "main_quest_1",
        title: "O Início da Jornada",
        description: "Encontre o ferreiro na vila",
        steps: [
          {
            stepId: "find_smith",
            description: "Falar com o Ferreiro",
            targetCount: 1,
            currentCount: 0,
            isCompleted: false,
          },
        ],
      });

      expect(questManager.startQuest("main_quest_1")).toBe(true);

      const state = questManager.getQuestState("main_quest_1");
      expect(state?.status).toBe("active");
      expect(state?.currentStepIndex).toBe(0);
    });

    it("deve avançar o progresso incremental das etapas da quest e concluir", () => {
      questManager.registerQuest({
        questId: "collect_herbs",
        title: "Ervas Medicinais",
        description: "Colete 3 ervas vermelhas",
        steps: [
          {
            stepId: "gather",
            description: "Ervas coletadas",
            targetCount: 3,
            currentCount: 0,
            isCompleted: false,
          },
        ],
      });

      questManager.startQuest("collect_herbs");

      let state = questManager.advanceQuestProgress("collect_herbs", 1);
      expect(state?.steps[0]?.currentCount).toBe(1);
      expect(state?.status).toBe("active");

      state = questManager.advanceQuestProgress("collect_herbs", 2);
      expect(state?.steps[0]?.currentCount).toBe(3);
      expect(state?.steps[0]?.isCompleted).toBe(true);
      expect(state?.status).toBe("completed");
    });

    it("deve avançar para a próxima etapa antes de concluir uma quest multi-step", () => {
      questManager.registerQuest({
        questId: "two_steps",
        title: "Duas etapas",
        description: "Quest sequencial",
        steps: [
          {
            stepId: "first",
            description: "Primeira",
            targetCount: 1,
            currentCount: 0,
            isCompleted: false,
          },
          {
            stepId: "second",
            description: "Segunda",
            targetCount: 2,
            currentCount: 0,
            isCompleted: false,
          },
        ],
      });

      questManager.startQuest("two_steps");

      let state = questManager.advanceQuestProgress("two_steps", 1);
      expect(state?.steps[0]?.isCompleted).toBe(true);
      expect(state?.currentStepIndex).toBe(1);
      expect(state?.status).toBe("active");

      state = questManager.advanceQuestProgress("two_steps", 2);
      expect(state?.steps[1]?.isCompleted).toBe(true);
      expect(state?.status).toBe("completed");
    });

    it("não deve aceitar progresso negativo ou NaN", () => {
      questManager.registerQuest({
        questId: "safe_progress",
        title: "Progresso Seguro",
        description: "Validação",
        steps: [
          {
            stepId: "step",
            description: "Etapa",
            targetCount: 3,
            currentCount: 0,
            isCompleted: false,
          },
        ],
      });

      questManager.startQuest("safe_progress");

      let state = questManager.advanceQuestProgress("safe_progress", -10);
      expect(state?.steps[0]?.currentCount).toBe(0);

      state = questManager.advanceQuestProgress("safe_progress", Number.NaN);
      expect(state?.steps[0]?.currentCount).toBe(0);
    });

    it("deve considerar uma quest sem etapas imediatamente concluída", () => {
      questManager.registerQuest({
        questId: "empty_quest",
        title: "Quest vazia",
        description: "Sem etapas",
        steps: [],
      });

      expect(questManager.startQuest("empty_quest")).toBe(true);
      expect(questManager.getQuestState("empty_quest")?.status).toBe("completed");
    });
  });

  describe("TriggerZoneManager", () => {
    it("deve registrar e contar o número de zonas ativas", () => {
      triggerManager.registerZone({
        zoneId: "zone_1",
        shape: "box",
        position: { x: 0, y: 0, z: 0 },
        dimensions: { x: 5, y: 5, z: 5 },
        triggerOnce: false,
      });

      expect(triggerManager.activeZoneCount).toBe(1);
      triggerManager.unregisterZone("zone_1");
      expect(triggerManager.activeZoneCount).toBe(0);
    });

    it("deve respeitar a flag triggerOnce permitindo apenas um disparo", () => {
      triggerManager.registerZone({
        zoneId: "single_trigger",
        shape: "box",
        position: { x: 0, y: 0, z: 0 },
        dimensions: { x: 10, y: 10, z: 10 },
        triggerOnce: true,
      });

      let enterCount = 0;

      triggerManager.checkEntityInZones("hero", { x: 0, y: 0, z: 0 }, (type) => {
        if (type === "enter") enterCount += 1;
      });

      triggerManager.checkEntityInZones("hero", { x: 50, y: 50, z: 50 }, () => {});

      triggerManager.checkEntityInZones("hero", { x: 0, y: 0, z: 0 }, (type) => {
        if (type === "enter") enterCount += 1;
      });

      expect(enterCount).toBe(1);
    });

    it("deve detectar corretamente uma zona esférica", () => {
      triggerManager.registerZone({
        zoneId: "sphere_zone",
        shape: "sphere",
        position: { x: 0, y: 0, z: 0 },
        dimensions: { x: 0, y: 0, z: 5 },
        triggerOnce: false,
      });

      let entered = false;
      triggerManager.checkEntityInZones("hero", { x: 4, y: 0, z: 0 }, (type) => {
        if (type === "enter") entered = true;
      });

      expect(entered).toBe(true);
    });

    it("deve detectar corretamente uma zona cilíndrica", () => {
      triggerManager.registerZone({
        zoneId: "cylinder_zone",
        shape: "cylinder",
        position: { x: 0, y: 0, z: 0 },
        dimensions: { x: 0, y: 10, z: 5 },
        triggerOnce: false,
      });

      let entered = false;
      triggerManager.checkEntityInZones("hero", { x: 4, y: 4, z: 0 }, (type) => {
        if (type === "enter") entered = true;
      });

      expect(entered).toBe(true);
    });
  });
});
