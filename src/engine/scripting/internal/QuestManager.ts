import type {
  QuestDescriptor,
  QuestState,
  QuestStatus,
  QuestStep,
} from "../../../contracts/scripting/types";

export class QuestManager {
  private readonly questDescriptors = new Map<string, QuestDescriptor>();
  private readonly questStates = new Map<string, QuestState>();

  public registerQuest(descriptor: QuestDescriptor): void {
    this.questDescriptors.set(descriptor.questId, descriptor);
    this.questStates.delete(descriptor.questId);
  }

  public startQuest(questId: string): boolean {
    const descriptor = this.questDescriptors.get(questId);
    if (!descriptor) return false;

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
    return true;
  }

  public advanceQuestProgress(questId: string, amount = 1): QuestState | null {
    const state = this.questStates.get(questId);
    if (!state || state.status !== "active") return null;

    const safeAmount = this.normalizeProgressAmount(amount);
    if (safeAmount <= 0) return state;

    const stepIndex = this.findNextIncompleteStep(state.steps, state.currentStepIndex);

    if (stepIndex < 0) {
      const completedState: QuestState = {
        ...state,
        status: "completed",
        updatedAtTimestamp: Date.now(),
      };

      this.questStates.set(questId, completedState);
      return completedState;
    }

    const currentStep = state.steps[stepIndex];
    if (!currentStep) return state;

    const targetCount = this.normalizeTargetCount(currentStep.targetCount);
    const currentCount = this.normalizeCurrentCount(currentStep.currentCount, targetCount);
    const newCount = Math.min(targetCount, currentCount + safeAmount);
    const isStepCompleted = newCount >= targetCount;

    const updatedSteps = state.steps.slice();
    updatedSteps[stepIndex] = {
      ...currentStep,
      targetCount,
      currentCount: newCount,
      isCompleted: isStepCompleted,
    };

    let nextStepIndex = stepIndex;
    let status: QuestStatus = "active";

    if (isStepCompleted) {
      const nextIncompleteStep = this.findNextIncompleteStep(updatedSteps, stepIndex + 1);

      if (nextIncompleteStep < 0) {
        status = "completed";
      } else {
        nextStepIndex = nextIncompleteStep;
      }
    }

    const updatedState: QuestState = {
      ...state,
      status,
      currentStepIndex: nextStepIndex,
      steps: updatedSteps,
      updatedAtTimestamp: Date.now(),
    };

    this.questStates.set(questId, updatedState);
    return updatedState;
  }

  public getQuestState(questId: string): QuestState | null {
    return this.questStates.get(questId) ?? null;
  }

  public clear(): void {
    this.questDescriptors.clear();
    this.questStates.clear();
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
