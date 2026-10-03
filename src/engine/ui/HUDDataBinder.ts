import type {
  PlayerHUDData,
} from "../../contracts/ui/types";

type MutablePlayerHUDData = {
  -readonly [
    Key in keyof PlayerHUDData
  ]: PlayerHUDData[Key];
};

const DEFAULT_HUD_DATA:
  Readonly<PlayerHUDData> = {
    hp: 100,
    maxHp: 100,

    mp: 50,
    maxMp: 50,

    ammo: 30,
    maxAmmo: 120,

    coins: 0,
    score: 0,

    currentWeapon:
      "Pistola",
  };

export class HUDDataBinder {
  private readonly cachedData:
    MutablePlayerHUDData = {
      ...DEFAULT_HUD_DATA,
    };

  private rootElement:
    HTMLElement | null = null;

  public attach(
    root: HTMLElement,
  ): void {
    this.rootElement =
      root;

    this.renderInitialHUD();
  }

  public detach(): void {
    this.rootElement = null;
  }

  public bindHUDData(
    data:
      Partial<PlayerHUDData>,
  ): void {
    let changed = false;

    const keys =
      Object.keys(
        data,
      ) as Array<
        keyof PlayerHUDData
      >;

    for (
      let index = 0;
      index <
      keys.length;
      index += 1
    ) {
      const key =
        keys[index];

      if (!key) {
        continue;
      }

      const value =
        data[key];

      if (
        value ===
        undefined
      ) {
        continue;
      }

      if (
        this.setValue(
          key,
          value,
        )
      ) {
        this.updateDOMElement(
          key,
          value,
        );

        changed = true;
      }
    }

    if (changed) {
      this.updateProgressBars();
    }
  }

  public updateValue(
    key:
      keyof PlayerHUDData,
    value:
      unknown,
  ): boolean {
    if (
      !this.isValidValue(
        key,
        value,
      )
    ) {
      return false;
    }

    if (
      !this.setValue(
        key,
        value,
      )
    ) {
      return false;
    }

    this.updateDOMElement(
      key,
      value,
    );

    this.updateProgressBars();

    return true;
  }

  public getSnapshot():
    Readonly<PlayerHUDData> {
    return {
      ...this.cachedData,
    };
  }

  private setValue(
    key:
      keyof PlayerHUDData,
    value:
      PlayerHUDData[
        keyof PlayerHUDData
      ],
  ): boolean {
    const state =
      this.cachedData as unknown as Record<
        keyof PlayerHUDData,
        PlayerHUDData[
          keyof PlayerHUDData
        ]
      >;

    if (
      state[key] ===
      value
    ) {
      return false;
    }

    state[key] =
      value;

    return true;
  }

  private isValidValue(
    key:
      keyof PlayerHUDData,
    value:
      unknown,
  ): value is
    PlayerHUDData[
      keyof PlayerHUDData
    ] {
    if (
      key ===
      "currentWeapon"
    ) {
      return (
        typeof value ===
        "string"
      );
    }

    return (
      typeof value ===
        "number" &&
      Number.isFinite(
        value,
      )
    );
  }

  private updateDOMElement(
    key:
      keyof PlayerHUDData,
    value:
      unknown,
  ): void {
    const root =
      this.rootElement;

    if (!root) {
      return;
    }

    const selector =
      `[data-bind="${key}"]`;

    const elements =
      root.querySelectorAll<HTMLElement>(
        selector,
      );

    for (
      let index = 0;
      index <
      elements.length;
      index += 1
    ) {
      const element =
        elements[index];

      if (!element) {
        continue;
      }

      element.textContent =
        String(
          value,
        );
    }
  }

  private updateProgressBars():
    void {
    const root =
      this.rootElement;

    if (!root) {
      return;
    }

    const hpBar =
      root.querySelector<HTMLElement>(
        "#hud-hp-bar",
      );

    if (hpBar) {
      const maxHp =
        Math.max(
          1,
          this.cachedData.maxHp,
        );

      const percentage =
        this.clampPercent(
          (
            this.cachedData.hp /
            maxHp
          ) * 100,
        );

      hpBar.style.width =
        `${percentage}%`;
    }

    const mpBar =
      root.querySelector<HTMLElement>(
        "#hud-mp-bar",
      );

    if (mpBar) {
      const maxMp =
        Math.max(
          1,
          this.cachedData.maxMp,
        );

      const percentage =
        this.clampPercent(
          (
            this.cachedData.mp /
            maxMp
          ) * 100,
        );

      mpBar.style.width =
        `${percentage}%`;
    }
  }

  private renderInitialHUD():
    void {
    const keys =
      Object.keys(
        this.cachedData,
      ) as Array<
        keyof PlayerHUDData
      >;

    for (
      let index = 0;
      index <
      keys.length;
      index += 1
    ) {
      const key =
        keys[index];

      if (!key) {
        continue;
      }

      this.updateDOMElement(
        key,
        this.cachedData[
          key
        ],
      );
    }

    this.updateProgressBars();
  }

  private clampPercent(
    value: number,
  ): number {
    if (
      value <= 0
    ) {
      return 0;
    }

    if (
      value >= 100
    ) {
      return 100;
    }

    return value;
  }
}