/**
 * HUD de demonstração (vida, mana, munição) do projeto Physics Sandbox.
 *
 * Pertence ao PROJETO, não à engine: a engine só oferece o contêiner genérico
 * `#hud-overlay` (módulo de UI) e o binder genérico: `data-bind="<chave>"` para
 * texto e `data-hud-fill="<chave>"` para barras (máximo = "max" + Chave).
 * As chaves (hp, mp, ammo...) são definidas aqui, pelo projeto. Remover esta
 * pasta remove o HUD junto.
 */
const HUD_MARKUP = `
<div class="hud-top-left" data-project-hud="physics-sandbox">
  <div class="hud-bar-wrapper">
    <span class="hud-bar-label">VIDA</span>
    <div class="hud-bar-container">
      <div class="hud-bar-fill-hp" data-hud-fill="hp" style="width:100%"></div>
    </div>
    <span data-bind="hp">100</span> / <span data-bind="maxHp">100</span>
  </div>
  <div class="hud-bar-wrapper">
    <span class="hud-bar-label">MANA</span>
    <div class="hud-bar-container">
      <div class="hud-bar-fill-mp" data-hud-fill="mp" style="width:100%"></div>
    </div>
    <span data-bind="mp">50</span> / <span data-bind="maxMp">50</span>
  </div>
</div>
<div class="hud-stat-badge" data-project-hud="physics-sandbox">
  <span>MUNIÇÃO</span>:
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
