import type {
  LocaleDictionary,
} from "../../../contracts/ui/types";

const DEFAULT_LOCALE =
  "pt-BR";

export class LocalizationEngine {
  private activeLocale =
    DEFAULT_LOCALE;

  private readonly dictionaries =
    new Map<
      string,
      LocaleDictionary
    >();

  public constructor() {
    this.loadDefaultDictionaries();
  }

  public get currentLocale():
    string {
    return this.activeLocale;
  }

  public setLocale(
    locale: string,
  ): void {
    const normalized =
      locale.trim();

    if (
      normalized.length ===
      0
    ) {
      throw new Error(
        "LocalizationEngine.setLocale requer um locale não vazio.",
      );
    }

    this.activeLocale =
      normalized;

    console.log(
      `[LocalizationEngine] 🌐 Idioma alterado para: '${normalized}'`,
    );
  }

  public registerDictionary(
    locale: string,
    dictionary:
      LocaleDictionary,
  ): void {
    const normalized =
      locale.trim();

    if (
      normalized.length ===
      0
    ) {
      throw new Error(
        "LocalizationEngine.registerDictionary requer um locale não vazio.",
      );
    }

    const existing =
      this.dictionaries.get(
        normalized,
      );

    if (!existing) {
      this.dictionaries.set(
        normalized,
        {
          ...dictionary,
        },
      );

      return;
    }

    this.dictionaries.set(
      normalized,
      {
        ...existing,
        ...dictionary,
      },
    );
  }

  public hasLocale(
    locale: string,
  ): boolean {
    return this.dictionaries.has(
      locale,
    );
  }

  public translate(
    key: string,
    params?:
      Record<
        string,
        string | number
      >,
  ): string {
    const dictionary =
      this.dictionaries.get(
        this.activeLocale,
      ) ??
      this.dictionaries.get(
        DEFAULT_LOCALE,
      );

    let text =
      dictionary?.[key] ??
      key;

    if (!params) {
      return text;
    }

    const parameterKeys =
      Object.keys(
        params,
      );

    for (
      let index = 0;
      index <
      parameterKeys.length;
      index += 1
    ) {
      const parameterKey =
        parameterKeys[index];

      if (!parameterKey) {
        continue;
      }

      const value =
        params[
          parameterKey
        ];

      const token =
        `{${parameterKey}}`;

      /*
       * split/join evita RegExp
       * dinâmico e caracteres especiais
       * em nomes de parâmetros.
       */
      text =
        text
          .split(
            token,
          )
          .join(
            String(
              value,
            ),
          );
    }

    return text;
  }

  public updateDOMTranslations(
    root: HTMLElement,
  ): void {
    const elements =
      root.querySelectorAll<HTMLElement>(
        "[data-i18n]",
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

      const key =
        element.getAttribute(
          "data-i18n",
        );

      if (!key) {
        continue;
      }

      element.textContent =
        this.translate(
          key,
        );
    }
  }

  private loadDefaultDictionaries():
    void {
    this.registerDictionary(
      "pt-BR",
      {
        "ui.menu.start":
          "Iniciar Jogo",

        "ui.menu.settings":
          "Configurações",

        "ui.menu.exit":
          "Sair para a Área de Trabalho",

        "ui.screen.pause":
          "PAUSA",

        "ui.screen.inventory":
          "INVENTÁRIO",

        "ui.screen.settings":
          "CONFIGURAÇÕES",

        "ui.screen.dialogue":
          "DIÁLOGO",

        "ui.screen.gameOver":
          "FIM DE JOGO",

        "ui.welcome":
          "Bem-vindo, {name}!",
      },
    );

    this.registerDictionary(
      "en-US",
      {
        "ui.menu.start":
          "Start Game",

        "ui.menu.settings":
          "Settings",

        "ui.menu.exit":
          "Exit to Desktop",

        "ui.screen.pause":
          "PAUSED",

        "ui.screen.inventory":
          "INVENTORY",

        "ui.screen.settings":
          "SETTINGS",

        "ui.screen.dialogue":
          "DIALOGUE",

        "ui.screen.gameOver":
          "GAME OVER",

        "ui.welcome":
          "Welcome, {name}!",
      },
    );
  }
}