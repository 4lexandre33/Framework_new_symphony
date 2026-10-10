import type {
  CutsceneDescriptor,
  TimelineKeyframe,
  TrackType,
} from "../../../contracts/scripting/types";

export interface TimelineEventCallback {
  (
    actionType: string,
    targetId: string,
    payload: Record<string, unknown>,
    trackId: string,
    trackType: TrackType,
    timeSeconds: number,
  ): void;
}

interface ScheduledKeyframe {
  readonly timeSeconds: number;
  readonly trackIndex: number;
  readonly keyframeIndex: number;
  readonly trackId: string;
  readonly trackType: TrackType;
  readonly keyframe: TimelineKeyframe;
}

const EMPTY_PAYLOAD: Record<string, unknown> = Object.freeze({}) as Record<string, unknown>;

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
  /** Incrementado em play/stop: detecta troca de cutscene dentro de um keyframe. */
  private generation = 0;

  public registerCutscene(descriptor: CutsceneDescriptor): void {
    const scheduledKeyframes: ScheduledKeyframe[] = [];

    const tracks = Array.isArray(descriptor.tracks) ? descriptor.tracks : [];

    for (let trackIndex = 0; trackIndex < tracks.length; trackIndex += 1) {
      const track = tracks[trackIndex];
      if (!track || !Array.isArray(track.keyframes)) continue;

      for (let keyframeIndex = 0; keyframeIndex < track.keyframes.length; keyframeIndex += 1) {
        const keyframe = track.keyframes[keyframeIndex];
        if (!keyframe) continue;

        scheduledKeyframes.push({
          timeSeconds: this.sanitizeTime(keyframe.timeSeconds),
          trackIndex,
          keyframeIndex,
          trackId: String(track.trackId ?? ""),
          trackType: track.trackType,
          keyframe: keyframe.payload ? keyframe : { ...keyframe, payload: EMPTY_PAYLOAD },
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

    this.generation += 1;
    this.activeCutscene = cutscene;
    this.currentTime = 0;
    this.nextKeyframeIndex = 0;
    this.isPlaying = true;
    return true;
  }

  public pause(): boolean {
    if (!this.activeCutscene || !this.isPlaying) return false;
    this.isPlaying = false;
    return true;
  }

  /** Retoma uma cutscene pausada de onde parou (G128). */
  public resume(): boolean {
    if (!this.activeCutscene || this.isPlaying) return false;
    this.isPlaying = true;
    return true;
  }

  public get paused(): boolean {
    return this.activeCutscene !== null && !this.isPlaying;
  }

  public hasCutscene(cutsceneId: string): boolean {
    return this.cutscenes.has(cutsceneId);
  }

  /**
   * Pula para o fim. Com callback, executa os keyframes que faltavam
   * (estado final consistente). Retorna o id da cutscene pulada.
   */
  public skipToEnd(onKeyframeTrigger?: TimelineEventCallback): string | null {
    const active = this.activeCutscene;
    if (!active) return null;

    if (onKeyframeTrigger) {
      while (this.nextKeyframeIndex < active.scheduledKeyframes.length) {
        const scheduled = active.scheduledKeyframes[this.nextKeyframeIndex];
        this.nextKeyframeIndex += 1;
        if (!scheduled) continue;
        onKeyframeTrigger(
          scheduled.keyframe.actionType,
          scheduled.keyframe.targetId,
          scheduled.keyframe.payload,
          scheduled.trackId,
          scheduled.trackType,
          scheduled.timeSeconds,
        );
      }
    }

    const cutsceneId = active.descriptor.cutsceneId;
    this.currentTime = this.sanitizeDuration(active.descriptor.durationSeconds);
    this.stop();
    return cutsceneId;
  }

  /** Tempo decorrido quando a última cutscene terminou/parou. */
  public lastElapsedSeconds = 0;

  public stop(): void {
    if (this.activeCutscene) this.lastElapsedSeconds = this.currentTime;
    this.generation += 1;
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
    const generation = this.generation;
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
        scheduled.trackId,
        scheduled.trackType,
        scheduled.timeSeconds,
      );

      // Um keyframe pode ter parado/trocado a cutscene.
      if (this.generation !== generation) return null;

      // Pausada por um keyframe: congela no tempo dele.
      if (!this.isPlaying) {
        this.currentTime = scheduled.timeSeconds;
        return null;
      }
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