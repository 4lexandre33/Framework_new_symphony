// HUD: a engine só fornece #hud-overlay e o binder genérico. Marcação e chaves são do JOGO.
import type { UIApi } from "../../../tokens/ui";

export function mountHud(ui: UIApi, doc: Document = document): () => void {
  const overlay = doc.getElementById("hud-overlay");
  const root = doc.createElement("div");
  root.innerHTML = `
    <div>Vida: <span data-bind="hp">0</span> / <span data-bind="maxHp">0</span></div>
    <div class="bar"><div data-hud-fill="hp"></div></div>`; // largura = hp / maxHp (ou data-hud-max="outraChave")
  overlay?.appendChild(root);
  ui.bindHUDData({ hp: 100, maxHp: 100 });
  return (): void => root.remove();
}
export function damage(ui: UIApi, hp: number): void {
  ui.updateHUD("hp", hp);
}
