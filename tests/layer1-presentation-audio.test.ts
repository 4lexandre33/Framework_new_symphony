import {
  describe,
  expect,
  it,
} from "vitest";

import {
  AudioMixer,
} from "../src/engine/audio/internal/AudioMixer";

import {
  AudioVoiceRegistry,
} from "../src/engine/audio/internal/AudioVoiceRegistry";

class MockAudioParam {
  public value =
    1;

  public cancelScheduledValues():
    void {}

  public setValueAtTime(
    value:
      number,
  ): void {
    this.value =
      value;
  }

  public linearRampToValueAtTime(
    value:
      number,
  ): void {
    this.value =
      value;
  }
}

class MockGainNode {
  public readonly gain =
    new MockAudioParam();

  public connectedTo:
    unknown =
      null;

  public connect(
    target:
      unknown,
  ): void {
    this.connectedTo =
      target;
  }

  public disconnect():
    void {
    this.connectedTo =
      null;
  }
}

class MockSource {
  public onended:
    (() => void) | null =
      null;

  public stopCalls =
    0;

  public stop(): void {
    this.stopCalls +=
      1;
  }

  public disconnect():
    void {}
}

class MockContext {
  public currentTime =
    0;

  public state:
    AudioContextState =
      "running";

  public readonly destination =
    {};

  public readonly listener =
    {};

  public readonly gains:
    MockGainNode[] =
      [];

  public createGain():
    GainNode {
    const gain =
      new MockGainNode();

    this.gains.push(
      gain,
    );

    return gain as unknown as
      GainNode;
  }

  public async resume():
    Promise<void> {}

  public async close():
    Promise<void> {
    this.state =
      "closed";
  }
}

describe(
  "Layer 1 Stage 80 — Audio presentation",
  (): void => {
    it(
      "conecta canais filhos ao master e master ao destination",
      (): void => {
        const context =
          new MockContext();

        const mixer =
          new AudioMixer(
            context as unknown as
              AudioContext,
          );

        const master =
          mixer.masterGainNode as unknown as
            MockGainNode;

        expect(
          master.connectedTo,
        ).toBe(
          context.destination,
        );

        for (
          const channel of
          [
            "bgm",
            "sfx",
            "voice",
            "ui",
          ] as const
        ) {
          const gain =
            mixer.getChannelGainNode(
              channel,
            ) as unknown as
              MockGainNode;

          expect(
            gain.connectedTo,
          ).toBe(
            mixer.masterGainNode,
          );
        }

        mixer.dispose();
      },
    );

    it(
      "stopAll encerra e remove todas as vozes registradas",
      (): void => {
        const registry =
          new AudioVoiceRegistry();

        const sourceA =
          new MockSource();

        const sourceB =
          new MockSource();

        const gain =
          new MockGainNode();

        registry.register({
          source:
            sourceA as unknown as
              AudioBufferSourceNode,
          gainNode:
            gain as unknown as
              GainNode,
        });

        registry.register({
          source:
            sourceB as unknown as
              AudioBufferSourceNode,
          gainNode:
            gain as unknown as
              GainNode,
        });

        expect(
          registry.activeVoiceCount,
        ).toBe(
          2,
        );

        registry.stopAll();

        expect(
          sourceA.stopCalls,
        ).toBe(
          1,
        );

        expect(
          sourceB.stopCalls,
        ).toBe(
          1,
        );

        expect(
          registry.activeVoiceCount,
        ).toBe(
          0,
        );
      },
    );
  },
);
