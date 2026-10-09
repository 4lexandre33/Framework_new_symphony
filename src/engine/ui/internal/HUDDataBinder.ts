import type {
  HUDData,
  HUDValue,
} from "../../../contracts/ui/types";

/**
 * Binder de HUD genérico (chave/valor). A engine NÃO conhece o vocabulário do
 * jogo (vida, mana, munição...): quem define as chaves é o projeto.
 *
 * Convenções de marcação no DOM:
 *  - `data-bind="<chave>"`      → textContent recebe o valor;
 *  - `data-hud-fill="<chave>"`  → largura em % = valor / máximo;
 *      máximo = `data-hud-max="<chaveMax>"` ou, por padrão, "max" + Chave
 *      (ex.: `hp` → `maxHp`).
 */
export class HUDDataBinder {
  private readonly cachedData: Record<string, HUDValue> = {};

  private rootElement: HTMLElement | null = null;

  public attach(root: HTMLElement): void {
    this.rootElement = root;
    this.renderInitialHUD();
  }

  public detach(): void {
    this.rootElement = null;
  }

  public bindHUDData(data: HUDData): void {
    let changed = false;

    for (const key of Object.keys(data)) {
      const value = data[key];

      if (!this.isValidValue(value)) {
        continue;
      }

      if (this.setValue(key, value)) {
        this.updateDOMElement(key, value);
        changed = true;
      }
    }

    if (changed) {
      this.updateProgressBars();
    }
  }

  public updateValue(key: string, value: unknown): boolean {
    if (key === "" || !this.isValidValue(value)) {
      return false;
    }

    if (!this.setValue(key, value)) {
      return false;
    }

    this.updateDOMElement(key, value);
    this.updateProgressBars();

    return true;
  }

  public getSnapshot(): HUDData {
    return { ...this.cachedData };
  }

  private setValue(key: string, value: HUDValue): boolean {
    if (this.cachedData[key] === value) {
      return false;
    }

    this.cachedData[key] = value;

    return true;
  }

  private isValidValue(value: unknown): value is HUDValue {
    if (typeof value === "number") {
      return Number.isFinite(value);
    }

    return typeof value === "string" || typeof value === "boolean";
  }

  private updateDOMElement(key: string, value: HUDValue): void {
    const root = this.rootElement;

    if (!root) {
      return;
    }

    const elements = root.querySelectorAll<HTMLElement>("[data-bind]");

    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index];

      if (element && element.getAttribute("data-bind") === key) {
        element.textContent = String(value);
      }
    }
  }

  private updateProgressBars(): void {
    const root = this.rootElement;

    if (!root) {
      return;
    }

    const bars = root.querySelectorAll<HTMLElement>("[data-hud-fill]");

    for (let index = 0; index < bars.length; index += 1) {
      const bar = bars[index];
      const key = bar?.getAttribute("data-hud-fill");

      if (!bar || !key) {
        continue;
      }

      const maxKey =
        bar.getAttribute("data-hud-max") ??
        `max${key.charAt(0).toUpperCase()}${key.slice(1)}`;

      const value = this.cachedData[key];
      const max = this.cachedData[maxKey];

      if (typeof value !== "number" || typeof max !== "number") {
        continue;
      }

      bar.style.width = `${this.clampPercent((value / Math.max(1, max)) * 100)}%`;
    }
  }

  private renderInitialHUD(): void {
    for (const key of Object.keys(this.cachedData)) {
      const value = this.cachedData[key];

      if (value !== undefined) {
        this.updateDOMElement(key, value);
      }
    }

    this.updateProgressBars();
  }

  private clampPercent(value: number): number {
    if (value <= 0) {
      return 0;
    }

    if (value >= 100) {
      return 100;
    }

    return value;
  }
}
