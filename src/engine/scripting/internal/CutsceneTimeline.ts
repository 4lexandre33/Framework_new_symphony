import type {
  CutsceneDescriptor,
  TimelineKeyframe,
} from "../../../contracts/scripting/types";

export interface TimelineEventCallback {
  (actionType: string, targetId: string, payload: Record<string, unknown>): void;
}

interface ScheduledKeyframe {
  readonly timeSeconds: number;
  readonly trackIndex: number;
  readonly keyframeIndex: number;
  readonly keyframe: TimelineKeyframe;
}

interface RegisteredCutscene {
  readonly descriptor: CutsceneDescriptor;
  readonly scheduledKeyframes: ReadonlyArray<ScheduledKeyframe>;
}

export class CutsceneTimeline {
  private readonly cutscenes = new Map<string, RegisteredCutscene>();
  private activeCutscene: RegisteredCutscene | null = null;
  private currentTime = 0;
  private nextKeyframeIndex = 0;
  private isPlaying = false;

  public registerCutscene(descriptor: CutsceneDescriptor): void {
    const scheduledKeyframes: ScheduledKeyframe[] = [];

    for (let trackIndex = 0; trackIndex < descriptor.tracks.length; trackIndex += 1) {
      const track = descriptor.tracks[trackIndex];
      if (!track) continue;

      for (let keyframeIndex = 0; keyframeIndex < track.keyframes.length; keyframeIndex += 1) {
        const keyframe = track.keyframes[keyframeIndex];
        if (!keyframe) continue;

        scheduledKeyframes.push({
          timeSeconds: this.sanitizeTime(keyframe.timeSeconds),
          trackIndex,
          keyframeIndex,
          keyframe,
        });
      }
    }

    scheduledKeyframes.sort((first, second) => {
      const timeDifference = first.timeSeconds - second.timeSeconds;
      if (timeDifference !== 0) return timeDifference;

      const trackDifference = first.trackIndex - second.trackIndex;
      if (trackDifference !== 0) return trackDifference;

      return first.keyframeIndex - second.keyframeIndex;
    });

    this.cutscenes.set(descriptor.cutsceneId, {
      descriptor,
      scheduledKeyframes,
    });
  }

  public play(cutsceneId: string): boolean {
    const cutscene = this.cutscenes.get(cutsceneId);
    if (!cutscene) return false;

    this.activeCutscene = cutscene;
    this.currentTime = 0;
    this.nextKeyframeIndex = 0;
    this.isPlaying = true;
    return true;
  }

  public pause(): void {
    this.isPlaying = false;
  }

  public stop(): void {
    this.isPlaying = false;
    this.activeCutscene = null;
    this.currentTime = 0;
    this.nextKeyframeIndex = 0;
  }

  public get playing(): boolean {
    return this.isPlaying;
  }

  public get currentCutsceneId(): string | null {
    return this.activeCutscene?.descriptor.cutsceneId ?? null;
  }

  public get currentDurationSeconds(): number | null {
    if (!this.activeCutscene) return null;
    return this.sanitizeDuration(this.activeCutscene.descriptor.durationSeconds);
  }

  public get elapsedSeconds(): number {
    return this.currentTime;
  }

  public update(
    deltaSeconds: number,
    onKeyframeTrigger: TimelineEventCallback,
  ): string | null {
    if (!this.isPlaying || !this.activeCutscene) return null;

    const active = this.activeCutscene;
    const duration = this.sanitizeDuration(active.descriptor.durationSeconds);
    const safeDelta = this.sanitizeDelta(deltaSeconds);
    const targetTime = Math.min(duration, this.currentTime + safeDelta);

    while (this.nextKeyframeIndex < active.scheduledKeyframes.length) {
      const scheduled = active.scheduledKeyframes[this.nextKeyframeIndex];
      if (!scheduled || scheduled.timeSeconds > targetTime) break;

      this.nextKeyframeIndex += 1;
      onKeyframeTrigger(
        scheduled.keyframe.actionType,
        scheduled.keyframe.targetId,
        scheduled.keyframe.payload,
      );
    }

    this.currentTime = targetTime;

    if (this.currentTime < duration) return null;

    const finishedCutsceneId = active.descriptor.cutsceneId;
    this.stop();
    return finishedCutsceneId;
  }

  public clear(): void {
    this.stop();
    this.cutscenes.clear();
  }

  private sanitizeDelta(deltaSeconds: number): number {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return 0;
    return deltaSeconds;
  }

  private sanitizeDuration(durationSeconds: number): number {
    if (!Number.isFinite(durationSeconds)) return 0;
    return Math.max(0, durationSeconds);
  }

  private sanitizeTime(timeSeconds: number): number {
    if (!Number.isFinite(timeSeconds)) return 0;
    return Math.max(0, timeSeconds);
  }
}
