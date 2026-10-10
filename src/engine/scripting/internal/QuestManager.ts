import type {
  QuestDescriptor,
  QuestState,
  QuestStatus,
  QuestStep,
  RegisterQuestOptions,
  StartQuestOptions,
} from "../../../contracts/scripting/types";

/** Resultado de uma mudança de quest (para o serviço emitir eventos). */
export interface QuestChange {
  readonly state: QuestState;
  /** A quest passou para "completed" nesta chamada. */
  readonly completedNow: boolean;
  /** A quest passou para "failed" nesta chamada. */
  readonly failedNow: boolean;
}

export class QuestManager {
  private readonly questDescriptors = new Map<string, QuestDescriptor>();
  private readonly questStates = new Map<string, QuestState>();
  private lastChange: QuestChange | null = null;

  /**
   * Registra (ou atualiza) uma quest. O estado existente é PRESERVADO
   * (G126); `resetState: true` o descarta.
   */
  public registerQuest(descriptor: QuestDescriptor, options?: RegisterQuestOptions): boolean {
    if (!descriptor || typeof descriptor.questId !== "string" || descriptor.questId.length === 0 || !Array.isArray(descriptor.steps)) {
      return false;
    }

    this.questDescriptors.set(descriptor.questId, descriptor);
    if (options?.resetState === true) {
      this.questStates.delete(descriptor.questId);
    }
    return true;
  }

  public hasQuest(questId: string): boolean {
    return this.questDescriptors.has(questId);
  }

  public getDescriptor(questId: string): QuestDescriptor | null {
    return this.questDescriptors.get(questId) ?? null;
  }

  /**
   * Inicia a quest. Idempotente (G126): uma quest já ativa, concluída ou
   * falhada NÃO é reiniciada (retorna false) a menos que `restart: true`.
   */
  public startQuest(questId: string, options?: StartQuestOptions): boolean {
    const descriptor = this.questDescriptors.get(questId);
    if (!descriptor) return false;

    const existing = this.questStates.get(questId);
    if (existing && existing.status !== "not_started" && options?.restart !== true) {
      this.lastChange = null;
      return false;
    }

    const initialSteps: QuestStep[] = descriptor.steps.map((step) => {
      const targetCount = this.normalizeTargetCount(step.targetCount);

      return {
        ...step,
        targetCount,
        currentCount: 0,
        isCompleted: targetCount === 0,
      };
    });

    const firstIncompleteStep = this.findNextIncompleteStep(initialSteps, 0);
    const status: QuestStatus = firstIncompleteStep < 0 ? "completed" : "active";
    const currentStepIndex =
      firstIncompleteStep >= 0
        ? firstIncompleteStep
        : initialSteps.length > 0
          ? initialSteps.length - 1
          : 0;

    const state: QuestState = {
      questId,
      status,
      currentStepIndex,
      steps: initialSteps,
      updatedAtTimestamp: Date.now(),
    };

    this.questStates.set(questId, state);
    this.lastChange = { state, completedNow: status === "completed", failedNow: false };
    return true;
  }

