export type UITemplateValue =
  string | number;

export type UITemplateData =
  Readonly<
    Record<
      string,
      UITemplateValue
    >
  >;

export class UITemplateRegistry {
  private readonly templates =
    new Map<
      string,
      string
    >();

  public constructor() {
    this.registerDefaults();
  }

  public registerTemplate(
    templateId: string,
    htmlContent: string,
  ): void {
    const normalizedId =
      templateId.trim();

    if (
      normalizedId.length ===
      0
    ) {
      throw new Error(
        "UITemplateRegistry.registerTemplate requer um templateId não vazio.",
      );
    }

    this.templates.set(
      normalizedId,
      htmlContent,
    );
  }

  public hasTemplate(
    templateId: string,
  ): boolean {
    return this.templates.has(
      templateId,
    );
  }

  public getTemplate(
    templateId: string,
  ): string | null {
    return (
      this.templates.get(
        templateId,
      ) ??
      null
    );
  }

  public instantiate(
    templateId: string,
    data?:
      UITemplateData,
  ): string {
    const template =
      this.templates.get(
        templateId,
      );

    if (
      template ===
      undefined
    ) {
      return `<!-- Template '${templateId}' não encontrado -->`;
    }

    if (!data) {
      return template;
    }

    let html =
      template;

    const keys =
      Object.keys(
        data,
      );

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

      const token =
        `{{${key}}}`;

      html =
        html
          .split(
            token,
          )
          .join(
            String(
              data[key],
            ),
          );
    }

    return html;
  }

  public removeTemplate(
    templateId: string,
  ): boolean {
    return this.templates.delete(
      templateId,
    );
  }

  public clear(): void {
    this.templates.clear();
  }

  private registerDefaults():
    void {
    this.registerTemplate(
      "dialogue_box",
      [
        '<div class="ui-dialogue-box">',
        '  <div class="ui-dialogue-speaker">{{speaker}}</div>',
        '  <div class="ui-dialogue-text">{{text}}</div>',
        "</div>",
      ].join("\n"),
    );

    this.registerTemplate(
      "inventory_card",
      [
        '<div class="ui-inventory-card" data-item-id="{{id}}">',
        '  <div class="ui-item-title">{{name}}</div>',
        '  <div class="ui-item-qty">x{{quantity}}</div>',
        "</div>",
      ].join("\n"),
    );
  }
}