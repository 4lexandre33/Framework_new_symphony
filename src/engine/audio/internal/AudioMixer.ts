import type {
  AudioChannelType,
} from "../../../contracts/audio/types";

export interface ChannelNodeState {
  readonly gainNode:
    GainNode;

  volume:
    number;

  muted:
    boolean;
}

interface WindowWithWebkitAudioContext
  extends Window {
  readonly webkitAudioContext?:
    typeof AudioContext;
}

const CHILD_CHANNELS:
  readonly AudioChannelType[] =
    Object.freeze([
      "bgm",
      "sfx",
      "voice",
      "ui",
    ]);

function clampVolume(
  value:
    number,
): number {
  if (
    !Number.isFinite(
      value,
    )
  ) {
    return 0;
  }

  return Math.min(
    1,
    Math.max(
      0,
      value,
    ),
  );
}

export class AudioMixer {
  private readonly context:
    AudioContext;

  private readonly masterGain:
    GainNode;

  private readonly channels =
    new Map<
      AudioChannelType,
      ChannelNodeState
    >();

  private readonly ownsContext:
    boolean;

  private disposed =
    false;

  public constructor(
    customAudioContext?:
      AudioContext,
  ) {
    if (
      customAudioContext !==
      undefined
    ) {
      this.context =
        customAudioContext;

      this.ownsContext =
        false;
    } else {
      const windowRef =
        window as
          WindowWithWebkitAudioContext;

      const AudioContextCtor =
        window.AudioContext ??
        windowRef.webkitAudioContext;

      if (
        AudioContextCtor ===
        undefined
      ) {
        throw new Error(
          "Web Audio API indisponível.",
        );
      }

      this.context =
        new AudioContextCtor();

      this.ownsContext =
        true;
    }

    this.masterGain =
      this.context.createGain();

    this.masterGain.connect(
      this.context.destination,
    );

    this.channels.set(
      "master",
      {
        gainNode:
          this.masterGain,
        volume:
          1,
        muted:
          false,
      },
    );

    this.initializeChildChannels();
  }

  public get audioContext():
    AudioContext {
    return this.context;
  }

  public get masterGainNode():
    GainNode {
    return this.masterGain;
  }

  public get isDisposed():
    boolean {
    return this.disposed;
  }

  public setChannelVolume(
    channel:
      AudioChannelType,
    volume:
      number,
    muted =
      false,
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    const state =
      this.channels.get(
        channel,
      );

    if (
      state ===
      undefined
    ) {
      return;
    }

    state.volume =
      clampVolume(
        volume,
      );

    state.muted =
      muted;

    const targetGain =
      state.muted
        ? 0
        : state.volume;

    const now =
      this.context.currentTime;

    state.gainNode
      .gain
      .cancelScheduledValues(
        now,
      );

    state.gainNode
      .gain
      .setValueAtTime(
        state.gainNode
          .gain
          .value,
        now,
      );

    state.gainNode
      .gain
      .linearRampToValueAtTime(
        targetGain,
        now +
          0.05,
      );
  }

  public getChannelVolume(
    channel:
      AudioChannelType,
  ): number {
    return (
      this.channels.get(
        channel,
      )?.volume ??
      1
    );
  }

  public isChannelMuted(
    channel:
      AudioChannelType,
  ): boolean {
    return (
      this.channels.get(
        channel,
      )?.muted ??
      false
    );
  }

  public getChannelGainNode(
    channel:
      AudioChannelType,
  ): GainNode {
    return (
      this.channels.get(
        channel,
      )?.gainNode ??
      this.masterGain
    );
  }

  public async resumeIfSuspended():
    Promise<void> {
    if (
      this.disposed ||
      this.context.state !==
        "suspended"
    ) {
      return;
    }

    try {
      await this.context
        .resume();
    } catch (
      error:
        unknown
    ) {
      console.warn(
        "[AudioMixer] Falha ao retomar AudioContext:",
        error,
      );
    }
  }

  public dispose(): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.disposed =
      true;

    for (
      const state of
      this.channels.values()
    ) {
      try {
        state.gainNode
          .disconnect();
      } catch {
        // AudioNode já desconectado.
      }
    }

    this.channels.clear();

    if (
      this.ownsContext &&
      this.context.state !==
        "closed"
    ) {
      void this.context
        .close()
        .catch(
          (): void => {
            // Shutdown best-effort.
          },
        );
    }
  }

  private initializeChildChannels():
    void {
    for (
      const type of
      CHILD_CHANNELS
    ) {
      const gainNode =
        this.context
          .createGain();

      gainNode.connect(
        this.masterGain,
      );

      this.channels.set(
        type,
        {
          gainNode,
          volume:
            1,
          muted:
            false,
        },
      );
    }
  }
}
