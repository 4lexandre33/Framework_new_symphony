import type {
  HUDData,
  HUDValue,
} from "../../../contracts/ui/types";

interface BarBinding {
  readonly element: HTMLElement;
  readonly valueKey: string;
  readonly maxKey: string;
  lastWidth: string;
}

function defaultMaxKey(key: string): string {
  return `max${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}

/**
 * Binder de HUD genérico (chave/valor). A engine NÃO conhece o vocabulário do
 * jogo (vida, mana, munição...): quem define as chaves é o projeto.
 *
 * Convenções de marcação no DOM:
 * - `data-bind="<chave>"` → textContent recebe o valor;
 * - `data-hud-fill="<chave>"` → largura em % = valor / máximo;
 *   máximo = `data-hud-max="<chaveMax>"` ou, por padrão, "max" + Chave
 *   (ex.: `hp` → `maxHp`). Qualquer máximo > 0 vale (inclusive < 1).
 *
 * Os elementos são indexados por chave (G99): `updateValue` toca só os
 * elementos daquela chave. O índice é refeito sob demanda quando um
 * MutationObserver vê o DOM mudar (ou via `refresh()`).
 */
export class HUDDataBinder {
  private readonly cachedData: Record<string, HUDValue> = {};
  private rootElement: HTMLElement | null = null;
  private readonly textIndex = new Map<string, HTMLElement[]>();
  /** chave (valor OU máximo) → barras afetadas. */
  private readonly barIndex = new Map<string, BarBinding[]>();
  private indexDirty = true;
  private observer: MutationObserver | null = null;

  public attach(root: HTMLElement): void {
    this.detach();
    this.rootElement = root;
    this.indexDirty = true;

    if (typeof MutationObserver !== "undefined") {
      this.observer = new MutationObserver((records: MutationRecord[]): void => {
        if (this.isRelevantMutation(records)) {
          // DOM do HUD mudou: reindexa e reaplica os valores em cache (o
          // jogo pode ter montado o HUD depois do último update).
          this.indexDirty = true;
          this.renderInitialHUD();
        }
      });
      this.observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-bind", "data-hud-fill", "data-hud-max"],
      });
    }

    this.renderInitialHUD();
  }

  public detach(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.rootElement = null;
    this.textIndex.clear();
    this.barIndex.clear();
    this.indexDirty = true;
  }

  /** Força reindexação (DOM montado fora da observação, p.ex. sem MutationObserver). */
  public refresh(): void {
    this.indexDirty = true;
    this.renderInitialHUD();
  }

  public bindHUDData(data: HUDData): void {
    for (const key of Object.keys(data)) {
      const value = data[key];

      if (!this.isValidValue(value)) {
        continue;
      }

      if (this.setValue(key, value)) {
        this.applyKey(key, value);
      }
    }
  }

  public updateValue(key: string, value: unknown): boolean {
    if (key === "" || !this.isValidValue(value)) {
      return false;
    }

    if (!this.setValue(key, value)) {
      return false;
    }

    this.applyKey(key, value);
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

  private applyKey(key: string, value: HUDValue): void {
    if (this.rootElement === null) {
      return;
    }

    this.ensureIndex();
    const texts = this.textIndex.get(key);

    if (texts !== undefined) {
      const text = String(value);

      for (let index = 0; index < texts.length; index += 1) {
        const element = texts[index];

        if (element !== undefined) {
          setText(element, text);
        }
      }
    }

    const bars = this.barIndex.get(key);

    if (bars !== undefined) {
      for (let index = 0; index < bars.length; index += 1) {
        const bar = bars[index];

        if (bar !== undefined) {
          this.updateBar(bar);
        }
      }
    }
  }

  /**
   * Mutações causadas pelo próprio binder (texto de `[data-bind]`) não
   * invalidam o índice.
   */
  private isRelevantMutation(records: readonly MutationRecord[]): boolean {
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];

      if (record === undefined) {
        continue;
      }

      if (record.type === "attributes") {
        return true;
      }

      const target = record.target as Element;

      if (typeof target.hasAttribute === "function" && target.hasAttribute("data-bind")) {
        continue;
      }

      return true;
    }

    return false;
  }

  private updateBar(bar: BarBinding): void {
    const value = this.cachedData[bar.valueKey];
    const max = this.cachedData[bar.maxKey];

    if (typeof value !== "number" || typeof max !== "number") {
      return;
    }

    const ratio = max > 0 ? value / max : 0;
    const width = `${this.clampPercent(ratio * 100)}%`;

    if (bar.lastWidth !== width) {
      bar.lastWidth = width;
      bar.element.style.width = width;
    }
  }

  private ensureIndex(): void {
    const root = this.rootElement;

    if (!this.indexDirty || root === null) {
      return;
    }

    this.indexDirty = false;
    this.textIndex.clear();
    this.barIndex.clear();

    const texts = root.querySelectorAll<HTMLElement>("[data-bind]");

    for (let index = 0; index < texts.length; index += 1) {
      const element = texts[index];
      const key = element?.getAttribute("data-bind");

      if (element === undefined || !key) {
        continue;
      }

      const list = this.textIndex.get(key);

      if (list === undefined) {
        this.textIndex.set(key, [element]);
      } else {
        list.push(element);
      }
    }

    const bars = root.querySelectorAll<HTMLElement>("[data-hud-fill]");

    for (let index = 0; index < bars.length; index += 1) {
      const element = bars[index];
      const valueKey = element?.getAttribute("data-hud-fill");

      if (element === undefined || !valueKey) {
        continue;
      }

      const binding: BarBinding = {
        element,
        valueKey,
        maxKey: element.getAttribute("data-hud-max") ?? defaultMaxKey(valueKey),
        lastWidth: element.style.width,
      };

      this.addBar(binding.valueKey, binding);

      if (binding.maxKey !== binding.valueKey) {
        this.addBar(binding.maxKey, binding);
      }
    }
  }

  private addBar(key: string, binding: BarBinding): void {
    const list = this.barIndex.get(key);

    if (list === undefined) {
      this.barIndex.set(key, [binding]);
    } else {
      list.push(binding);
    }
  }

  private renderInitialHUD(): void {
    if (this.rootElement === null) {
      return;
    }

    this.ensureIndex();

    for (const key of Object.keys(this.cachedData)) {
      const value = this.cachedData[key];

      if (value !== undefined) {
        this.applyKey(key, value);
      }
    }
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

/** Atualiza o texto sem recriar o nó de texto (sem mutação childList). */
function setText(element: HTMLElement, text: string): void {
  const first = element.firstChild;

  if (first !== null && first === element.lastChild && first.nodeType === 3) {
    if (first.nodeValue !== text) {
      first.nodeValue = text;
    }

    return;
  }

  if (element.textContent !== text) {
    element.textContent = text;
  }
}
