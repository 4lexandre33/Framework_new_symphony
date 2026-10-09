/**
 * HUD de demonstração (vida, mana, munição) do projeto Physics Sandbox.
 *
 * Pertence ao PROJETO, não à engine: a engine só oferece o contêiner genérico
 * `#hud-overlay` (módulo de UI) e o binder `data-bind` (hp, maxHp, mp, maxMp,
 * ammo, maxAmmo). Remover esta pasta remove o HUD junto.
 */
const HUD_MARKUP = `
<div class="hud-top-left" data-project-hud="physics-sandbox">
  <div class="hud-bar-wrapper">
    <span class="hud-bar-label" data-i18n="ui.hud.hp">VIDA</span>
    <div class="hud-bar-container">
      <div id="hud-hp-bar" class="hud-bar-fill-hp"></div>
    </div>
    <span data-bind="hp">100</span> / <span data-bind="maxHp">100</span>
  </div>
  <div class="hud-bar-wrapper">
    <span class="hud-bar-label" data-i18n="ui.hud.mp">MANA</span>
    <div class="hud-bar-container">
      <div id="hud-mp-bar" class="hud-bar-fill-mp"></div>
    </div>
    <span data-bind="mp">50</span> / <span data-bind="maxMp">50</span>
  </div>
</div>
<div class="hud-stat-badge" data-project-hud="physics-sandbox">
  <span data-i18n="ui.hud.ammo">MUNIÇÃO</span>:
  <span data-bind="ammo">30</span> / <span data-bind="maxAmmo">120</span>
</div>
`;

export class SandboxHud {
  private readonly mounted: HTMLElement[] = [];

  public constructor(private readonly doc: Document = document) {}

  public mount(): void {
    const overlay = this.doc.getElementById("hud-overlay");
    if (overlay === null || this.mounted.length > 0) return;

    const template = this.doc.createElement("template");
    template.innerHTML = HUD_MARKUP.trim();
    for (const node of Array.from(template.content.children)) {
      overlay.appendChild(node);
      this.mounted.push(node as HTMLElement);
    }
  }

  public dispose(): void {
    for (const node of this.mounted) node.remove();
    this.mounted.length = 0;
  }
}