  /**
   * Avança o progresso. A sobra de uma etapa concluída passa para as
   * próximas (G126).
   */
  public advanceQuestProgress(questId: string, amount = 1): QuestState | null {
    this.lastChange = null;
    const state = this.questStates.get(questId);
    if (!state || state.status !== "active") return null;

    let remaining = this.normalizeProgressAmount(amount);
    if (remaining <= 0) return state;

    const updatedSteps = state.steps.slice();
    let stepIndex = this.findNextIncompleteStep(updatedSteps, state.currentStepIndex);
    let lastTouched = Math.max(0, Math.min(state.currentStepIndex, Math.max(0, updatedSteps.length - 1)));

    while (stepIndex >= 0 && remaining > 0) {
      const currentStep = updatedSteps[stepIndex];
      if (!currentStep) break;

      const targetCount = this.normalizeTargetCount(currentStep.targetCount);
      const currentCount = this.normalizeCurrentCount(currentStep.currentCount, targetCount);
      const needed = targetCount - currentCount;
      const applied = Math.min(needed, remaining);
      const newCount = currentCount + applied;
      remaining -= applied;

      updatedSteps[stepIndex] = {
        ...currentStep,
        targetCount,
        currentCount: newCount,
        isCompleted: newCount >= targetCount,
      };

      lastTouched = stepIndex;
      if (newCount < targetCount) break;
      stepIndex = this.findNextIncompleteStep(updatedSteps, stepIndex + 1);
    }

    const nextIncomplete = this.findNextIncompleteStep(updatedSteps, 0);
    let status: QuestStatus = "active";
    if (nextIncomplete < 0) status = "completed";

    const updatedState: QuestState = {
      ...state,
      status,
      currentStepIndex: nextIncomplete >= 0 ? nextIncomplete : lastTouched,
      steps: updatedSteps,
      updatedAtTimestamp: Date.now(),
    };

    this.questStates.set(questId, updatedState);
    this.lastChange = { state: updatedState, completedNow: status === "completed", failedNow: false };
    return updatedState;
  }

  /** Conclui uma quest ativa (todas as etapas completas). */
  public completeQuest(questId: string): QuestState | null {
    this.lastChange = null;
    const state = this.questStates.get(questId);
    if (!state || state.status !== "active") return null;

    const steps = state.steps.map((step) => {
      const targetCount = this.normalizeTargetCount(step.targetCount);
      return { ...step, targetCount, currentCount: targetCount, isCompleted: true };
    });

    const completed: QuestState = {
      ...state,
      status: "completed",
      currentStepIndex: steps.length > 0 ? steps.length - 1 : 0,
      steps,
      updatedAtTimestamp: Date.now(),
    };

    this.questStates.set(questId, completed);
    this.lastChange = { state: completed, completedNow: true, failedNow: false };
    return completed;
  }

  /** Marca uma quest ativa como "failed". */
  public failQuest(questId: string, reason?: string): QuestState | null {
    this.lastChange = null;
    const state = this.questStates.get(questId);
    if (!state || state.status !== "active") return null;

    const failed: QuestState = {
      ...state,
      status: "failed",
      updatedAtTimestamp: Date.now(),
      ...(typeof reason === "string" ? { failureReason: reason } : {}),
    };

    this.questStates.set(questId, failed);
    this.lastChange = { state: failed, completedNow: false, failedNow: true };
    return failed;
  }

  /** Ids das quests ativas cuja etapa atual mira `entityId`. */
  public findActiveQuestsTargeting(entityId: string): string[] {
    const result: string[] = [];
    for (const state of this.questStates.values()) {
      if (state.status !== "active") continue;
      const step = state.steps[state.currentStepIndex];
      if (step && !step.isCompleted && step.targetEntityId === entityId) {
        result.push(state.questId);
      }
    }
    return result;
  }

  /** Última mudança feita por start/advance/complete/fail (ou null). */
  public consumeLastChange(): QuestChange | null {
    const change = this.lastChange;
    this.lastChange = null;
    return change;
  }

  public getQuestState(questId: string): QuestState | null {
    return this.questStates.get(questId) ?? null;
  }

  public clear(): void {
    this.questDescriptors.clear();
    this.questStates.clear();
    this.lastChange = null;
  }

  private findNextIncompleteStep(
    steps: ReadonlyArray<QuestStep>,
    startIndex: number,
  ): number {
    const safeStartIndex = Math.max(0, Math.floor(startIndex));

    for (let index = safeStartIndex; index < steps.length; index += 1) {
      const step = steps[index];
      if (step && !step.isCompleted) return index;
    }

    return -1;
  }

  private normalizeTargetCount(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, value);
  }

  private normalizeProgressAmount(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, value);
  }

  private normalizeCurrentCount(value: number, targetCount: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(targetCount, Math.max(0, value));
  }
}
